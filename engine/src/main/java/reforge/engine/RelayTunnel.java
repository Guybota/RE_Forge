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

/** Outbound WebSocket carrying independent, ordered Forge TCP streams. No UI socket crosses the relay. */
final class RelayTunnel implements AutoCloseable, WebSocket.Listener {
    static final class Problem extends IllegalArgumentException {
        final String code;
        Problem(String code, String message, Throwable cause) { super(message, cause); this.code = code; }
    }
    private static final int CHUNK = 32 * 1024;
    private static final byte[] END = new byte[0];
    private static final HttpClient HTTP = HttpClient.newBuilder().connectTimeout(Duration.ofSeconds(10))
            .followRedirects(HttpClient.Redirect.NEVER).build();
    private final boolean host;
    private final int gamePort;
    private final Consumer<String> failure;
    private final Map<Integer, Pipe> pipes = new ConcurrentHashMap<>();
    private final AtomicBoolean closed = new AtomicBoolean();
    private final CompletableFuture<Void> ready = new CompletableFuture<>();
    private final ByteArrayOutputStream binary = new ByteArrayOutputStream();
    private final StringBuilder text = new StringBuilder();
    private final Object sendLock = new Object();
    private volatile WebSocket websocket;
    private ServerSocket listener;
    private volatile int guestChannel;
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
        URI origin = origin();
        RelayTunnel tunnel = new RelayTunnel(true, gamePort, failure);
        try {
            HttpRequest request = HttpRequest.newBuilder(origin.resolve("/rooms")).timeout(Duration.ofSeconds(15))
                    .POST(HttpRequest.BodyPublishers.noBody()).build();
            HttpResponse<String> response = HTTP.send(request, HttpResponse.BodyHandlers.ofString());
            if (response.statusCode() != 201) throw new IOException("Relay could not create a room (HTTP " + response.statusCode() + ")");
            JsonObject room = JsonParser.parseString(response.body()).getAsJsonObject();
            tunnel.code = room.get("code").getAsString();
            if (!tunnel.code.matches("[A-HJ-NP-Z2-9]{8}")) throw new IOException("Invalid room response");
            tunnel.connect(origin, room.get("hostToken").getAsString());
            return tunnel;
        } catch (Exception e) {
            tunnel.close();
            throw problem(e);
        }
    }

    static RelayTunnel join(String code, Consumer<String> failure) {
        URI origin = origin();
        if (code == null) throw new Problem("relayInvalidCode", "Enter a room code", null);
        String normalized = code.trim().toUpperCase(java.util.Locale.ROOT).replace("-", "").replace(" ", "");
        if (!normalized.matches("[A-HJ-NP-Z2-9]{8}")) throw new Problem("relayInvalidCode", "Room codes have eight letters or digits", null);
        RelayTunnel tunnel = new RelayTunnel(false, 0, failure);
        tunnel.code = normalized;
        try {
            tunnel.connect(origin, null);
            tunnel.listener = new ServerSocket(0, 1, InetAddress.getByName("127.0.0.1"));
            daemon("relay-accept", () -> {
                try {
                    Socket socket = tunnel.listener.accept();
                    if (tunnel.closed.get()) { socket.close(); return; }
                    tunnel.pipes.get(tunnel.guestChannel).attach(socket);
                } catch (IOException e) { tunnel.failed("Relay game connection closed"); }
            });
            return tunnel;
        } catch (Exception e) {
            tunnel.close();
            throw problem(e);
        }
    }

    String code() { return code; }
    String localAddress() { return "127.0.0.1:" + listener.getLocalPort(); }

    private void connect(URI origin, String token) throws Exception {
        String scheme = origin.getScheme().equals("https") ? "wss" : "ws";
        URI address = URI.create(scheme + "://" + origin.getRawAuthority() + "/rooms/" + code + "?role=" + (host ? "host" : "guest"));
        WebSocket.Builder builder = HTTP.newWebSocketBuilder().connectTimeout(Duration.ofSeconds(15));
        if (token != null) builder.header("Authorization", "Bearer " + token);
        websocket = builder.buildAsync(address, this).get(20, TimeUnit.SECONDS);
        ready.get(10, TimeUnit.SECONDS);
        if (closed.get()) throw new IOException("Relay connection closed");
    }

    @Override public void onOpen(WebSocket ws) { websocket = ws; ws.request(1); }

    @Override public CompletionStage<?> onText(WebSocket ws, CharSequence data, boolean last) {
        try {
            if (text.length() + data.length() > 1024) throw new IOException("Invalid relay message");
            text.append(data);
            if (last) {
                JsonObject event = JsonParser.parseString(text.toString()).getAsJsonObject();
                text.setLength(0);
                int channel = event.get("channel").getAsInt();
                switch (event.get("type").getAsString()) {
                    case "ready" -> {
                        if (!host) {
                            guestChannel = channel;
                            pipes.put(channel, new Pipe(channel));
                        }
                        ready.complete(null);
                    }
                    case "peerJoined" -> {
                        if (!host || channel <= 0 || pipes.size() >= 3) throw new IOException("Invalid relay peer");
                        Pipe pipe = new Pipe(channel);
                        pipes.put(channel, pipe);
                        Socket socket = new Socket();
                        try {
                            socket.connect(new InetSocketAddress("127.0.0.1", gamePort), 3000);
                            pipe.attach(socket);
                        } catch (IOException e) { socket.close(); pipe.close(); }
                    }
                    case "peerLeft" -> { Pipe pipe = pipes.remove(channel); if (pipe != null) pipe.stop(); }
                    default -> throw new IOException("Unknown relay message");
                }
            }
        } catch (Exception e) { failed("Invalid relay control message"); }
        ws.request(1);
        return CompletableFuture.completedFuture(null);
    }

    @Override public CompletionStage<?> onBinary(WebSocket ws, ByteBuffer data, boolean last) {
        if (binary.size() + data.remaining() > CHUNK + 4) { failed("Relay frame is too large"); return null; }
        byte[] part = new byte[data.remaining()];
        data.get(part);
        binary.writeBytes(part);
        if (last) {
            ByteBuffer frame = ByteBuffer.wrap(binary.toByteArray());
            binary.reset();
            if (frame.remaining() <= 4) { failed("Invalid relay frame"); return null; }
            Pipe pipe = pipes.get(frame.getInt());
            if (pipe != null) {
                byte[] chunk = new byte[frame.remaining()];
                frame.get(chunk);
                if (!pipe.incoming.offer(chunk)) pipe.close();
            }
        }
        ws.request(1);
        return CompletableFuture.completedFuture(null);
    }

    @Override public CompletionStage<?> onClose(WebSocket ws, int status, String reason) {
        failed("Relay disconnected" + (reason.isBlank() ? "" : ": " + reason));
        return CompletableFuture.completedFuture(null);
    }

    @Override public void onError(WebSocket ws, Throwable error) { failed("Connection to the relay was lost"); }

    private void send(int channel, byte[] data, int size) throws Exception {
        ByteBuffer frame = ByteBuffer.allocate(size + 4).putInt(channel).put(data, 0, size);
        frame.flip();
        synchronized (sendLock) {
            if (closed.get()) throw new IOException("Relay is closed");
            websocket.sendBinary(frame, true).get(10, TimeUnit.SECONDS);
        }
    }

    private void failed(String message) {
        ready.completeExceptionally(new IOException(message));
        if (!closed.get()) { close(); failure.accept(message); }
    }

    @Override public void close() {
        if (!closed.compareAndSet(false, true)) return;
        ready.completeExceptionally(new IOException("Relay closed"));
        if (listener != null) try { listener.close(); } catch (IOException ignored) { }
        pipes.values().forEach(Pipe::stop);
        pipes.clear();
        WebSocket ws = websocket;
        if (ws != null) ws.abort();
    }

    private final class Pipe {
        final int channel;
        final ArrayBlockingQueue<byte[]> incoming = new ArrayBlockingQueue<>(64);
        final AtomicBoolean stopped = new AtomicBoolean();
        volatile Socket socket;
        Pipe(int channel) { this.channel = channel; }

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
                    while (!stopped.get() && (count = value.getInputStream().read(bytes)) != -1) send(channel, bytes, count);
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

        void close() {
            if (stopped.get()) return;
            stop();
            pipes.remove(channel, this);
            if (!host) { failed("Connection to the host closed"); return; }
            if (!closed.get()) daemon("relay-close-" + channel, () -> {
                JsonObject event = new JsonObject();
                event.addProperty("type", "disconnect");
                event.addProperty("channel", channel);
                try {
                    synchronized (sendLock) { websocket.sendText(event.toString(), true).get(10, TimeUnit.SECONDS); }
                } catch (Exception e) { failed("Connection to the relay was lost"); }
            });
        }
    }

    private static IllegalArgumentException problem(Exception e) {
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
