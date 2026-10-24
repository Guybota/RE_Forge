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

import forge.LobbyPlayer;
import forge.deck.CardPool;
import forge.game.GameEntityView;
import forge.game.GameView;
import forge.game.card.CardView;
import forge.game.phase.PhaseType;
import forge.game.player.DelayedReveal;
import forge.game.player.IHasIcon;
import forge.game.player.PlayerView;
import forge.game.spellability.SpellAbilityView;
import forge.gamemodes.net.NetworkGuiGame;
import forge.gamemodes.match.Selection;
import forge.gui.interfaces.IGuiGame;
import forge.item.PaperCard;
import forge.localinstance.skin.FSkinProp;
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

    private volatile GameSnapshot.Prompt prompt = GameSnapshot.Prompt.NONE;
    private volatile GameSnapshot lastSnapshot;

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
        try {
            GameSnapshot snapshot = new GameSnapshot(game, this, prompt);
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

    void dispose() {
        disposed = true;
        super.afterGameEnd();
        session.cancelQuestions();
        pusher.shutdownNow();
    }

    @Override protected void afterDeltaApplied() { markDirty(); }

    @Override public void setGameView(GameView gameView) { super.setGameView(gameView); markDirty(); }
    @Override protected void updateCurrentPlayer(PlayerView player) { markDirty(); }
    @Override public void openView(TrackableCollection<PlayerView> myPlayers) {
        seedYieldStateOnHost();
        markDirty();
    }
    @Override public void showCombat() { markDirty(); }
    @Override public void updatePhase(boolean saveState) { markDirty(); }
    @Override public void updateTurn(PlayerView player) { markDirty(); }
    @Override public void updateStack() { markDirty(); }
    @Override public void updateZones(Iterable<PlayerZoneUpdate> zonesToUpdate) { markDirty(); }
    @Override public void updateCards(Iterable<CardView> cards) { markDirty(); }
    @Override public void updateLives(Iterable<PlayerView> livesUpdate) { markDirty(); }
    @Override public void updateManaPool(Iterable<PlayerView> manaPoolUpdate) { markDirty(); }
    @Override public void refreshField() { markDirty(); }
    @Override public void finishGame() { pushStateNow(); }
    @Override public void afterGameEnd() { super.afterGameEnd(); pushStateNow(); }

    // ---------------------------------------------------------------- prompt bar

    @Override
    public void showPromptMessage(PlayerView playerView, String message, CardView card) {
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

    private <T> JsonArray options(Collection<T> items, FSerializableFunction<T, String> display) {
        JsonArray arr = new JsonArray();
        for (T item : items) {
            JsonObject o = new JsonObject();
            if (item instanceof CardView c) {
                o.addProperty("cardId", c.getId());
                o.addProperty("label", GameSnapshot.name(c.getCurrentState()));
            } else if (item instanceof PlayerView p) {
                o.addProperty("playerId", p.getId());
                o.addProperty("label", p.getName());
            }
            if (display != null) {
                o.addProperty("label", display.apply(item));
            } else if (!o.has("label")) {
                o.addProperty("label", String.valueOf(item));
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
                int i = e.getAsInt();
                if (i >= 0 && i < size) result.add(i);
            }
        }
        return new ArrayList<>(result);
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
        q.add("options", options(items, display));
        if (preselected != null) {
            JsonArray pre = new JsonArray();
            preselected.forEach(item -> pre.add(items.indexOf(item)));
            q.add("preselected", pre);
        }
        JsonObject answer = ask(kind, title, q);
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
        return yesNo(question, options == null || options.size() < 2 ? List.of("Sim", "Não") : options, defaultIsYes);
    }

    @Override
    public boolean showConfirmDialog(String message, String title, String yesButtonText, String noButtonText, boolean defaultYes) {
        return yesNo(message, List.of(yesButtonText, noButtonText), defaultYes);
    }

    private boolean yesNo(String question, List<String> labels, boolean defaultYes) {
        List<Integer> idx = picked(ask("confirm", question, optionsOnly(labels)), 2);
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
        List<Integer> idx = picked(ask("confirm", message, optionsOnly(options)), options.size());
        return idx.isEmpty() ? defaultOption : idx.get(0);
    }

    @Override
    public String showInputDialog(String message, String title, FSkinProp icon, String initialInput, List<String> inputOptions, boolean isNumeric) {
        if (inputOptions != null && !inputOptions.isEmpty()) {
            List<Integer> idx = picked(ask("confirm", message, optionsOnly(inputOptions)), inputOptions.size());
            return idx.isEmpty() ? null : inputOptions.get(idx.get(0));
        }
        JsonObject q = new JsonObject();
        q.addProperty("initial", initialInput);
        q.addProperty("numeric", isNumeric);
        JsonObject answer = ask("text", message, q);
        return answer == null || !answer.has("value") || answer.get("value").isJsonNull() ? null : answer.get("value").getAsString();
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
        if (optionList.isEmpty()) return null;
        List<GameEntityView> chosen = chooseFrom("choose", title, isOptional ? 0 : 1, 1, new ArrayList<>(optionList), null, null);
        return chosen.isEmpty() ? null : chosen.get(0);
    }

    @Override
    public List<GameEntityView> chooseEntitiesForEffect(String title, List<? extends GameEntityView> optionList, int min, int max, DelayedReveal delayedReveal) {
        return chooseFrom("choose", title, min, max, new ArrayList<>(optionList), null, null);
    }

    @Override
    public List<CardView> manipulateCardList(String title, Iterable<CardView> cards, Iterable<CardView> manipulable, boolean toTop, boolean toBottom, boolean toAnywhere) {
        List<CardView> all = new ArrayList<>();
        cards.forEach(all::add);
        return chooseFrom("order", title, all.size(), all.size(), all, null, null);
    }

    @Override
    public Map<CardView, Integer> assignCombatDamage(CardView attacker, List<CardView> blockers, int damage, GameEntityView defender, boolean overrideOrder, boolean maySkip) {
        // Forge reads the null key as "damage to the defending player/planeswalker" (trample).
        List<Object> targets = new ArrayList<>(blockers);
        if (defender != null) targets.add(defender);
        int[] amounts = amounts(GameSnapshot.name(attacker.getCurrentState()), damage, targets);
        Map<CardView, Integer> result = new LinkedHashMap<>();
        for (int i = 0; i < blockers.size(); i++) result.put(blockers.get(i), amounts[i]);
        if (defender != null) result.put(null, amounts[blockers.size()]);
        return result;
    }

    @Override
    public Map<Object, Integer> assignGenericAmount(CardView effectSource, Map<Object, Integer> target, int amount, boolean atLeastOne, String amountLabel) {
        List<Object> keys = new ArrayList<>(target.keySet());
        int[] amounts = amounts(GameSnapshot.name(effectSource.getCurrentState()), amount, keys);
        Map<Object, Integer> result = new LinkedHashMap<>();
        for (int i = 0; i < keys.size(); i++) result.put(keys.get(i), amounts[i]);
        return result;
    }

    /** Asks how to split {@code total} over the targets. Falls back to everything on the first one. */
    private int[] amounts(String title, int total, List<Object> targets) {
        JsonObject q = new JsonObject();
        q.addProperty("total", total);
        q.add("options", options(targets, null));
        JsonObject answer = ask("amounts", title, q);
        int[] result = new int[targets.size()];
        int sum = 0;
        if (answer != null && answer.has("amounts") && answer.get("amounts").isJsonArray()) {
            JsonArray arr = answer.getAsJsonArray("amounts");
            for (int i = 0; i < Math.min(arr.size(), result.length); i++) {
                result[i] = Math.max(0, arr.get(i).getAsInt());
                sum += result[i];
            }
        }
        if (sum != total && result.length > 0) {
            java.util.Arrays.fill(result, 0);
            result[0] = total;
        }
        return result;
    }

    @Override
    public List<PaperCard> sideboard(CardPool sideboard, CardPool main, String message) {
        // shortcut: no sideboarding between games yet; keeps the main deck as it was.
        return main.toFlatList();
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
        markDirty();
    }

    /** Forge still decides mandatory actions and priority with a nonempty stack. */
    @Override
    public boolean isUiSetToSkipPhase(PlayerView playerTurn, PhaseType phase) {
        return !settings.stopsAt(isLocalPlayer(playerTurn), phase.name());
    }
}
