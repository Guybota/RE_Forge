package reforge.engine;

import java.util.List;
import java.util.Set;
import java.util.concurrent.Executor;
import java.util.function.Consumer;

import com.google.gson.JsonArray;
import com.google.gson.JsonObject;

import forge.deck.Deck;
import forge.game.GameType;
import forge.gamemodes.match.GameLobby;
import forge.gamemodes.match.LobbySlot;
import forge.gamemodes.match.LobbySlotType;
import forge.gamemodes.net.ChatMessage;
import forge.gamemodes.net.IOnlineChatInterface;
import forge.gamemodes.net.IOnlineLobby;
import forge.gamemodes.net.IRemote;
import forge.gamemodes.net.NetConnectUtil;
import forge.gamemodes.net.client.FGameClient;
import forge.gamemodes.net.event.MessageEvent;
import forge.gamemodes.net.event.UpdateLobbyPlayerEvent;
import forge.gamemodes.net.server.FServerManager;
import forge.gui.interfaces.ILobbyView;
import forge.interfaces.IPlayerChangeListener;
import forge.localinstance.properties.ForgeConstants;
import forge.localinstance.properties.ForgeNetPreferences.FNetPref;
import forge.localinstance.properties.ForgePreferences.FPref;
import forge.model.FModel;

/** One Forge netplay lobby per engine process. Only typed Forge events cross the game port. */
final class OnlineLobby implements IOnlineLobby, IOnlineChatInterface, ILobbyView {
    private final Session session;
    private final Settings settings;
    private final Executor actions;
    private final Consumer<WebGuiGame> attachGui;
    private volatile GameLobby lobby;
    private volatile FGameClient client;
    private volatile IRemote remote;
    private volatile IPlayerChangeListener changes;
    private volatile boolean closed;
    private boolean host;
    private int port;
    private volatile List<String> addresses = List.of();
    private WebGuiGame gui;
    private RelayTunnel tunnel;
    private boolean relayed;
    private boolean opening = true;

    OnlineLobby(Session session, Settings settings, Executor actions, Consumer<WebGuiGame> attachGui) {
        this.session = session;
        this.settings = settings;
        this.actions = actions;
        this.attachGui = attachGui;
    }

    void open(JsonObject msg, boolean hosting) {
        HeadlessGui.claimOnline(this);
        host = hosting;
        relayed = "relay".equals(text(msg, "transport"));
        String name = text(msg, "name");
        if (name == null || name.isBlank() || name.length() > 40) {
            throw new IllegalArgumentException("Enter a player name (1–40 characters)");
        }
        FModel.getPreferences().setPref(FPref.PLAYER_NAME, name.trim());
        FModel.getPreferences().setPref(FPref.UI_RECORD_REPLAYS, false);
        FModel.getPreferences().setPref(FPref.UI_SHOW_ACTIONABLE_HIGHLIGHTS, true);
        FModel.getPreferences().setPref(FPref.UI_MATCHES_PER_GAME, "1");
        if (host) {
            port = relayed ? unusedPort() : msg.has("port") ? msg.get("port").getAsInt() : 36743;
            if (port < 1024 || port > 65535) throw new IllegalArgumentException("Port must be 1024–65535");
            try (java.net.ServerSocket probe = new java.net.ServerSocket(port)) {
                // Fail before Forge allocates its Netty groups when the port is already occupied.
            } catch (java.io.IOException e) {
                throw new IllegalArgumentException("Port is already in use: " + port, e);
            }
            FModel.getNetPreferences().setPref(FNetPref.NET_PORT, String.valueOf(port));
            FModel.getNetPreferences().setPref(FNetPref.UPnP,
                    !relayed && msg.has("upnp") && msg.get("upnp").getAsBoolean() ? "ALWAYS" : "NEVER");
            ChatMessage hosted = NetConnectUtil.host(this, this);
            if (!relayed) addMessage(hosted);
            lobby.applyVariant(GameType.Commander);
            if (relayed) {
                tunnel = RelayTunnel.host(port, this::closeConn);
                opening = false;
                publish();
                return;
            }
            addresses = List.of("127.0.0.1:" + port);
            publish();
            // External-address discovery can block on the network; never hold the UI action queue.
            Thread discovery = new Thread(() -> {
                addresses = List.copyOf(NetConnectUtil.collectHostedServerAddresses().urls);
                publish();
            }, "online-addresses");
            discovery.setDaemon(true);
            discovery.start();
        } else {
            if (relayed) tunnel = RelayTunnel.join(text(msg, "code"), this::closeConn);
            String address = relayed ? tunnel.localAddress() : text(msg, "address");
            if (address == null || address.isBlank()) throw new IllegalArgumentException("Enter a server address");
            ChatMessage result = NetConnectUtil.join(address.trim(), this, this);
            if (result.getMessage().equals(ForgeConstants.INVALID_HOST_COMMAND)) {
                throw new IllegalArgumentException("Invalid server address");
            }
            if (result.getMessage().startsWith(ForgeConstants.CONN_ERROR_PREFIX)) {
                throw new IllegalArgumentException(result.getMessage().substring(ForgeConstants.CONN_ERROR_PREFIX.length()));
            }
            addMessage(result);
        }
        opening = false;
        publish();
    }

    private static int unusedPort() {
        try (java.net.ServerSocket socket = new java.net.ServerSocket(0, 1, java.net.InetAddress.getLoopbackAddress())) {
            return socket.getLocalPort();
        } catch (java.io.IOException e) { throw new IllegalStateException("Could not allocate a game port", e); }
    }

    synchronized WebGuiGame newGui() {
        if (closed) throw new IllegalStateException("Lobby is closed");
        if (gui != null) gui.dispose();
        gui = new WebGuiGame(session, settings);
        attachGui.accept(gui);
        return gui;
    }

    @Override public ILobbyView setLobby(GameLobby value) { lobby = value; return this; }
    @Override public void setClient(FGameClient value) { client = value; }
    @Override public void setGameClient(IRemote value) { remote = value; }
    @Override public void setPlayerChangeListener(IPlayerChangeListener value) { changes = value; }
    @Override public void update(boolean fullUpdate) { publish(); }
    @Override public void update(int slot, LobbySlotType type) { publish(); }

    @Override public void closeConn(String message) {
        if (closed) return;
        actions.execute(() -> {
            if (closed) return;
            close();
            JsonObject error = new JsonObject();
            error.addProperty("type", "error");
            error.addProperty("message", message);
            if (relayed) error.addProperty("code", "relayDisconnected");
            session.send(error);
        });
    }

    private int localSlot() {
        if (lobby == null) return -1;
        for (int i = 0; i < lobby.getNumberOfSlots(); i++) {
            if (lobby.getSlot(i).getType() != LobbySlotType.AI && lobby.mayEdit(i)) return i;
        }
        return -1;
    }

    void handle(String type, JsonObject msg) {
        if (closed || lobby == null || changes == null) throw new IllegalStateException("No lobby is open");
        if (type.equals("chat")) {
            String body = text(msg, "text");
            if (body == null || body.isBlank() || body.length() > 2000) return;
            String name = FModel.getPreferences().getPref(FPref.PLAYER_NAME);
            remote.send(new MessageEvent(name, body.trim()));
            // Forge echoes chat to both remote clients and the host's lobby listener.
            return;
        }
        if (lobby.isMatchActive() || gui != null && gui.getGameView() != null && !gui.isFinishedForLocalPlayer()) {
            throw new IllegalStateException("A match is already running");
        }
        switch (type) {
            case "setSlot" -> {
                int index = msg.has("index") ? msg.get("index").getAsInt() : localSlot();
                LobbySlot slot = lobby.getSlot(index);
                if (slot == null) throw new IllegalArgumentException("Unknown slot");
                if (msg.has("slotType")) {
                    if (!host || index == 0 || !lobby.mayControl(index)) throw new IllegalArgumentException("Cannot change this slot");
                    LobbySlotType next = switch (msg.get("slotType").getAsString()) {
                        case "ai" -> LobbySlotType.AI;
                        case "open" -> LobbySlotType.OPEN;
                        default -> throw new IllegalArgumentException("Invalid slot type");
                    };
                    changes.update(index, UpdateLobbyPlayerEvent.create(next,
                            next == LobbySlotType.AI ? forge.util.Localizer.getInstance().getMessage("lblAI") + " " + index : "",
                            index, index, index, false, false, Set.of(), null));
                    if (next == LobbySlotType.OPEN) slot.setDeck(null);
                }
                if (msg.has("deck")) {
                    if (!lobby.mayEdit(index)) throw new IllegalArgumentException("Cannot edit this player's deck");
                    Deck deck = deck(text(msg, "deck"));
                    changes.update(index, UpdateLobbyPlayerEvent.isReadyUpdate(false));
                    changes.update(index, UpdateLobbyPlayerEvent.deckUpdate(deck));
                    // Forge's deckUpdate does not flag the slot as changed; DeckName publishes it.
                    changes.update(index, UpdateLobbyPlayerEvent.setDeckSchemePlaneVanguard(deck.getName(), null, null, null));
                }
            }
            case "setReady" -> {
                int index = localSlot();
                if (index < 0) throw new IllegalStateException("Waiting for a seat");
                if (lobby.getSlot(index).getDeck() == null && host) throw new IllegalArgumentException("Choose a deck first");
                changes.update(index, UpdateLobbyPlayerEvent.isReadyUpdate(msg.get("ready").getAsBoolean()));
            }
            case "addSlot" -> {
                if (!host || lobby.getNumberOfSlots() >= 4) throw new IllegalArgumentException("Maximum four players");
                lobby.addSlot();
            }
            case "removeSlot" -> {
                int index = msg.get("index").getAsInt();
                if (!host || !lobby.mayRemove(index) || !lobby.mayControl(index)) throw new IllegalArgumentException("Cannot remove this slot");
                lobby.removeSlot(index);
            }
            case "startOnlineMatch" -> {
                if (!host) throw new IllegalArgumentException("Only the host can start the match");
                int active = 0;
                for (int i = 0; i < lobby.getNumberOfSlots(); i++) {
                    LobbySlot slot = lobby.getSlot(i);
                    if (slot.getType() == LobbySlotType.OPEN) continue;
                    active++;
                    if (!slot.isReady() || slot.getDeck() == null) throw new IllegalArgumentException("Every player needs a deck and must be ready");
                }
                if (active < 2) throw new IllegalArgumentException("At least two players are required");
                Runnable start = lobby.startGame();
                if (start == null) throw new IllegalStateException("Forge could not start the match; check the decks");
                start.run();
                // The remote GUI has no local FControlGameEventHandler to release inputs on individual loss.
                // Keep the real player/controller intact; adapt only the controller used for wire calls.
                lobby.getHostedMatch().gameControllers.replaceAll((slot, controller) ->
                        slot.getType() == LobbySlotType.REMOTE && controller instanceof forge.player.PlayerControllerHuman human
                                ? new OnlineController(human) : controller);
            }
            default -> throw new IllegalArgumentException("Unknown lobby action");
        }
        publish();
        if (host) FServerManager.getInstance().updateLobbyState();
    }

    private static Deck deck(String name) {
        if (name == null || name.isBlank()) throw new IllegalArgumentException("Choose a deck");
        Deck result = DeckImporter.mine().contains(name) ? DeckImporter.mine().get(name)
                : FModel.getDecks().getCommanderPrecons().get(name);
        if (result == null) throw new IllegalArgumentException("Unknown deck: " + name);
        return result;
    }

    private void publish() {
        GameLobby current = lobby;
        if (closed || opening || current == null) return;
        JsonObject out = new JsonObject();
        out.addProperty("type", "lobby");
        out.addProperty("host", host);
        out.addProperty("localSlot", localSlot());
        out.addProperty("port", port);
        out.addProperty("transport", relayed ? "relay" : "direct");
        if (tunnel != null) out.addProperty("roomCode", tunnel.code());
        JsonArray urls = new JsonArray();
        addresses.forEach(urls::add);
        out.add("addresses", urls);
        JsonArray slots = new JsonArray();
        for (int i = 0; i < current.getNumberOfSlots(); i++) {
            LobbySlot slot = current.getSlot(i);
            JsonObject s = new JsonObject();
            s.addProperty("index", i);
            s.addProperty("kind", slot.getType() == LobbySlotType.AI ? "ai" : slot.getType() == LobbySlotType.OPEN ? "open" : "human");
            s.addProperty("name", slot.getName());
            s.addProperty("deck", slot.getDeck() == null ? null : slot.getDeck().getName());
            s.addProperty("ready", slot.isReady());
            s.addProperty("editable", current.mayEdit(i));
            s.addProperty("controllable", host && i != 0 && current.mayControl(i));
            slots.add(s);
        }
        out.add("slots", slots);
        session.send(out);
    }

    @Override public void addMessage(ChatMessage message) {
        if (closed) return;
        JsonObject out = new JsonObject();
        out.addProperty("type", "chatMessage");
        out.addProperty("source", message.getSource());
        out.addProperty("text", message.getMessage());
        out.addProperty("kind", message.getType().name().toLowerCase(java.util.Locale.ROOT));
        session.send(out);
    }

    void close() {
        if (closed) return;
        closed = true;
        if (tunnel != null) tunnel.close();
        if (gui != null && gui.getGameView() != null && !gui.getGameView().isGameOver()) {
            if (host && lobby != null && lobby.getHostedMatch() != null) {
                var match = lobby.getHostedMatch();
                var game = match.getGame();
                var controllers = List.copyOf(match.getHumanControllers());
                if (game != null) game.getAction().invoke(() -> {
                    game.setGameOver(forge.game.GameEndReason.AllHumansLost);
                    controllers.forEach(c -> c.getInputQueue().onGameOver(true));
                });
            } else {
                gui.getOriginalGameControllers().forEach(c -> c.concede());
            }
        }
        if (client != null) client.close();
        if (host && lobby != null) FServerManager.getInstance().stopServer();
        if (gui != null) gui.dispose();
        HeadlessGui.releaseOnline(this);
        JsonObject out = new JsonObject();
        out.addProperty("type", "lobbyClosed");
        session.send(out);
    }

    boolean isClosed() { return closed; }

    private static String text(JsonObject msg, String key) {
        return msg.has(key) && !msg.get(key).isJsonNull() ? msg.get(key).getAsString() : null;
    }
}
