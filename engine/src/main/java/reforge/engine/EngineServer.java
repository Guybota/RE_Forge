package reforge.engine;

import java.net.InetSocketAddress;
import java.util.ArrayList;
import java.util.List;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

import org.java_websocket.WebSocket;
import org.java_websocket.handshake.ClientHandshake;
import org.java_websocket.server.WebSocketServer;

import com.google.gson.Gson;
import com.google.gson.JsonArray;
import com.google.gson.JsonElement;
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
        /** This connection's draft in progress (events themselves are saved by Forge). */
        final Limited limited = new Limited();
        final DeckImageLanguages deckLanguages = new DeckImageLanguages();

        Connection(WebSocket socket) {
            session = new Session(socket);
        }
    }

    private final String imageBase;
    private final Settings settings;
    private final Campaigns campaigns;
    @FunctionalInterface
    interface MatchFactory {
        HostedMatch start(WebGuiGame gui, String deck, String source, int opponents, java.util.List<String> aiProfiles);
    }
    private final MatchFactory matches;

    public EngineServer(InetSocketAddress address, String imageBase, Settings settings) {
        this(address, imageBase, settings, MatchStarter::startCommander);
    }

    EngineServer(InetSocketAddress address, String imageBase, Settings settings, MatchFactory matches) {
        super(address);
        this.imageBase = imageBase;
        this.settings = settings;
        MatchStarter.aiProfile = settings.aiProfile();
        MatchStarter.aiTimeout = settings.aiTimeout();
        this.matches = matches;
        this.campaigns = new Campaigns(imageBase);
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
        c.deckLanguages.close();
        c.actions.execute(() -> {
            try {
                if (c.gui != null && c.gui.getGameView() != null && c.gui.getGameView().isMatchOver()) campaigns.finish(c.session, c.gui.getGameView());
                campaigns.close(c.session);
            } catch (Exception e) { e.printStackTrace(); }
        });
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
            case "listDecks" -> c.actions.execute(() -> c.session.send(decks()));
            case "cancelDeckLanguage" -> c.actions.execute(c.deckLanguages::cancel);
            case "deckLanguage" -> c.actions.execute(() -> {
                String name = string(msg, "name"), source = string(msg, "source");
                c.deckLanguages.start(msg.get("requestId").getAsInt(), name, source, settings.language(),
                        DeckImageLanguages.entries(DeckSelection.find(name, source)), c.session::send);
            });
            case "previewDeck" -> c.actions.execute(() -> {
                JsonObject preview = DeckImporter.preview(string(msg, "text"), string(msg, "name")).json();
                if (msg.has("requestId")) preview.addProperty("requestId", string(msg, "requestId"));
                c.session.send(preview);
            });
            case "saveDeck" -> c.actions.execute(() -> {
                String problem = DeckImporter.save(string(msg, "text"), string(msg, "name"), string(msg, "from"));
                c.session.send(problem == null ? decks() : error(problem));
            });
            case "chooseCommander" -> c.actions.execute(() -> c.session.send(
                    deckText(DeckImporter.chooseCommander(string(msg, "text"), string(msg, "name")), null)));
            case "fetchDeck" -> c.actions.execute(() -> {
                try {
                    DeckLinks.Deck deck = DeckLinks.fetch(string(msg, "url"));
                    c.session.send(deckText(deck.text(), deck.name()));
                } catch (DeckLinks.Problem e) {
                    JsonObject failure = error(e.getMessage());
                    failure.addProperty("code", e.code);
                    c.session.send(failure);
                }
            });
            case "limited" -> c.actions.execute(() -> limitedAction(c, msg));
            case "puzzles" -> c.actions.execute(() -> c.session.send(Puzzles.list()));
            case "startPuzzle" -> c.actions.execute(() -> startLocal(c, gui -> Puzzles.start(gui, string(msg, "id"))));
            case "searchCards" -> c.actions.execute(() -> c.session.send(CardCatalog.search(msg)));
            case "getPrintings" -> c.actions.execute(() -> c.session.send(CardCatalog.printings(string(msg, "name"))));
            case "getDeck" -> c.actions.execute(() -> {
                JsonObject detail = DeckImporter.detail(string(msg, "name"));
                c.session.send(detail != null ? detail : error("Unknown deck"));
            });
            case "renameDeck" -> c.actions.execute(() -> {
                String problem = DeckImporter.rename(string(msg, "name"), string(msg, "to"));
                c.session.send(problem == null ? decks() : error(problem));
            });
            case "deckPrices", "cheaperPrintings", "deckCombos", "comboDetail" -> services(c, msg);
            case "setDeckMeta" -> c.actions.execute(() -> {
                List<String> tags = new ArrayList<>();
                if (msg.has("tags")) msg.getAsJsonArray("tags").forEach(t -> tags.add(t.getAsString()));
                String name = string(msg, "name");
                String problem = DeckImporter.setMeta(name, tags, string(msg, "notes"),
                        msg.has("bracketIntent") ? msg.get("bracketIntent").getAsInt() : 0);
                c.session.send(problem == null ? DeckImporter.detail(name) : error(problem));
            });
            case "deleteDeck" -> c.actions.execute(() -> {
                DeckImporter.delete(string(msg, "name"));
                c.session.send(decks());
            });
            case "setLanguage" -> c.actions.execute(() -> setLanguage(c, msg));
            case "setSkin" -> setSkin(c, msg);
            case "setPhaseStops" -> c.actions.execute(() -> setPhaseStops(c, msg));
            case "setAiOptions" -> c.actions.execute(() -> setAiOptions(c, msg));
            case "startMatch", "startDeckMatch" -> c.actions.execute(() -> startMatch(c, msg));
            case "campaign" -> c.actions.execute(() -> campaignAction(c, msg));
            case "hostGame", "joinGame" -> c.actions.execute(() -> openOnline(c, msg));
            case "setSlot", "setReady", "addSlot", "removeSlot", "kickPlayer", "startOnlineMatch", "chat", "leaveLobby" ->
                    c.actions.execute(() -> onlineAction(c, msg));
            case "action" -> c.actions.execute(() -> action(c, msg));
            case "answer" -> c.session.onAnswer(msg);
            default -> c.session.send(error("Unknown type: " + msg.get("type").getAsString()));
        }
    }

    private void campaignAction(Connection c, JsonObject msg) {
        try {
            if (HeadlessGui.hasOnline() || c.gui != null && !c.gui.isFinishedForLocalPlayer()) throw new IllegalArgumentException("Leave the current match or lobby first");
            if ("duel".equals(string(msg, "action"))) {
                if (c.gui != null) { c.gui.dispose(); c.gui = null; }
                WebGuiGame gui = new WebGuiGame(c.session, settings);
                gui.onFinished(view -> {
                    try {
                        c.actions.execute(() -> {
                            try { campaigns.finish(c.session, view); }
                            catch (Exception e) { e.printStackTrace(); c.session.send(error("Campaign result: " + e.getMessage())); }
                        });
                    } catch (java.util.concurrent.RejectedExecutionException ignored) { /* disconnect settles the pending loss */ }
                });
                c.gui = gui;
                try { c.match = campaigns.start(c.session, gui, string(msg, "target")); }
                catch (Exception e) { c.gui = null; gui.dispose(); throw e; }
            } else campaigns.handle(c.session, msg);
        } catch (Exception e) { e.printStackTrace(); c.session.send(error(e.getMessage())); }
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
            c.session.send(decks());
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
        java.util.List<String> aiProfiles = new java.util.ArrayList<>();
        if (msg.has("aiProfiles") && msg.get("aiProfiles").isJsonArray()) {
            msg.getAsJsonArray("aiProfiles").forEach(p -> aiProfiles.add(p.isJsonNull() ? "" : p.getAsString()));
        }
        WebGuiGame gui = new WebGuiGame(c.session, settings);
        try {
            c.gui = gui;
            c.match = "startDeckMatch".equals(string(msg, "type"))
                    ? MatchStarter.startCommander(gui, DeckImporter.forPlay(string(msg, "text"), string(msg, "name")), opponents, aiProfiles)
                    : matches.start(gui, deck, string(msg, "deckSource"), opponents, aiProfiles);
        } catch (RuntimeException e) {
            c.gui = null;
            gui.dispose();
            e.printStackTrace();
            c.session.send(error("Could not start the match: " + e.getMessage()));
        }
    }

    private void limitedAction(Connection c, JsonObject msg) {
        try {
            String id = string(msg, "id");
            JsonObject reply = switch (string(msg, "action")) {
                case "sets" -> Limited.setList();
                case "events" -> Limited.events();
                case "open" -> Limited.detail(id);
                case "delete" -> Limited.delete(id);
                case "saveDeck" -> Limited.saveDeck(id, msg.getAsJsonArray("main"));
                case "newSealed" -> Limited.newSealed(string(msg, "set"));
                case "newDraft" -> c.limited.newDraft(string(msg, "set"));
                case "draft" -> c.limited.draftState();
                case "pick" -> c.limited.pick(msg.get("index").getAsInt());
                case "play" -> {
                    int opponent = msg.get("opponent").getAsInt();
                    int bestOf = msg.has("bestOf") ? msg.get("bestOf").getAsInt() : 1;
                    WebGuiGame gui = startLocal(c, g -> Limited.start(g, id, opponent, bestOf));
                    if (gui != null) gui.onFinished(view -> {
                        try {
                            c.actions.execute(() -> {
                                try { c.session.send(Limited.finish(id, opponent, view)); }
                                catch (RuntimeException e) { e.printStackTrace(); c.session.send(error(e.getMessage())); }
                            });
                        } catch (java.util.concurrent.RejectedExecutionException ignored) { /* connection closed */ }
                    });
                    yield null;
                }
                default -> throw new IllegalArgumentException("Unknown limited action");
            };
            if (reply != null) c.session.send(reply);
        } catch (RuntimeException e) {
            e.printStackTrace();
            c.session.send(error(e.getMessage()));
        }
    }

    /**
     * Starts a local match against the AI (puzzle, draft, sealed) once nothing else is running. Returns its game
     * window, or null after sending the error.
     */
    private WebGuiGame startLocal(Connection c, java.util.function.Function<WebGuiGame, HostedMatch> starter) {
        if (HeadlessGui.hasOnline()) {
            c.session.send(error("Leave the online lobby first"));
            return null;
        }
        if (c.gui != null) {
            if (!c.gui.isFinishedForLocalPlayer()) {
                c.session.send(error("A match is already running"));
                return null;
            }
            c.gui.dispose();
        }
        WebGuiGame gui = new WebGuiGame(c.session, settings);
        try {
            c.gui = gui;
            c.match = starter.apply(gui);
            return gui;
        } catch (RuntimeException e) {
            c.gui = null;
            gui.dispose();
            e.printStackTrace();
            c.session.send(error(e.getMessage()));
            return null;
        }
    }

    private void openOnline(Connection c, JsonObject msg) {
        // A lobby that closed itself (host gone, kicked) leaves its game window behind; neither blocks a new room.
        if (c.online != null && c.online.isClosed()) { c.online = null; c.gui = null; }
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
            JsonObject failure = error(e.getMessage());
            if (e instanceof RelayTunnel.Problem problem) failure.addProperty("code", problem.code);
            c.session.send(failure);
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

    /** The default AI profile and its thinking time; they apply from the next game on. */
    private void setAiOptions(Connection c, JsonObject msg) {
        try {
            int timeout = msg.has("timeout") ? msg.get("timeout").getAsInt() : settings.aiTimeout();
            String profile = msg.has("profile") ? string(msg, "profile") : settings.aiProfile();
            settings.changeAi(profile, timeout, MatchStarter.aiProfiles());
            MatchStarter.aiProfile = profile;
            MatchStarter.aiTimeout = timeout;
            c.session.send(engineInfo());
        } catch (IllegalArgumentException | java.io.IOException e) {
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
            case "fastForward" -> {
                if (!msg.has("enabled") || !msg.get("enabled").isJsonPrimitive() || !msg.getAsJsonPrimitive("enabled").isBoolean()) {
                    c.session.send(error("Expected a boolean enabled flag"));
                    return;
                }
                gui.setFastForward(msg.get("enabled").getAsBoolean());
            }
            case "ok" -> { gui.clearPromptCard(); controller.selectButtonOk(); }
            case "cancel" -> { gui.clearPromptCard(); controller.selectButtonCancel(); }
            case "card" -> {
                CardView card = gui.cardById(id);
                if (card == null || !controller.selectCard(card, null, null)) gui.flashIncorrectAction();
            }
            case "player" -> {
                PlayerView player = gui.playerById(id);
                if (player != null) controller.selectPlayer(player, null);
            }
            case "undo" -> controller.undoLastAction();
            // Between games of a match: ready for the next one (Forge starts it once every human is).
            case "nextGame" -> controller.nextGameDecision(forge.gamemodes.match.NextGameDecision.CONTINUE);
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
        o.addProperty("relayAvailable", !RelayTunnel.configuredUrl().isBlank());
        o.addProperty("imageBase", imageBase);
        o.addProperty("language", settings.language());
        o.addProperty("skin", settings.skin());
        o.add("phaseStops", settings.phaseStopsJson());
        JsonArray phaseOptions = new JsonArray();
        Settings.PHASES.forEach(phaseOptions::add);
        o.add("phaseOptions", phaseOptions);
        JsonArray aiProfiles = new JsonArray();
        MatchStarter.aiProfiles().forEach(aiProfiles::add);
        o.add("aiProfiles", aiProfiles);
        JsonObject ai = new JsonObject();
        ai.addProperty("profile", settings.aiProfile());
        ai.addProperty("timeout", settings.aiTimeout());
        JsonArray timeouts = new JsonArray();
        Settings.AI_TIMEOUTS.forEach(timeouts::add);
        ai.add("timeouts", timeouts);
        o.add("ai", ai);
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
        o.add("summaries", DeckSelection.summaries());
        return o;
    }

    private static String string(JsonObject msg, String key) {
        return msg.has(key) && !msg.get(key).isJsonNull() ? msg.get(key).getAsString() : null;
    }

    /** A decklist for the import screen to show and check: a fetched link or a list with a new commander. */
    private static JsonObject deckText(String text, String name) {
        JsonObject o = new JsonObject();
        o.addProperty("type", "deckText");
        o.addProperty("text", text);
        if (name != null && !name.isBlank()) o.addProperty("name", name);
        return o;
    }

    /**
     * Deck tools' online lookups (prices, cheaper printings, combos), answered with the request's type and
     * requestId; a failure answers {@code servicesError} so the UI says "unavailable" instead of "none".
     */
    private static void services(Connection c, JsonObject msg) {
        String type = string(msg, "type"), name = string(msg, "name");
        JsonElement requestId = msg.get("requestId");
        DeckServices.WORK.execute(() -> {
            JsonObject reply;
            try {
                if (type.equals("comboDetail")) {
                    reply = DeckServices.comboDetail(string(msg, "href"));
                    reply.addProperty("href", string(msg, "href"));
                } else {
                    forge.deck.Deck deck = DeckImporter.mine().get(name);
                    if (deck == null) throw new IllegalArgumentException("Unknown deck: " + name);
                    reply = switch (type) {
                        case "deckPrices" -> DeckServices.prices(deck);
                        case "cheaperPrintings" -> {
                            int[] total = {0};
                            yield DeckServices.cheaper(deck, n -> total[0] = n, done -> {
                                JsonObject p = new JsonObject();
                                p.addProperty("type", "cheaperProgress");
                                p.add("requestId", requestId);
                                p.addProperty("done", done);
                                p.addProperty("total", total[0]);
                                c.session.send(p);
                            });
                        }
                        default -> {
                            List<String> commanders = new ArrayList<>();
                            if (deck.has(forge.deck.DeckSection.Commander)) {
                                deck.get(forge.deck.DeckSection.Commander).toFlatList().forEach(pc -> commanders.add(pc.getName()));
                            }
                            yield DeckServices.combos(commanders);
                        }
                    };
                    reply.addProperty("name", name);
                }
                reply.addProperty("type", type);
            } catch (RuntimeException e) {
                reply = new JsonObject();
                reply.addProperty("type", "servicesError");
                reply.addProperty("service", type);
                reply.addProperty("unavailable", e instanceof DeckServices.Unavailable);
                reply.addProperty("message", String.valueOf(e.getMessage()));
                if (!(e instanceof DeckServices.Unavailable) && !(e instanceof IllegalArgumentException)) e.printStackTrace();
            }
            reply.add("requestId", requestId);
            c.session.send(reply);
        });
    }

    private static JsonObject error(String message) {
        JsonObject o = new JsonObject();
        o.addProperty("type", "error");
        o.addProperty("message", message);
        return o;
    }
}
