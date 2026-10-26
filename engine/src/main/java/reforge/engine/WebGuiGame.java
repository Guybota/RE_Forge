package reforge.engine;

import java.util.ArrayList;
import java.util.Collection;
import java.util.LinkedHashMap;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.concurrent.Executors;
import java.util.concurrent.ScheduledExecutorService;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicBoolean;

import com.google.gson.JsonArray;
import com.google.gson.JsonElement;
import com.google.gson.JsonObject;
import com.google.common.eventbus.Subscribe;

import forge.LobbyPlayer;
import forge.deck.CardPool;
import forge.game.GameEntityView;
import forge.game.GameView;
import forge.game.Game;
import forge.game.event.GameEvent;
import forge.game.event.GameEventFlipCoin;
import forge.game.card.CardView;
import forge.game.phase.PhaseType;
import forge.game.player.DelayedReveal;
import forge.game.player.IHasIcon;
import forge.game.player.PlayerView;
import forge.game.spellability.SpellAbilityView;
import forge.gamemodes.net.NetworkGuiGame;
import forge.gamemodes.net.client.FGameClient;
import forge.gamemodes.match.Selection;
import forge.gamemodes.match.YieldUpdate;
import forge.gui.interfaces.IGuiGame;
import forge.interfaces.IGameController;
import forge.item.PaperCard;
import forge.localinstance.properties.ForgePreferences.FPref;
import forge.localinstance.skin.FSkinProp;
import forge.model.FModel;
import forge.player.PlayerZoneUpdate;
import forge.trackable.TrackableCollection;
import forge.util.FSerializableFunction;
import forge.util.ITriggerEvent;
import forge.util.Localizer;

/**
 * Forge's view of "the screen" for the local human. Board changes are batched into "state"
 * messages; every decision Forge needs is sent as a "choice" and the game thread waits for the
 * UI's "answer".
 */
final class WebGuiGame extends NetworkGuiGame {
    private static final long PUSH_DELAY_MS = 40;

    private final Session session;
    private final Settings settings;
    private final ScheduledExecutorService pusher = Executors.newSingleThreadScheduledExecutor(r -> {
        Thread t = new Thread(r, "state-push");
        t.setDaemon(true);
        return t;
    });
    private final AtomicBoolean pushScheduled = new AtomicBoolean();
    private volatile boolean disposed;
    private java.util.function.Consumer<GameView> finishListener;
    private final AtomicBoolean finishReported = new AtomicBoolean();

    void onFinished(java.util.function.Consumer<GameView> listener) { finishListener = listener; }
    private void reportFinished() {
        GameView game = getGameView();
        if (finishListener != null && game != null && game.isGameOver() && game.isMatchOver() && finishReported.compareAndSet(false, true)) finishListener.accept(game);
    }

    private volatile GameSnapshot.Prompt prompt = GameSnapshot.Prompt.NONE;
    private volatile GameSnapshot lastSnapshot;
    private volatile CardView promptCard;
    CardView promptCard() { return promptCard; }
    void clearPromptCard() { promptCard = null; }
    private Game coinGame;
    private int openingCoinGameId = -1;

    WebGuiGame(Session session, Settings settings) {
        this.session = session;
        this.settings = settings;
    }

    // ---------------------------------------------------------------- state pushing

    /** Schedules one state message for shortly after a burst of changes. */
    void markDirty() {
        if (disposed) return;
        if (pushScheduled.compareAndSet(false, true)) {
            try {
                pusher.schedule(this::pushState, PUSH_DELAY_MS, TimeUnit.MILLISECONDS);
            } catch (java.util.concurrent.RejectedExecutionException ignored) { }
        }
    }

    private void pushState() {
        pushScheduled.set(false);
        pushStateNow();
    }

    /**
     * Reads the live game graph. Forge's own desktop GUI reads it from the Swing thread while the
     * game runs, so a concurrent read is expected; if one trips over a change, try again shortly.
     */
    void pushStateNow() {
        if (disposed) return;
        GameView game = getGameView();
        if (game == null) return;
        // A remote client gets no updateTurn, only the new view.
        syncAutoPass();
        syncFastForward();
        try {
            GameSnapshot snapshot = new GameSnapshot(game, this, prompt);
            snapshot.json.addProperty("fastForward", fastForwardController != null);
            if (puzzle != null) snapshot.json.add("puzzle", puzzle);
            lastSnapshot = snapshot;
            session.send(snapshot.json);
        } catch (RuntimeException e) {
            markDirty();
        }
    }

    CardView cardById(int id) {
        GameSnapshot s = lastSnapshot;
        return s == null ? null : s.cards.get(id);
    }

    PlayerView playerById(int id) {
        GameSnapshot s = lastSnapshot;
        return s == null ? null : s.players.get(id);
    }

    /** True once the game is over or every local player is out of it (AIs may still be finishing). */
    boolean isFinishedForLocalPlayer() {
        GameView game = getGameView();
        return game == null || game.isGameOver() || getLocalPlayers().stream().allMatch(PlayerView::getHasLost);
    }

    /** A puzzle's name, goal and limits, shown with the table (its goal card never reaches the views). */
    private volatile JsonObject puzzle;
    void setPuzzle(JsonObject info) { puzzle = info; }

    private volatile Runnable connectionLost;

    /** What to do when the connection to the host is gone for good, or drops while none of our games is running. */
    void onConnectionLost(Runnable action) { connectionLost = action; }

    @Override
    public void onReconnectStateChanged(FGameClient.ReconnectState state, int attemptIndex, int nextDelaySeconds) {
        // Forge keeps retrying for about two minutes; only a running game is worth waiting for.
        boolean lost = switch (state) {
            case FAILED, SEAT_LOST -> true;
            case RECONNECTING -> isFinishedForLocalPlayer();
            case CONNECTED -> false;
        };
        Runnable action = connectionLost;
        if (lost && action != null) { action.run(); return; }
        // During a game Forge reconnects by itself (through the relay too): say so, or the table just looks frozen.
        JsonObject connection = new JsonObject();
        connection.addProperty("type", "connection");
        connection.addProperty("reconnecting", state == FGameClient.ReconnectState.RECONNECTING);
        session.send(connection);
    }

    void dispose() {
        setFastForward(false);
        disposed = true;
        super.afterGameEnd();
        session.cancelQuestions();
        pusher.shutdownNow();
    }

    @Override protected void afterDeltaApplied() { markDirty(); }

    @Override public void setGameView(GameView gameView) {
        super.setGameView(gameView);
        // Local games deliver the actual toss through their EventBus, before play/draw and mulligans.
        Game game = gameView == null ? null : gameView.getGame();
        if (game != null && game != coinGame) { coinGame = game; game.subscribeToEvents(this); }
        markDirty();
    }

    @Subscribe
    public synchronized void openingCoin(GameEventFlipCoin event) {
        GameView game = getGameView();
        if (disposed || game == null || !event.startingToss() || openingCoinGameId == game.getId()) return;
        openingCoinGameId = game.getId();
        JsonObject toss = new JsonObject();
        toss.addProperty("type", "openingCoin");
        toss.addProperty("gameId", game.getId());
        toss.addProperty("winnerId", event.flipper().getId());
        toss.addProperty("winnerName", event.flipper().getName());
        session.send(toss);
        // Mount the table even when the event precedes its first debounced snapshot.
        pushStateNow();
    }

    @Override public void handleGameEvent(GameEvent event) {
        // Guests receive the same native event from Forge's netplay stream, not a local EventBus.
        if (event instanceof GameEventFlipCoin toss) openingCoin(toss);
        super.handleGameEvent(event);
    }
    @Override protected void updateCurrentPlayer(PlayerView player) { markDirty(); }
    @Override public void openView(TrackableCollection<PlayerView> myPlayers) {
        seedYieldStateOnHost();
        markDirty();
    }
    @Override public void showCombat() { markDirty(); }
    @Override public void updatePhase(boolean saveState) { markDirty(); }
    @Override public void updateTurn(PlayerView player) { syncAutoPass(); markDirty(); }
    @Override public void updateStack() { markDirty(); }
    @Override public void updateZones(Iterable<PlayerZoneUpdate> zonesToUpdate) { markDirty(); }
    @Override public void updateCards(Iterable<CardView> cards) { markDirty(); }
    @Override public void updateLives(Iterable<PlayerView> livesUpdate) { markDirty(); }
    @Override public void updateManaPool(Iterable<PlayerView> manaPoolUpdate) { markDirty(); }
    @Override public void refreshField() { markDirty(); }
    @Override public void finishGame() { pushStateNow(); reportFinished(); }
    @Override public void afterGameEnd() { super.afterGameEnd(); pushStateNow(); reportFinished(); }

    // ---------------------------------------------------------------- prompt bar

    @Override
    public void showPromptMessage(PlayerView playerView, String message, CardView card) {
        promptCard = card;
        GameSnapshot.Prompt p = prompt;
        prompt = new GameSnapshot.Prompt(withoutStatusLines(message), p.ok(), p.cancel(), p.okEnabled(), p.cancelEnabled(), p.selection());
        markDirty();
    }

    /**
     * Forge's priority prompt starts with "Priority: … / Turn: … / Phase: … / Stack: …" lines
     * (InputBase.getTurnPhasePriorityMessage), which the table already shows. Drop them, in
     * whatever language Forge is using.
     */
    private static String withoutStatusLines(String message) {
        if (message == null) return "";
        Localizer l = Localizer.getInstance();
        List<String> prefixes = List.of(l.getMessage("lblPriority") + ":", l.getMessage("lblTurn") + ":",
                l.getMessage("lblPhase") + ":", l.getMessage("lblStack") + ":");
        StringBuilder sb = new StringBuilder();
        for (String line : message.split("\n")) {
            String trimmed = line.trim();
            if (trimmed.isEmpty() || prefixes.stream().anyMatch(trimmed::startsWith)) continue;
            if (sb.length() > 0) sb.append('\n');
            sb.append(trimmed);
        }
        return sb.toString();
    }

    @Override
    public void updateButtons(PlayerView owner, String label1, String label2, boolean enable1, boolean enable2, boolean focus1) {
        // Remote awaitNextInput is delayed by Forge. Cancel it when the next prompt arrives,
        // otherwise its timer can disable the freshly enabled buttons and stall the match.
        if (enable1 || enable2) cancelAwaitNextInput();
        GameSnapshot.Prompt p = prompt;
        prompt = new GameSnapshot.Prompt(p.message(), label1, label2, enable1, enable2, p.selection());
        markDirty();
        Runnable pending = whenAwaitingInput;
        if ((enable1 || enable2) && pending != null) {
            whenAwaitingInput = null;
            pending.run(); // on the game thread, which is about to wait for us anyway
        }
    }

    private volatile Runnable whenAwaitingInput;

    /**
     * Runs {@code task} now if the game is waiting on the local player, otherwise as soon as it is.
     * Some actions (conceding) change game state directly and would race the game thread mid-turn.
     */
    void runWhenAwaitingInput(Runnable task) {
        GameSnapshot.Prompt p = prompt;
        if (p.okEnabled() || p.cancelEnabled()) {
            task.run();
        } else {
            whenAwaitingInput = task;
        }
    }

    @Override
    public void setSelection(Selection selection) {
        super.setSelection(selection);
        GameSnapshot.Prompt p = prompt;
        prompt = new GameSnapshot.Prompt(p.message(), p.ok(), p.cancel(), p.okEnabled(), p.cancelEnabled(), selection);
        markDirty();
    }

    // Forge marks the cards you can use right now (playable, can attack, can block) as "weakly selectable".
    @Override public void setWeaklySelectable(Iterable<CardView> cards) { super.setWeaklySelectable(cards); markDirty(); }
    @Override public void clearWeaklySelectable() { super.clearWeaklySelectable(); markDirty(); }

    @Override public void flashIncorrectAction() { notice("incorrectAction", null); }
    @Override public void alertUser() { notice("alert", null); }
    @Override public void message(String message, String title) { notice("message", message); }
    @Override public void showErrorDialog(String message, String title) { notice("error", message); }

    private void notice(String kind, String text) {
        JsonObject o = new JsonObject();
        o.addProperty("type", "notice");
        o.addProperty("kind", kind);
        o.addProperty("text", text);
        session.send(o);
    }

    // ---------------------------------------------------------------- questions

    /** Sends the current board first so the question never refers to cards the UI hasn't seen. */
    private JsonObject ask(String kind, String title, JsonObject extra) {
        if (disposed) return null;
        pushStateNow();
        JsonObject q = extra == null ? new JsonObject() : extra;
        q.addProperty("type", "choice");
        q.addProperty("kind", kind);
        q.addProperty("title", title);
        return session.ask(q);
    }

    private JsonObject askValidated(String kind, String title, JsonObject prompt,
                                    java.util.function.Predicate<JsonObject> valid) {
        while (!disposed && !session.isClosed()) {
            JsonObject answer = ask(kind, title, prompt);
            if (answer == null || valid.test(answer)) return answer;
            prompt.addProperty("invalid", true);
        }
        return null;
    }

    private <T> JsonArray options(Collection<T> items, FSerializableFunction<T, String> display) {
        return options(items, display, false);
    }

    private <T> JsonArray options(Collection<T> items, FSerializableFunction<T, String> display, boolean revealed) {
        JsonArray arr = new JsonArray();
        for (T item : items) {
            JsonObject o = new JsonObject();
            if (item instanceof CardView c) {
                o.addProperty("cardId", c.getId());
                JsonObject card = GameSnapshot.describeCard(c, this, revealed);
                o.addProperty("label", card.has("hidden") ? "" : GameSnapshot.name(c.getCurrentState()));
                o.add("card", card);
            } else if (item instanceof PlayerView p) {
                o.addProperty("playerId", p.getId());
                o.addProperty("label", p.getName());
            }
            if (display != null && !(o.has("card") && o.getAsJsonObject("card").has("hidden"))) {
                o.addProperty("label", display.apply(item));
            } else if (!o.has("label")) {
                o.addProperty("label", item instanceof forge.util.ITranslatable translated
                        ? translated.getTranslatedName() : String.valueOf(item));
            }
            arr.add(o);
        }
        return arr;
    }

    /** The answer's "picked" indices, deduplicated and kept in range; empty if there is no usable answer. */
    private static List<Integer> picked(JsonObject answer, int size) {
        Set<Integer> result = new LinkedHashSet<>();
        if (answer != null && answer.has("picked") && answer.get("picked").isJsonArray()) {
            for (JsonElement e : answer.getAsJsonArray("picked")) {
                Integer value = integer(e);
                if (value == null) continue;
                int i = value;
                if (i >= 0 && i < size) result.add(i);
            }
        }
        return new ArrayList<>(result);
    }

    private static Integer integer(JsonElement value) {
        try {
            if (value == null || !value.isJsonPrimitive() || !value.getAsJsonPrimitive().isNumber()) return null;
            return value.getAsBigDecimal().intValueExact();
        } catch (ArithmeticException | NumberFormatException e) { return null; }
    }

    private static int[] integers(JsonObject answer, String field, int size) {
        if (!answer.has(field) || !answer.get(field).isJsonArray()) return null;
        JsonArray array = answer.getAsJsonArray(field);
        if (array.size() != size) return null;
        int[] values = new int[size];
        for (int i = 0; i < size; i++) {
            Integer value = integer(array.get(i));
            if (value == null) return null;
            values[i] = value;
        }
        return values;
    }

    private static boolean validPicks(JsonObject answer, int size, int min, int max) {
        if (!answer.has("picked") || !answer.get("picked").isJsonArray()) return false;
        JsonArray values = answer.getAsJsonArray("picked");
        Set<Integer> seen = new LinkedHashSet<>();
        for (JsonElement element : values) {
            Integer index = integer(element);
            if (index == null || index < 0 || index >= size || !seen.add(index)) return false;
        }
        return seen.size() >= Math.max(0, min) && (max < 0 || seen.size() <= max);
    }

    private static <T> List<T> select(List<T> items, List<Integer> indices) {
        List<T> result = new ArrayList<>(indices.size());
        for (int i : indices) result.add(items.get(i));
        return result;
    }

    /** Asks for between min and max items. min < 0 means the list is only being shown. */
    private <T> List<T> chooseFrom(String kind, String title, int min, int max, List<T> items, List<T> preselected,
                                   FSerializableFunction<T, String> display) {
        JsonObject q = new JsonObject();
        q.addProperty("min", min);
        q.addProperty("max", max);
        q.add("options", options(items, display, min < 0));
        Localizer labels = Localizer.getInstance();
        if (title.equals(labels.getMessage("lblSelectCardsToBePutIntoTheGraveyard"))) q.addProperty("placement", "graveyard");
        else if (title.equals(labels.getMessage("lblSelectCardsToBeOutOnTheBottomOfYourLibrary"))) q.addProperty("placement", "bottom");
        else if (title.equals(labels.getMessage("lblArrangeCardsToBePutOnTopOfYourLibrary"))) q.addProperty("placement", "top");
        if (preselected != null) {
            JsonArray pre = new JsonArray();
            Set<Integer> indices = new LinkedHashSet<>();
            preselected.forEach(item -> { int index = items.indexOf(item); if (index >= 0) indices.add(index); });
            indices.forEach(pre::add);
            q.add("preselected", pre);
        }
        JsonObject answer = askValidated(kind, title, q,
                a -> min < 0 || validPicks(a, items.size(), min, max));
        if (min < 0) return new ArrayList<>();
        List<Integer> idx = picked(answer, items.size());
        if (idx.size() < min || (max >= 0 && idx.size() > max)) {
            // Disconnected or invalid: give the smallest legal answer so the game can go on.
            idx = new ArrayList<>();
            for (int i = 0; i < Math.min(min, items.size()); i++) idx.add(i);
        }
        return select(items, idx);
    }

    @Override
    public <T> List<T> getChoices(String message, int min, int max, List<T> choices, List<T> selected, FSerializableFunction<T, String> display) {
        return chooseFrom(min < 0 ? "reveal" : "choose", message, min, max, choices, selected, display);
    }

    @Override
    public <T> IGuiGame.OrderResult<T> order(String title, String top, int remainingObjectsMin, int remainingObjectsMax,
                                             List<T> sourceChoices, List<T> destChoices, CardView referenceCard,
                                             boolean sideboardingMode, boolean showRememberCheckbox) {
        // The UI returns the picked items in order. How many may stay unpicked is
        // [remainingObjectsMin, remainingObjectsMax]; a negative max means "any number".
        List<T> all = new ArrayList<>(sourceChoices);
        if (destChoices != null) all.addAll(destChoices);
        int pickMax = all.size() - Math.max(0, remainingObjectsMin);
        int pickMin = remainingObjectsMax < 0 ? 0 : all.size() - remainingObjectsMax;
        List<T> ordered = chooseFrom("order", title, pickMin, pickMax, all, destChoices, null);
        return new IGuiGame.OrderResult<>(ordered, false);
    }

    @Override
    public boolean confirm(CardView c, String question, boolean defaultIsYes, List<String> options) {
        return yesNo(question, options == null || options.size() < 2 ? List.of(
                Localizer.getInstance().getMessage("lblYes"), Localizer.getInstance().getMessage("lblNo")) : options, defaultIsYes);
    }

    @Override
    public boolean showConfirmDialog(String message, String title, String yesButtonText, String noButtonText, boolean defaultYes) {
        return yesNo(message, List.of(yesButtonText, noButtonText), defaultYes);
    }

    private boolean yesNo(String question, List<String> labels, boolean defaultYes) {
        List<Integer> idx = picked(askValidated("confirm", question, optionsOnly(labels), a -> validPicks(a, labels.size(), 1, 1)), labels.size());
        return idx.isEmpty() ? defaultYes : idx.get(0) == 0;
    }

    private JsonObject optionsOnly(List<String> labels) {
        JsonObject q = new JsonObject();
        q.add("options", options(labels, null));
        q.addProperty("min", 1);
        q.addProperty("max", 1);
        return q;
    }

    @Override
    public int showOptionDialog(String message, String title, FSkinProp icon, List<String> options, int defaultOption) {
        if (options.isEmpty()) return defaultOption;
        List<Integer> idx = picked(askValidated("confirm", message, optionsOnly(options), a -> validPicks(a, options.size(), 1, 1)), options.size());
        return idx.isEmpty() ? defaultOption : idx.get(0);
    }

    @Override
    public String showInputDialog(String message, String title, FSkinProp icon, String initialInput, List<String> inputOptions, boolean isNumeric) {
        if (inputOptions != null && !inputOptions.isEmpty()) {
            return oneOrNone(message, inputOptions);
        }
        JsonObject q = new JsonObject();
        q.addProperty("initial", initialInput);
        q.addProperty("numeric", isNumeric);
        JsonObject answer = askValidated("text", message, q, a -> validText(a, isNumeric, Integer.MIN_VALUE, Integer.MAX_VALUE));
        return answer == null || !answer.has("value") || answer.get("value").isJsonNull() ? null : answer.get("value").getAsString();
    }

    @Override public Integer getInteger(String message, int min, int max, boolean sortDesc) {
        return integerChoice(message, min, max);
    }

    @Override public Integer getInteger(String message, int min, int max, int cutoff) {
        if (cutoff < min) return min;
        return integerChoice(message, min, max);
    }

    private Integer integerChoice(String message, int min, int max) {
        if (max <= min) return min;
        JsonObject q = new JsonObject();
        q.addProperty("numeric", true);
        q.addProperty("numberMin", min);
        q.addProperty("numberMax", max);
        q.addProperty("initial", String.valueOf(min));
        JsonObject answer = askValidated("text", message, q, a -> validText(a, true, min, max));
        return answer == null || answer.get("value").isJsonNull() ? null : Integer.valueOf(answer.get("value").getAsString());
    }

    private static boolean validText(JsonObject answer, boolean numeric, int min, int max) {
        if (!answer.has("value")) return false;
        JsonElement value = answer.get("value");
        if (value.isJsonNull()) return true;
        if (!value.isJsonPrimitive() || !value.getAsJsonPrimitive().isString()) return false;
        if (!numeric) return true;
        try {
            int n = Integer.parseInt(value.getAsString());
            return n >= min && n <= max;
        } catch (NumberFormatException e) { return false; }
    }

    @Override public <T> List<T> insertInList(String title, T newItem, List<T> oldItems) {
        List<T> all = new ArrayList<>(oldItems);
        all.add(newItem);
        return chooseFrom("order", title, all.size(), all.size(), all, null, null);
    }

    @Override
    public SpellAbilityView getAbilityToPlay(CardView hostCard, List<SpellAbilityView> abilities, ITriggerEvent triggerEvent) {
        if (abilities.isEmpty()) return null;
        if (abilities.size() == 1) return abilities.get(0); // a click on a card with one thing to do just does it
        List<SpellAbilityView> chosen = chooseFrom("choose", GameSnapshot.name(hostCard.getCurrentState()), 0, 1, abilities, null, null);
        return chosen.isEmpty() ? null : chosen.get(0);
    }

    @Override
    public GameEntityView chooseSingleEntityForEffect(String title, List<? extends GameEntityView> optionList, DelayedReveal delayedReveal, boolean isOptional) {
        if (delayedReveal != null) reveal(delayedReveal.getMessagePrefix(), new ArrayList<>(delayedReveal.getCards()));
        if (optionList.isEmpty()) return null;
        List<GameEntityView> chosen = chooseFrom("choose", title, isOptional ? 0 : 1, 1, new ArrayList<>(optionList), null, null);
        return chosen.isEmpty() ? null : chosen.get(0);
    }

    @Override
    public List<GameEntityView> chooseEntitiesForEffect(String title, List<? extends GameEntityView> optionList, int min, int max, DelayedReveal delayedReveal) {
        if (delayedReveal != null) reveal(delayedReveal.getMessagePrefix(), new ArrayList<>(delayedReveal.getCards()));
        return chooseFrom("choose", title, min, max, new ArrayList<>(optionList), null, null);
    }

    @Override
    public List<CardView> manipulateCardList(String title, Iterable<CardView> cards, Iterable<CardView> manipulable, boolean toTop, boolean toBottom, boolean toAnywhere) {
        List<CardView> all = new ArrayList<>();
        cards.forEach(all::add);
        Set<CardView> movable = new LinkedHashSet<>();
        manipulable.forEach(movable::add);
        JsonObject q = new JsonObject();
        q.add("options", options(all, null));
        JsonArray indices = new JsonArray();
        for (int i = 0; i < all.size(); i++) if (movable.contains(all.get(i))) indices.add(i);
        q.add("movable", indices);
        q.addProperty("toTop", toTop);
        q.addProperty("toBottom", toBottom);
        q.addProperty("toAnywhere", toAnywhere);
        JsonObject answer = askValidated("arrange", title, q, a -> {
            if (!validPicks(a, all.size(), all.size(), all.size())) return false;
            List<CardView> result = select(all, picked(a, all.size()));
            List<CardView> fixed = all.stream().filter(c -> !movable.contains(c)).toList();
            if (!result.stream().filter(c -> !movable.contains(c)).toList().equals(fixed)) return false;
            if (toAnywhere) return true;
            int firstFixed = -1, lastFixed = -1;
            for (int i = 0; i < result.size(); i++) if (!movable.contains(result.get(i))) {
                if (firstFixed < 0) firstFixed = i;
                lastFixed = i;
            }
            for (int i = 0; i < result.size(); i++) if (movable.contains(result.get(i))) {
                if (firstFixed < 0 || i < firstFixed && toTop || i > lastFixed && toBottom) continue;
                if (!result.equals(all)) return false;
            }
            return true;
        });
        return answer == null ? all : select(all, picked(answer, all.size()));
    }

    @Override
    public Map<CardView, Integer> assignCombatDamage(CardView attacker, List<CardView> blockers, int damage, GameEntityView defender, boolean overrideOrder, boolean maySkip) {
        // Forge reads the null key as "damage to the defending player/planeswalker" (trample).
        List<Object> targets = new ArrayList<>(blockers);
        var state = attacker.getCurrentState();
        boolean free = state.hasDivideDamage() && overrideOrder;
        boolean includeDefender = defender != null && (state.hasTrample() || free);
        if (includeDefender) targets.add(defender);
        if (damage <= 0 || targets.isEmpty()) return Map.of();
        int[] lethal = new int[targets.size()];
        for (int i = 0; i < blockers.size(); i++) {
            CardView blocker = blockers.get(i);
            int n = Math.max(0, blocker.getLethalDamage());
            if (blocker.getCurrentState().isPlaneswalker()) n = Integer.parseInt(blocker.getCurrentState().getLoyalty());
            else if (state.hasDeathtouch()) n = Math.min(n, 1);
            lethal[i] = n;
        }
        int[] maximums = new int[targets.size()];
        java.util.Arrays.fill(maximums, damage);
        AmountAssignment rules = new AmountAssignment(damage, new int[targets.size()], maximums, lethal,
                !overrideOrder, free, includeDefender ? targets.size() - 1 : -1);
        int[] amounts = amounts(GameSnapshot.name(state), targets, rules, maySkip);
        if (amounts == null) return null;
        Map<CardView, Integer> result = new LinkedHashMap<>();
        for (int i = 0; i < blockers.size(); i++) result.put(blockers.get(i), amounts[i]);
        if (includeDefender) result.put(null, amounts[blockers.size()]);
        return result;
    }

    @Override
    public Map<Object, Integer> assignGenericAmount(CardView effectSource, Map<Object, Integer> target, int amount, boolean atLeastOne, String amountLabel) {
        List<Object> keys = new ArrayList<>(target.keySet());
        if (amount <= 0 || keys.isEmpty()) return Map.of();
        int[] minimums = new int[keys.size()], maximums = new int[keys.size()];
        for (int i = 0; i < keys.size(); i++) {
            minimums[i] = atLeastOne ? 1 : 0;
            maximums[i] = target.get(keys.get(i)) == null ? amount : target.get(keys.get(i));
        }
        AmountAssignment rules = new AmountAssignment(amount, minimums, maximums, null, false, true, -1);
        int[] amounts = amounts(amountLabel + ": " + GameSnapshot.name(effectSource.getCurrentState()), keys, rules, false);
        Map<Object, Integer> result = new LinkedHashMap<>();
        for (int i = 0; i < keys.size(); i++) result.put(keys.get(i), amounts[i]);
        return result;
    }

    private int[] amounts(String title, List<Object> targets, AmountAssignment rules, boolean maySkip) {
        JsonObject q = new JsonObject();
        rules.describe(q);
        q.addProperty("maySkip", maySkip);
        q.add("options", options(targets, null));
        JsonObject answer = askValidated("amounts", title, q,
                a -> maySkip && skipping(a)
                        || rules.valid(integers(a, "amounts", targets.size())));
        if (answer != null && maySkip && skipping(answer)) return null;
        return answer == null ? rules.suggested() : integers(answer, "amounts", targets.size());
    }

    private static boolean skipping(JsonObject answer) {
        return answer.has("skip") && answer.get("skip").isJsonPrimitive()
                && answer.get("skip").getAsJsonPrimitive().isBoolean() && answer.get("skip").getAsBoolean();
    }

    /**
     * Between games of a match: every printing with its copies in the deck and in the sideboard; the answer's
     * "amounts" say how many of each go in the deck. Forge checks the deck size and asks again if it's wrong.
     */
    @Override
    public List<PaperCard> sideboard(CardPool sideboard, CardPool main, String message) {
        Map<PaperCard, int[]> counts = new LinkedHashMap<>();
        for (Map.Entry<PaperCard, Integer> e : main) counts.computeIfAbsent(e.getKey(), k -> new int[2])[0] += e.getValue();
        for (Map.Entry<PaperCard, Integer> e : sideboard) counts.computeIfAbsent(e.getKey(), k -> new int[2])[1] += e.getValue();
        List<PaperCard> cards = new ArrayList<>(counts.keySet());
        JsonArray entries = new JsonArray();
        for (PaperCard card : cards) {
            JsonObject entry = CardCatalog.card(card);
            entry.addProperty("main", counts.get(card)[0]);
            entry.addProperty("side", counts.get(card)[1]);
            entries.add(entry);
        }
        JsonObject q = new JsonObject();
        q.add("cards", entries);
        q.addProperty("deckSize", main.countAll());
        JsonObject answer = askValidated("sideboard", message == null ? "" : message, q, a -> {
            int[] amounts = integers(a, "amounts", cards.size());
            if (amounts == null) return false;
            for (int i = 0; i < amounts.length; i++) {
                int[] c = counts.get(cards.get(i));
                if (amounts[i] < 0 || amounts[i] > c[0] + c[1]) return false;
            }
            return true;
        });
        if (answer == null) return main.toFlatList();
        int[] amounts = integers(answer, "amounts", cards.size());
        List<PaperCard> deck = new ArrayList<>();
        for (int i = 0; i < cards.size(); i++) for (int n = 0; n < amounts[i]; n++) deck.add(cards.get(i));
        return deck;
    }

    // ---------------------------------------------------------------- things this UI doesn't use

    @Override public void setPanelSelection(CardView hostCard) { }
    @Override public void setCard(CardView card) { }
    @Override public void setPlayerAvatar(LobbyPlayer player, IHasIcon ihi) { }

    /** Recheck local priority and update the host's cache for remote controllers. */
    void phaseStopsChanged() {
        GameView game = getGameView();
        if (disposed || game == null || game.isGameOver()) return;
        for (PlayerView player : game.getPlayers()) {
            for (PhaseType phase : PhaseType.values()) pushSkipPhaseToControllers(player, phase);
        }
        syncAutoPass();
        markDirty();
    }

    private Boolean autoPassSent;

    private volatile IGameController fastForwardController;
    private PlayerView fastForwardPlayer;
    private final Map<FPref, String> fastForwardPrefs = new java.util.EnumMap<>(FPref.class);
    private static final List<FPref> FAST_FORWARD_INTERRUPTS = List.of(
            FPref.YIELD_INTERRUPT_ON_ATTACKERS, FPref.YIELD_INTERRUPT_ON_OPPONENT_SPELL,
            FPref.YIELD_INTERRUPT_ON_TARGETING, FPref.YIELD_INTERRUPT_ON_TRIGGERS,
            FPref.YIELD_INTERRUPT_ON_REVEAL, FPref.YIELD_INTERRUPT_ON_MASS_REMOVAL);

    /**
     * Native yield marker, enforced on the game host even for a remote player. It expires before our next upkeep,
     * or when attackers are declared against us. Only priority is yielded: blocks and other choices remain manual.
     * Interrupt overrides live in this controller, never in the player's saved settings.
     */
    synchronized void setFastForward(boolean enabled) {
        if ((fastForwardController != null) == enabled) return;
        if (!enabled) {
            IGameController controller = fastForwardController;
            fastForwardController = null;
            controller.sendYieldUpdate(new YieldUpdate.ClearMarker(fastForwardPlayer));
            fastForwardPrefs.forEach((pref, value) -> controller.sendYieldUpdate(new YieldUpdate.SetYieldPref(pref, value)));
            fastForwardPrefs.clear();
            fastForwardPlayer = null;
            markDirty();
            return;
        }
        GameView game = getGameView();
        PlayerView local = getCurrentPlayer();
        IGameController controller = getGameController();
        if (disposed || controller == null || local == null || local.getHasLost() || game == null || game.isGameOver()
                || game.getPlayerTurn() == null || isLocalPlayer(game.getPlayerTurn()) || game.getPhase() == null
                || game.getPhase() == PhaseType.COMBAT_DECLARE_ATTACKERS || game.getPhase() == PhaseType.COMBAT_DECLARE_BLOCKERS) return;
        fastForwardController = controller;
        fastForwardPlayer = local;
        for (FPref pref : FAST_FORWARD_INTERRUPTS) {
            fastForwardPrefs.put(pref, controller.getYieldController().getStringPref(pref));
            controller.sendYieldUpdate(new YieldUpdate.SetYieldPref(pref, String.valueOf(pref == FPref.YIELD_INTERRUPT_ON_ATTACKERS)));
        }
        controller.sendYieldUpdate(new YieldUpdate.SetMarker(local, PhaseType.UPKEEP, false));
        markDirty();
    }

    private synchronized void syncFastForward() {
        if (fastForwardController == null) return;
        GameView game = getGameView();
        if (game == null || game.isGameOver() || fastForwardPlayer.getHasLost()
                || fastForwardController.getYieldController().getAutoPassUntilMarker() == null) setFastForward(false);
    }

    /**
     * Forge's "auto-pass when no actions" (any turn) switched on only while an opponent has the turn. The local
     * controller reads Forge's preference, the host's proxy of a remote player gets it over the wire.
     */
    synchronized void syncAutoPass() {
        GameView game = getGameView();
        PlayerView turn = game == null ? null : game.getPlayerTurn();
        if (disposed || turn == null) return;
        boolean on = settings.autoPass() && !isLocalPlayer(turn);
        if (autoPassSent != null && autoPassSent == on) return;
        autoPassSent = on;
        FModel.getPreferences().setPref(FPref.YIELD_AUTO_PASS_NO_ACTIONS, on);
        for (IGameController c : getOriginalGameControllers()) c.setYieldPref(FPref.YIELD_AUTO_PASS_NO_ACTIONS, String.valueOf(on));
    }

    /** Forge still decides mandatory actions and priority with a nonempty stack. */
    @Override
    public boolean isUiSetToSkipPhase(PlayerView playerTurn, PhaseType phase) {
        return !settings.stopsAt(isLocalPlayer(playerTurn), phase.name());
    }
}
