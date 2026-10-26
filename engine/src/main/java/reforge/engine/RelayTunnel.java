package reforge.engine;

import java.io.ByteArrayOutputStream;
import java.io.IOException;
import java.net.InetAddress;
import java.net.InetSocketAddress;
import java.net.ServerSocket;
import java.net.Socket;
import java.net.URI;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.net.http.WebSocket;
import java.nio.ByteBuffer;
import java.time.Duration;
import java.util.Map;
import java.util.concurrent.ArrayBlockingQueue;
import java.util.concurrent.CompletableFuture;
import java.util.concurrent.CompletionStage;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicBoolean;
import java.util.function.Consumer;

import com.google.gson.JsonObject;
import com.google.gson.JsonParser;

/**
 * Outbound WebSockets carrying independent, ordered Forge TCP streams. No UI socket crosses the relay.
 *
 * <p>A dropped relay connection never ends a game by itself. The streams it carried can't be resumed byte by byte,
 * so they are closed and Forge's own netplay reconnection takes over: the host's server holds the game for the
 * missing players while the host reconnects to the room (the relay keeps it for a grace period), and each guest's
 * Forge client reconnects to the local listener, which opens a fresh stream in the room. Only a host that can't get
 * back in time, or a deliberate close, ends the session.
 */
final class RelayTunnel implements AutoCloseable {
    static final class Problem extends IllegalArgumentException {
        final String code;
        Problem(String code, String message, Throwable cause) { super(message, cause); this.code = code; }
    }
    private static final int CHUNK = 32 * 1024;
    private static final byte[] END = new byte[0];
    /** How long a host keeps trying to get back into its room; the relay holds it for three minutes. */
    private static final long HOST_GRACE_MS = 170_000;
    private static final long[] RETRY_MS = {1_000, 2_000, 3_000, 5_000};
    /** Close reasons the relay understands as a deliberate leave rather than a dropped connection. */
    private static final String HOST_LEFT = "Host left", GUEST_LEFT = "Guest left";
    private static final HttpClient HTTP = HttpClient.newBuilder().connectTimeout(Duration.ofSeconds(10))
            .followRedirects(HttpClient.Redirect.NEVER).build();
    private final boolean host;
    private final int gamePort;
    private final Consumer<String> failure;
    private final Map<Integer, Pipe> pipes = new ConcurrentHashMap<>();
    private final AtomicBoolean closed = new AtomicBoolean();
    private final AtomicBoolean reconnecting = new AtomicBoolean();
    private volatile Link link;
    private ServerSocket listener;
    private URI origin;
    private String token;
    private String code;

    private RelayTunnel(boolean host, int gamePort, Consumer<String> failure) {
        this.host = host;
        this.gamePort = gamePort;
        this.failure = failure;
    }

    static String configuredUrl() {
        String value = System.getProperty("reforge.relay.url", System.getenv("RE_FORGE_RELAY_URL"));
        return value == null ? "" : value.trim();
    }

    private static URI origin() {
        try {
            URI uri = URI.create(configuredUrl());
            boolean local = "http".equals(uri.getScheme()) &&
                    java.util.Set.of("localhost", "127.0.0.1", "[::1]").contains(uri.getHost());
            if ((!"https".equals(uri.getScheme()) && !local) || uri.getHost() == null ||
                    uri.getUserInfo() != null || uri.getQuery() != null || uri.getFragment() != null ||
                    !(uri.getPath().isEmpty() || uri.getPath().equals("/"))) throw new IllegalArgumentException();
            return URI.create(uri.toString().replaceAll("/+$", ""));
        } catch (RuntimeException e) {
            throw new Problem("relayUnavailable", "Configure RE_FORGE_RELAY_URL with the HTTPS relay origin (HTTP is allowed only on loopback)", e);
        }
    }

    static RelayTunnel host(int gamePort, Consumer<String> failure) {
        RelayTunnel tunnel = new RelayTunnel(true, gamePort, failure);
        tunnel.origin = origin();
        try {
            HttpRequest request = HttpRequest.newBuilder(tunnel.origin.resolve("/rooms")).timeout(Duration.ofSeconds(15))
                    .POST(HttpRequest.BodyPublishers.noBody()).build();
            HttpResponse<String> response = HTTP.send(request, HttpResponse.BodyHandlers.ofString());
            if (response.statusCode() != 201) throw new IOException("Relay could not create a room (HTTP " + response.statusCode() + ")");
            JsonObject room = JsonParser.parseString(response.body()).getAsJsonObject();
            tunnel.code = room.get("code").getAsString();
            if (!tunnel.code.matches("[A-HJ-NP-Z2-9]{8}")) throw new IOException("Invalid room response");
            tunnel.token = room.get("hostToken").getAsString();
            tunnel.link = tunnel.connect();
            return tunnel;
        } catch (Exception e) {
            tunnel.close();
            throw problem(e);
        }
    }

    static RelayTunnel join(String code, Consumer<String> failure) {
        if (code == null) throw new Problem("relayInvalidCode", "Enter a room code", null);
        String normalized = code.trim().toUpperCase(java.util.Locale.ROOT).replace("-", "").replace(" ", "");
        if (!normalized.matches("[A-HJ-NP-Z2-9]{8}")) throw new Problem("relayInvalidCode", "Room codes have eight letters or digits", null);
        RelayTunnel tunnel = new RelayTunnel(false, 0, failure);
        tunnel.origin = origin();
        tunnel.code = normalized;
        try {
            // Joining now reports a wrong code or a full room before Forge connects.
            tunnel.link = tunnel.connect();
            tunnel.listener = new ServerSocket(0, 4, InetAddress.getByName("127.0.0.1"));
            daemon("relay-accept", tunnel::acceptGameConnections);
            return tunnel;
        } catch (Exception e) {
            tunnel.close();
            throw problem(e);
        }
    }

    String code() { return code; }
    String localAddress() { return "127.0.0.1:" + listener.getLocalPort(); }

    /** Opens a link to the room and waits for the relay's ready message. */
    private Link connect() throws Exception {
        String scheme = origin.getScheme().equals("https") ? "wss" : "ws";
        URI address = URI.create(scheme + "://" + origin.getRawAuthority() + "/rooms/" + code + "?role=" + (host ? "host" : "guest"));
        WebSocket.Builder builder = HTTP.newWebSocketBuilder().connectTimeout(Duration.ofSeconds(15));
        if (token != null) builder.header("Authorization", "Bearer " + token);
        Link next = new Link();
        next.ws = builder.buildAsync(address, next).get(20, TimeUnit.SECONDS);
        try {
            next.channel = next.ready.get(10, TimeUnit.SECONDS);
        } catch (Exception e) {
            next.ws.abort();
            throw e;
        }
        if (closed.get()) { next.leave(); throw new IOException("Relay connection closed"); }
        return next;
    }

    /**
     * Guest: every connection Forge's client makes (the first one and each reconnection) gets its own stream in the
     * room. A link not yet used carries the first one; later ones open a fresh link, and the old one is left.
     */
    private void acceptGameConnections() {
        while (!closed.get()) {
            Socket socket;
            try { socket = listener.accept(); }
            catch (IOException e) { if (!closed.get()) failed("Relay game connection closed"); return; }
            pipes.values().forEach(Pipe::stop);
            pipes.clear();
            Link current = link;
            try {
                if (current == null || current.used) {
                    if (current != null) current.leave();
                    current = connect();
                    link = current;
                    System.err.println("Relay: guest stream reopened on channel " + current.channel);
                }
                current.used = true;
                Pipe pipe = new Pipe(current.channel, current);
                pipes.put(current.channel, pipe);
                pipe.attach(socket);
            } catch (Exception e) {
                try { socket.close(); } catch (IOException ignored) { }
                // A closed room has nobody to return to; otherwise the host may still be away and Forge retries.
                if (problem(e).code.equals("relayRoomMissing")) { failed("The room was closed"); return; }
                System.err.println("Relay: guest could not reopen its stream: " + e.getMessage());
            }
        }
    }

    /** A link ended without a deliberate close: drop its streams and, as host, get back into the room. */
    private void lost(Link dropped, String reason) {
        if (closed.get() || dropped != link) return;
        link = null;
        if (dropped.ws != null) dropped.ws.abort();
        System.err.println("Relay: connection lost (" + reason + "); " + (host ? "reconnecting" : "waiting for Forge to reconnect"));
        pipes.values().forEach(Pipe::stop);
        pipes.clear();
        if (host && reconnecting.compareAndSet(false, true)) daemon("relay-reconnect", this::reconnectHost);
    }

    private void reconnectHost() {
        long deadline = System.currentTimeMillis() + HOST_GRACE_MS;
        try {
            for (int attempt = 0; !closed.get() && System.currentTimeMillis() < deadline; attempt++) {
                try { Thread.sleep(RETRY_MS[Math.min(attempt, RETRY_MS.length - 1)]); }
                catch (InterruptedException e) { Thread.currentThread().interrupt(); return; }
                try {
                    link = connect();
                    System.err.println("Relay: host reconnected to room " + code + " after " + (attempt + 1) + " attempt(s)");
                    return;
                } catch (Exception e) {
                    if (problem(e).code.equals("relayRoomMissing")) break; // the room is gone: nothing to return to
                    System.err.println("Relay: host reconnection attempt " + (attempt + 1) + " failed: " + e.getMessage());
                }
            }
            failed("Connection to the relay was lost");
        } finally {
            reconnecting.set(false);
        }
    }

    private void failed(String message) {
        System.err.println("Relay: giving up: " + message);
        if (!closed.get()) { close(); failure.accept(message); }
    }

    @Override public void close() {
        if (!closed.compareAndSet(false, true)) return;
        if (listener != null) try { listener.close(); } catch (IOException ignored) { }
        pipes.values().forEach(Pipe::stop);
        pipes.clear();
        Link current = link;
        if (current != null) current.leave();
    }

    /** One WebSocket to the relay. Callbacks from a link that was replaced are ignored. */
    private final class Link implements WebSocket.Listener {
        final CompletableFuture<Integer> ready = new CompletableFuture<>();
        final ByteArrayOutputStream binary = new ByteArrayOutputStream();
        final StringBuilder text = new StringBuilder();
        final Object sendLock = new Object();
        volatile WebSocket ws;
        volatile int channel;
        /** Guest: a game connection already went through this link. */
        volatile boolean used;

        @Override public void onOpen(WebSocket socket) { ws = socket; socket.request(1); }

        @Override public CompletionStage<?> onText(WebSocket socket, CharSequence data, boolean last) {
            try {
                if (text.length() + data.length() > 1024) throw new IOException("Invalid relay message");
                text.append(data);
                if (last) {
                    JsonObject event = JsonParser.parseString(text.toString()).getAsJsonObject();
                    text.setLength(0);
                    int stream = event.get("channel").getAsInt();
                    switch (event.get("type").getAsString()) {
                        case "ready" -> ready.complete(stream);
                        case "peerJoined" -> {
                            if (!host || stream <= 0 || pipes.size() >= 3) throw new IOException("Invalid relay peer");
                            Pipe pipe = new Pipe(stream, this);
                            pipes.put(stream, pipe);
                            Socket socket1 = new Socket();
                            try {
                                socket1.connect(new InetSocketAddress("127.0.0.1", gamePort), 3000);
                                pipe.attach(socket1);
                            } catch (IOException e) { socket1.close(); pipe.close(); }
                        }
                        case "peerLeft" -> { Pipe pipe = pipes.remove(stream); if (pipe != null) pipe.stop(); }
                        default -> throw new IOException("Unknown relay message");
                    }
                }
            } catch (Exception e) {
                if (this == link) failed("Invalid relay control message");
            }
            socket.request(1);
            return null;
        }

        @Override public CompletionStage<?> onBinary(WebSocket socket, ByteBuffer data, boolean last) {
            if (binary.size() + data.remaining() > CHUNK + 4) { lost(this, "relay frame too large"); return null; }
            byte[] part = new byte[data.remaining()];
            data.get(part);
            binary.writeBytes(part);
            if (last) {
                ByteBuffer frame = ByteBuffer.wrap(binary.toByteArray());
                binary.reset();
                if (frame.remaining() <= 4) { lost(this, "invalid relay frame"); return null; }
                Pipe pipe = pipes.get(frame.getInt());
                if (pipe != null) {
                    byte[] chunk = new byte[frame.remaining()];
                    frame.get(chunk);
                    // A slow reader holds the relay back (no more frames are requested) instead of losing its stream.
                    if (!pipe.incoming.offer(chunk)) {
                        return CompletableFuture.runAsync(() -> {
                            try { if (!pipe.incoming.offer(chunk, 30, TimeUnit.SECONDS)) pipe.close(); }
                            catch (InterruptedException e) { Thread.currentThread().interrupt(); pipe.close(); }
                        }).whenComplete((ignored, error) -> socket.request(1));
                    }
                }
            }
            socket.request(1);
            return null;
        }

        @Override public CompletionStage<?> onClose(WebSocket socket, int status, String reason) {
            ready.completeExceptionally(new IOException("Relay closed: " + status + " " + reason));
            // The relay says the room itself is over: a guest has nothing to reconnect to.
            if (!host && this == link && (reason.equals("Host disconnected") || reason.equals("Room expired"))) failed("The room was closed");
            else lost(this, "closed " + status + (reason.isBlank() ? "" : " " + reason));
            return null;
        }

        @Override public void onError(WebSocket socket, Throwable error) {
            ready.completeExceptionally(error);
            lost(this, String.valueOf(error.getMessage()));
        }

        void send(int stream, byte[] data, int size) throws IOException {
            ByteBuffer frame = ByteBuffer.allocate(size + 4).putInt(stream).put(data, 0, size);
            frame.flip();
            synchronized (sendLock) {
                if (closed.get() || this != link) throw new IOException("Relay stream is gone");
                try { ws.sendBinary(frame, true).get(10, TimeUnit.SECONDS); }
                catch (Exception e) {
                    // A send that can't complete means the link is dead even if no close arrived.
                    lost(this, "send failed: " + e);
                    throw new IOException("Relay send failed", e);
                }
            }
        }

        void sendText(String message) {
            synchronized (sendLock) {
                try { ws.sendText(message, true).get(10, TimeUnit.SECONDS); }
                catch (Exception e) { lost(this, "send failed: " + e); }
            }
        }

        /** A deliberate close the relay recognises; aborted if the relay doesn't answer quickly. */
        void leave() {
            WebSocket socket = ws;
            if (socket == null) return;
            socket.sendClose(WebSocket.NORMAL_CLOSURE, host ? HOST_LEFT : GUEST_LEFT)
                    .orTimeout(2, TimeUnit.SECONDS).whenComplete((ignored, error) -> socket.abort());
        }
    }

    private final class Pipe {
        final int channel;
        final Link via;
        final ArrayBlockingQueue<byte[]> incoming = new ArrayBlockingQueue<>(64);
        final AtomicBoolean stopped = new AtomicBoolean();
        volatile Socket socket;
        Pipe(int channel, Link via) { this.channel = channel; this.via = via; }

        void attach(Socket value) throws IOException {
            socket = value;
            if (stopped.get() || closed.get()) { value.close(); return; }
            value.setTcpNoDelay(true);
            daemon("relay-write-" + channel, () -> {
                try {
                    while (!stopped.get()) {
                        byte[] bytes = incoming.take();
                        if (bytes == END) break;
                        value.getOutputStream().write(bytes);
                    }
                } catch (Exception e) { /* close both directions */ }
                finally { close(); }
            });
            daemon("relay-read-" + channel, () -> {
                try {
                    byte[] bytes = new byte[CHUNK];
                    int count;
                    while (!stopped.get() && (count = value.getInputStream().read(bytes)) != -1) via.send(channel, bytes, count);
                } catch (Exception e) { /* close both directions */ }
                finally { close(); }
            });
        }

        void stop() {
            if (!stopped.compareAndSet(false, true)) return;
            incoming.clear();
            incoming.offer(END);
            if (socket != null) try { socket.close(); } catch (IOException ignored) { }
        }

        /** The local Forge side ended this stream: tell the relay so the other end closes too. */
        void close() {
            if (stopped.get()) return;
            stop();
            pipes.remove(channel, this);
            if (closed.get() || via != link) return;
            if (!host) { via.leave(); return; } // Forge's client closed its connection; a reconnection opens a new link
            daemon("relay-close-" + channel, () -> {
                JsonObject event = new JsonObject();
                event.addProperty("type", "disconnect");
                event.addProperty("channel", channel);
                via.sendText(event.toString());
            });
        }
    }

    private static Problem problem(Exception e) {
        if (e instanceof Problem p) return p;
        for (Throwable current = e; current != null; current = current.getCause()) {
            if (current instanceof java.net.http.WebSocketHandshakeException handshake) {
                String code = switch (handshake.getResponse().statusCode()) {
                    case 404 -> "relayRoomMissing";
                    case 423 -> "relayRoomFull";
                    case 429 -> "relayRateLimited";
                    default -> "relayUnavailable";
                };
                return new Problem(code, "Could not join the relay room (HTTP " + handshake.getResponse().statusCode() + ")", e);
            }
        }
        Throwable cause = e;
        while (cause.getCause() != null) cause = cause.getCause();
        if (cause instanceof InterruptedException) Thread.currentThread().interrupt();
        return new Problem("relayUnavailable", "Could not connect to the relay: " + cause.getMessage(), e);
    }

    private static void daemon(String name, Runnable action) {
        Thread thread = new Thread(action, name);
        thread.setDaemon(true);
        thread.start();
    }
}
