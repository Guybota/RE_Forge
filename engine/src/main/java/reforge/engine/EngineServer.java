package reforge.engine;

import java.net.InetSocketAddress;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

import org.java_websocket.WebSocket;
import org.java_websocket.handshake.ClientHandshake;
import org.java_websocket.server.WebSocketServer;

import com.google.gson.Gson;
import com.google.gson.JsonArray;
import com.google.gson.JsonObject;
import com.google.gson.JsonParseException;

import forge.game.card.CardView;
import forge.game.player.PlayerView;
import forge.gamemodes.match.HostedMatch;
import forge.interfaces.IGameController;
import forge.model.FModel;

/**
 * Local WebSocket the web UI talks to. Every message is a JSON object with a "type".
 * Only the UI on this machine connects, so the server binds to 127.0.0.1.
 */
public final class EngineServer extends WebSocketServer {
    private static final Gson GSON = new Gson();
    private final CountDownLatch started = new CountDownLatch(1);

    /** What one connected UI has going on. */
    private static final class Connection {
        final Session session;
        // UI actions can make Forge ask a question back; running them here keeps the socket
        // thread free to receive the answer.
        final ExecutorService actions = Executors.newSingleThreadExecutor(r -> {
            Thread t = new Thread(r, "ui-actions");
            t.setDaemon(true);
            return t;
        });
        volatile WebGuiGame gui;
        volatile HostedMatch match;
        volatile OnlineLobby online;

        Connection(WebSocket socket) {
            session = new Session(socket);
        }
    }

    private final String imageBase;
    private final Settings settings;
    @FunctionalInterface
    interface MatchFactory {
        HostedMatch start(WebGuiGame gui, String deck, int opponents);
    }
    private final MatchFactory matches;

    public EngineServer(InetSocketAddress address, String imageBase, Settings settings) {
        this(address, imageBase, settings, MatchStarter::startCommander);
    }

    EngineServer(InetSocketAddress address, String imageBase, Settings settings, MatchFactory matches) {
        super(address);
        this.imageBase = imageBase;
        this.settings = settings;
        this.matches = matches;
        setReuseAddr(true);
        // The library drops a connection (code 1006) when a ping isn't answered in time. The UI is a
        // local process that lives and dies with us; the parent-watch already handles it going away.
        setConnectionLostTimeout(0);
    }

    /** Blocks until the socket is bound, then returns the real port (useful when asked for port 0). */
    public int awaitPort() throws InterruptedException {
        started.await();
        return getPort();
    }

    @Override
    public void onStart() {
        started.countDown();
    }

    @Override
    public void onOpen(WebSocket conn, ClientHandshake handshake) {
        conn.setAttachment(new Connection(conn));
    }

    @Override
    public void onClose(WebSocket conn, int code, String reason, boolean remote) {
        Connection c = conn.getAttachment();
        if (c == null) return;
        c.session.close();
        if (c.online != null) {
            c.actions.execute(() -> { c.online.close(); c.online = null; });
            c.actions.shutdown();
            return;
        }
        WebGuiGame gui = c.gui;
        if (gui != null) {
            // Nobody is left to play this side; end the game instead of leaving it waiting forever.
            c.actions.execute(() -> {
                if (!gui.isFinishedForLocalPlayer()) {
                    gui.concede(); // the closed session answers "yes" to the confirm
                    gui.concede(); // and this stops the AIs still playing
                }
                gui.dispose();
            });
        }
        c.actions.shutdown();
    }

    @Override
    public void onMessage(WebSocket conn, String text) {
        Connection c = conn.getAttachment();
        JsonObject msg;
        try {
            msg = GSON.fromJson(text, JsonObject.class);
        } catch (JsonParseException e) {
            c.session.send(error("Invalid JSON"));
            return;
        }
        if (msg == null || !msg.has("type")) {
            c.session.send(error("Missing type"));
            return;
        }
        switch (msg.get("type").getAsString()) {
            case "hello" -> c.session.send(engineInfo());
            case "listDecks" -> c.session.send(decks());
            case "previewDeck" -> c.actions.execute(() -> c.session.send(
                    DeckImporter.preview(string(msg, "text"), string(msg, "name")).json()));
            case "saveDeck" -> c.actions.execute(() -> {
                String problem = DeckImporter.save(string(msg, "text"), string(msg, "name"));
                c.session.send(problem == null ? decks() : error(problem));
            });
            case "deleteDeck" -> c.actions.execute(() -> {
                DeckImporter.delete(string(msg, "name"));
                c.session.send(decks());
            });
            case "setLanguage" -> c.actions.execute(() -> setLanguage(c, msg));
            case "setSkin" -> setSkin(c, msg);
            case "setPhaseStops" -> c.actions.execute(() -> setPhaseStops(c, msg));
            case "startMatch" -> c.actions.execute(() -> startMatch(c, msg));
            case "hostGame", "joinGame" -> c.actions.execute(() -> openOnline(c, msg));
            case "setSlot", "setReady", "addSlot", "removeSlot", "startOnlineMatch", "chat", "leaveLobby" ->
                    c.actions.execute(() -> onlineAction(c, msg));
            case "action" -> c.actions.execute(() -> action(c, msg));
            case "answer" -> c.session.onAnswer(msg);
            default -> c.session.send(error("Unknown type: " + msg.get("type").getAsString()));
        }
    }

    private void setLanguage(Connection c, JsonObject msg) {
        // Forge's translators are shared by the whole engine; swapping them mid-game would mix languages.
        if (c.gui != null && !c.gui.isFinishedForLocalPlayer()) {
            c.session.send(error("Can't change language during a match"));
            return;
        }
        try {
            settings.changeLanguage(msg.has("language") ? msg.get("language").getAsString() : "");
            c.session.send(engineInfo());
        } catch (IllegalArgumentException | java.io.IOException e) {
            c.session.send(error(e.getMessage()));
        }
    }

    /** Purely visual, so allowed at any time, mid-game included. */
    private void setSkin(Connection c, JsonObject msg) {
        try {
            settings.changeSkin(msg.has("skin") ? msg.get("skin").getAsString() : null);
            c.session.send(engineInfo());
        } catch (IllegalArgumentException | java.io.IOException e) {
            c.session.send(error(e.getMessage()));
        }
    }

    private void startMatch(Connection c, JsonObject msg) {
        if (HeadlessGui.hasOnline()) {
            c.session.send(error("Leave the online lobby first"));
            return;
        }
        if (c.gui != null) {
            if (!c.gui.isFinishedForLocalPlayer()) {
                c.session.send(error("A match is already running"));
                return;
            }
            c.gui.dispose();
        }
        String deck = msg.has("deck") && !msg.get("deck").isJsonNull() ? msg.get("deck").getAsString() : null;
        int opponents = msg.has("opponents") ? msg.get("opponents").getAsInt() : 1;
        WebGuiGame gui = new WebGuiGame(c.session, settings);
        try {
            c.gui = gui;
            c.match = matches.start(gui, deck, opponents);
        } catch (RuntimeException e) {
            c.gui = null;
            gui.dispose();
            e.printStackTrace();
            c.session.send(error("Could not start the match: " + e.getMessage()));
        }
    }

    private void openOnline(Connection c, JsonObject msg) {
        if (c.online != null && c.online.isClosed()) c.online = null;
        if (c.online != null || c.gui != null && !c.gui.isFinishedForLocalPlayer()) {
            c.session.send(error("A game or lobby is already open"));
            return;
        }
        if (c.gui != null) { c.gui.dispose(); c.gui = null; }
        OnlineLobby online = new OnlineLobby(c.session, settings, c.actions, gui -> c.gui = gui);
        try {
            online.open(msg, msg.get("type").getAsString().equals("hostGame"));
            c.online = online;
        } catch (RuntimeException e) {
            online.close();
            c.gui = null;
            c.session.send(error(e.getMessage()));
        }
    }

    private static void onlineAction(Connection c, JsonObject msg) {
        try {
            if (c.online == null) throw new IllegalStateException("No online lobby is open");
            if (msg.get("type").getAsString().equals("leaveLobby")) {
                c.online.close();
                c.online = null;
                c.gui = null;
            } else {
                c.online.handle(msg.get("type").getAsString(), msg);
            }
        } catch (RuntimeException e) {
            c.session.send(error(e.getMessage()));
        }
    }

    private void setPhaseStops(Connection c, JsonObject msg) {
        try {
            if (!msg.has("stops") || !msg.get("stops").isJsonNull() && !msg.get("stops").isJsonObject()) {
                throw new IllegalArgumentException("Expected phase stops or null to restore defaults");
            }
            settings.changePhaseStops(msg.get("stops").isJsonNull() ? null : msg.getAsJsonObject("stops"));
            for (WebSocket socket : getConnections()) {
                Connection connection = socket.getAttachment();
                if (connection == null) continue;
                if (connection.gui != null) connection.gui.phaseStopsChanged();
                connection.session.send(engineInfo());
            }
        } catch (IllegalArgumentException | java.io.IOException e) {
            c.session.send(error(e.getMessage()));
        }
    }

    private static void action(Connection c, JsonObject msg) {
        WebGuiGame gui = c.gui;
        IGameController controller = gui == null ? null : gui.getGameController();
        if (controller == null) {
            c.session.send(error("No match is running"));
            return;
        }
        String action = msg.has("action") ? msg.get("action").getAsString() : "";
        int id = msg.has("id") ? msg.get("id").getAsInt() : -1;
        switch (action) {
            case "ok" -> controller.selectButtonOk();
            case "cancel" -> controller.selectButtonCancel();
            case "card" -> {
                CardView card = gui.cardById(id);
                if (card == null || !controller.selectCard(card, null, null)) gui.flashIncorrectAction();
            }
            case "player" -> {
                PlayerView player = gui.playerById(id);
                if (player != null) controller.selectPlayer(player, null);
            }
            case "undo" -> controller.undoLastAction();
            case "attackAll" -> controller.alphaStrike();
            // Forge's own flow: the first call asks and concedes; once the player is out, the next one
            // ends the game for the AIs left playing each other.
            case "concede" -> gui.runWhenAwaitingInput(gui::concede);
            case "leave" -> gui.concede();
            default -> c.session.send(error("Unknown action: " + action));
        }
        gui.markDirty();
    }

    @Override
    public void onError(WebSocket conn, Exception ex) {
        ex.printStackTrace();
        if (conn == null) {
            started.countDown(); // bind failed; let awaitPort return so Main doesn't hang
        }
    }

    private JsonObject engineInfo() {
        JsonObject o = new JsonObject();
        o.addProperty("type", "engineInfo");
        o.addProperty("version", Main.VERSION);
        o.addProperty("imageBase", imageBase);
        o.addProperty("language", settings.language());
        o.addProperty("skin", settings.skin());
        o.add("phaseStops", settings.phaseStopsJson());
        JsonArray phaseOptions = new JsonArray();
        Settings.PHASES.forEach(phaseOptions::add);
        o.add("phaseOptions", phaseOptions);
        JsonArray languages = new JsonArray();
        Settings.LANGUAGES.forEach((code, name) -> {
            JsonObject l = new JsonObject();
            l.addProperty("code", code);
            l.addProperty("name", name);
            languages.add(l);
        });
        o.add("languages", languages);
        o.addProperty("cards", FModel.getMagicDb().getCommonCards().getUniqueCards().size());
        o.addProperty("editions", FModel.getMagicDb().getEditions().size());
        return o;
    }

    private static JsonObject decks() {
        JsonObject o = new JsonObject();
        o.addProperty("type", "decks");
        JsonArray mine = new JsonArray();
        MatchStarter.myDeckNames().forEach(mine::add);
        o.add("mine", mine);
        JsonArray precons = new JsonArray();
        MatchStarter.commanderPreconNames().forEach(precons::add);
        o.add("commander", precons);
        return o;
    }

    private static String string(JsonObject msg, String key) {
        return msg.has(key) && !msg.get(key).isJsonNull() ? msg.get(key).getAsString() : null;
    }

    private static JsonObject error(String message) {
        JsonObject o = new JsonObject();
        o.addProperty("type", "error");
        o.addProperty("message", message);
        return o;
    }
}
