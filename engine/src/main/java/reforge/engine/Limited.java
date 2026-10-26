package reforge.engine;

import java.text.SimpleDateFormat;
import java.util.ArrayList;
import java.util.Date;
import java.util.HashMap;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

import com.google.gson.JsonArray;
import com.google.gson.JsonElement;
import com.google.gson.JsonObject;

import forge.card.CardEdition;
import forge.deck.CardPool;
import forge.deck.Deck;
import forge.deck.DeckFormat;
import forge.deck.DeckGroup;
import forge.deck.DeckSection;
import forge.game.GameRules;
import forge.game.GameType;
import forge.game.GameView;
import forge.game.player.RegisteredPlayer;
import forge.gamemodes.limited.BoosterDraft;
import forge.gamemodes.limited.IBoosterDraft;
import forge.gamemodes.limited.LimitedDeckEvaluator;
import forge.gamemodes.limited.LimitedPoolType;
import forge.gamemodes.limited.SealedDeckBuilder;
import forge.gamemodes.match.HostedMatch;
import forge.item.PaperCard;
import forge.model.CardBlock;
import forge.model.FModel;
import forge.player.GamePlayerUtil;
import forge.util.storage.IStorage;

/**
 * Draft and Sealed with Forge's own boosters, AI drafters and AI deck builders. A finished pool is an event: Forge's
 * {@link DeckGroup} (the player's deck, whose sideboard holds the rest of the pool, plus the AI decks) saved in its
 * draft/sealed storage, so events survive restarts. The draft itself (picking) lives only in this connection.
 */
final class Limited {
    private static final String[] BASICS = {"Plains", "Island", "Swamp", "Mountain", "Forest"};
    private static final int SEALED_OPPONENTS = 3;

    /** The draft in progress for this connection, if any. */
    private BoosterDraft draft;
    private String draftSet;
    private List<PaperCard> pack = List.of();
    private int picks;

    // --- Sets ---

    /** A set with real boosters, inside one of Forge's blocks (which knows its booster and land set). */
    private record LimitedSet(CardEdition edition, CardBlock block) { }

    private static Map<String, LimitedSet> sets() {
        Map<String, LimitedSet> out = new LinkedHashMap<>();
        for (CardBlock block : FModel.getBlocks()) {
            if (block.getCntBoostersDraft() <= 0 && block.getCntBoostersSealed() <= 0) continue;
            for (CardEdition e : block.getSets()) {
                if (FModel.getMagicDb().getBoosters().contains(e.getCode())) out.putIfAbsent(e.getCode(), new LimitedSet(e, block));
            }
        }
        return out;
    }

    static JsonObject setList() {
        List<LimitedSet> sets = new ArrayList<>(sets().values());
        sets.sort((a, b) -> b.edition().getDate().compareTo(a.edition().getDate()));
        JsonArray list = new JsonArray();
        for (LimitedSet s : sets) {
            JsonObject o = new JsonObject();
            o.addProperty("code", s.edition().getCode());
            o.addProperty("name", s.edition().getName());
            o.addProperty("year", new SimpleDateFormat("yyyy").format(s.edition().getDate()));
            list.add(o);
        }
        JsonObject out = new JsonObject();
        out.addProperty("type", "limitedSets");
        out.add("sets", list);
        return out;
    }

    private static LimitedSet set(String code) {
        LimitedSet s = sets().get(code);
        if (s == null) throw new IllegalArgumentException("No boosters for set: " + code);
        return s;
    }

    // --- Events ---

    private static IStorage<DeckGroup> storage(String mode) {
        return switch (mode) {
            case "draft" -> FModel.getDecks().getDraft();
            case "sealed" -> FModel.getDecks().getSealed();
            default -> throw new IllegalArgumentException("Unknown limited mode: " + mode);
        };
    }

    /** Event ids are "mode/name"; names are Forge's storage keys. */
    private static DeckGroup event(String id) {
        String[] parts = id == null ? new String[0] : id.split("/", 2);
        DeckGroup group = parts.length == 2 ? storage(parts[0]).get(parts[1]) : null;
        if (group == null) throw new IllegalArgumentException("Unknown event: " + id);
        return group;
    }

    private static String mode(String id) { return id.split("/", 2)[0]; }

    static JsonObject events() {
        JsonArray list = new JsonArray();
        for (String mode : List.of("draft", "sealed")) {
            for (DeckGroup group : storage(mode)) {
                Deck human = group.getHumanDeck();
                JsonObject o = new JsonObject();
                o.addProperty("id", mode + "/" + group.getName());
                o.addProperty("mode", mode);
                o.addProperty("name", group.getName());
                o.addProperty("built", human != null && human.getMain().countAll() > 0);
                int[] score = score(human);
                o.addProperty("wins", score[0]);
                o.addProperty("losses", score[1]);
                list.add(o);
            }
        }
        JsonObject out = new JsonObject();
        out.addProperty("type", "limitedEvents");
        out.add("events", list);
        return out;
    }

    static JsonObject delete(String id) {
        event(id);
        storage(mode(id)).delete(id.split("/", 2)[1]);
        return events();
    }

    /** The event as the deck screen shows it: whole pool, current deck, free basic lands and opponents. */
    static JsonObject detail(String id) {
        DeckGroup group = event(id);
        Deck human = group.getHumanDeck();
        JsonObject out = new JsonObject();
        out.addProperty("type", "limitedEvent");
        out.addProperty("id", id);
        out.addProperty("mode", mode(id));
        out.addProperty("name", group.getName());
        out.add("pool", cards(pool(human)));
        out.add("main", cards(human.getMain()));
        String landSet = landSet(human);
        JsonArray lands = new JsonArray();
        for (String basic : BASICS) {
            PaperCard land = basic(basic, landSet);
            if (land != null) lands.add(CardCatalog.card(land));
        }
        out.add("lands", lands);
        JsonArray opponents = new JsonArray();
        List<Deck> ai = group.getAiDecks();
        for (int i = 0; i < ai.size(); i++) {
            JsonObject o = new JsonObject();
            o.addProperty("index", i);
            o.addProperty("colors", colors(ai.get(i)));
            String result = human.getTags().contains(tag("won", i)) ? "won" : human.getTags().contains(tag("lost", i)) ? "lost" : null;
            if (result != null) o.addProperty("result", result);
            opponents.add(o);
        }
        out.add("opponents", opponents);
        String problem = human.getMain().isEmpty() ? null : DeckFormat.Limited.getDeckConformanceProblem(human);
        if (problem != null) out.addProperty("problem", problem);
        return out;
    }

    /**
     * Saves the player's main deck: cards from the pool (no more copies than were opened) plus any number of basic
     * lands. Everything else in the pool goes to the sideboard.
     */
    static JsonObject saveDeck(String id, JsonArray entries) {
        DeckGroup group = event(id);
        Deck human = group.getHumanDeck();
        CardPool pool = pool(human);
        Map<String, Integer> available = new HashMap<>();
        for (Map.Entry<PaperCard, Integer> e : pool) available.merge(e.getKey().getName(), e.getValue(), Integer::sum);
        CardPool main = new CardPool();
        Map<String, Integer> used = new HashMap<>();
        for (JsonElement el : entries) {
            JsonObject entry = el.getAsJsonObject();
            String name = entry.get("nameEn").getAsString();
            int qty = entry.get("qty").getAsInt();
            if (qty <= 0 || qty > 60) throw new IllegalArgumentException("Invalid quantity for " + name);
            PaperCard card = printing(name, text(entry, "set"), text(entry, "number"));
            if (card == null) throw new IllegalArgumentException("Unknown card: " + name);
            if (!card.getRules().getType().isBasicLand()) {
                int total = used.merge(card.getName(), qty, Integer::sum);
                if (total > available.getOrDefault(card.getName(), 0)) throw new IllegalArgumentException("Not in your pool: " + name);
            }
            main.add(card, qty);
        }
        CardPool sideboard = new CardPool();
        sideboard.addAll(pool);
        // Basic lands in the deck are always the free ones: any opened in boosters stay in the pool.
        for (Map.Entry<PaperCard, Integer> e : main) {
            if (!e.getKey().getRules().getType().isBasicLand()) removeByName(sideboard, e.getKey().getName(), e.getValue());
        }
        Deck updated = new Deck(human.getName());
        updated.getTags().addAll(human.getTags());
        updated.getMain().addAll(main);
        updated.getOrCreate(DeckSection.Sideboard).addAll(sideboard);
        group.setHumanDeck(updated);
        storage(mode(id)).add(group);
        return detail(id);
    }

    // --- Sealed ---

    static JsonObject newSealed(String code) {
        LimitedSet set = set(code);
        int boosters = Math.max(1, set.block().getCntBoostersSealed() > 0 ? set.block().getCntBoostersSealed() : 6);
        String landSet = set.block().getLandSet() != null ? set.block().getLandSet().getCode() : code;
        String name = eventName(set.edition());
        Deck human = new Deck(name);
        human.getOrCreate(DeckSection.Sideboard).addAll(open(set, boosters));
        human.getTags().add(landTag(landSet));
        DeckGroup group = new DeckGroup(name);
        group.setHumanDeck(human);
        for (int i = 0; i < SEALED_OPPONENTS; i++) {
            Deck ai = new SealedDeckBuilder(open(set, boosters).toFlatList()).buildDeck(landSet);
            group.addAiDeck(ai);
        }
        group.rankAiDecks(new LimitedDeckEvaluator.LimitedDeckComparer());
        storage("sealed").add(group);
        return detail("sealed/" + name);
    }

    private static CardPool open(LimitedSet set, int boosters) {
        CardPool pool = new CardPool();
        for (int i = 0; i < boosters; i++) pool.addAllFlat(set.block().getBooster(set.edition().getCode()).get());
        return pool;
    }

    // --- Draft ---

    JsonObject newDraft(String code) {
        LimitedSet set = set(code);
        int packs = set.block().getCntBoostersDraft() > 0 ? set.block().getCntBoostersDraft() : 3;
        String[] boosters = new String[packs];
        java.util.Arrays.fill(boosters, code);
        BoosterDraft next = BoosterDraft.createDraft(LimitedPoolType.Block, set.block(), boosters);
        if (next == null) throw new IllegalStateException("Forge could not create the draft");
        draft = next;
        draftSet = code;
        picks = 0;
        pack = draft.nextChoice().toFlatList();
        return draftState();
    }

    /** Takes card {@code index} of the current pack; the AI drafters pick and pass. Ends with the event. */
    JsonObject pick(int index) {
        if (draft == null) throw new IllegalStateException("No draft in progress");
        if (index < 0 || index >= pack.size()) throw new IllegalArgumentException("Invalid pick");
        draft.setChoice(pack.get(index), DeckSection.Sideboard);
        picks++;
        CardPool next = draft.hasNextChoice() ? draft.nextChoice() : null;
        if (next != null && !next.isEmpty()) {
            pack = next.toFlatList();
            return draftState();
        }
        return finishDraft();
    }

    JsonObject draftState() {
        JsonObject out = new JsonObject();
        if (draft == null) {
            out.addProperty("type", "draftClosed");
            return out;
        }
        out.addProperty("type", "draft");
        out.addProperty("set", draftSet);
        out.addProperty("round", draft.getRound());
        out.addProperty("rounds", draft.getNumRounds());
        out.addProperty("picks", picks);
        out.add("pack", packCards(pack));
        out.add("picked", cards(draft.getHumanPlayer().getDeck().getOrCreate(DeckSection.Sideboard)));
        return out;
    }

    private JsonObject finishDraft() {
        draft.postDraftActions();
        CardEdition edition = FModel.getMagicDb().getEditions().get(draftSet);
        String name = eventName(edition);
        CardEdition lands = IBoosterDraft.LAND_SET_CODE[0];
        Deck[] ai = draft.getComputerDecks();
        Deck picked = draft.getHumanPlayer().getDeck();
        Deck human = new Deck(name);
        CardPool pool = new CardPool();
        for (DeckSection section : List.of(DeckSection.Main, DeckSection.Sideboard)) if (picked.has(section)) pool.addAll(picked.get(section));
        human.getOrCreate(DeckSection.Sideboard).addAll(pool);
        human.getTags().add(landTag(lands != null ? lands.getCode() : draftSet));
        DeckGroup group = new DeckGroup(name);
        group.setHumanDeck(human);
        group.addAiDecks(ai);
        group.rankAiDecks(new LimitedDeckEvaluator.LimitedDeckComparer());
        storage("draft").add(group);
        draft = null;
        pack = List.of();
        return detail("draft/" + name);
    }

    // --- Playing ---

    static HostedMatch start(WebGuiGame gui, String id, int opponent) {
        DeckGroup group = event(id);
        Deck human = group.getHumanDeck();
        String problem = DeckFormat.Limited.getDeckConformanceProblem(human);
        if (human.getMain().isEmpty() || problem != null) throw new IllegalArgumentException(problem != null ? problem : "Build your deck first");
        List<Deck> ai = group.getAiDecks();
        if (opponent < 0 || opponent >= ai.size()) throw new IllegalArgumentException("Unknown opponent");
        String name = MatchStarter.preparePreferences();
        GameRules rules = new GameRules(mode(id).equals("draft") ? GameType.Draft : GameType.Sealed);
        rules.setGamesPerMatch(1);
        rules.setWarnAboutAICards(false);
        RegisteredPlayer me = new RegisteredPlayer(human).setPlayer(GamePlayerUtil.getGuiPlayer(name, 0, 0, true));
        Deck theirs = ai.get(opponent);
        RegisteredPlayer them = new RegisteredPlayer(theirs).setPlayer(GamePlayerUtil.createAiPlayer(theirs.getName(), opponent + 1));
        HostedMatch match = new HostedMatch();
        match.startMatch(rules, null, List.of(me, them), me, gui);
        return match;
    }

    /** Records the result against {@code opponent} (the last one counts) and answers with the event. */
    static JsonObject finish(String id, int opponent, GameView game) {
        DeckGroup group = event(id);
        Deck human = group.getHumanDeck();
        boolean won = game.isMatchWonBy(GamePlayerUtil.getGuiPlayer());
        human.getTags().remove(tag("won", opponent));
        human.getTags().remove(tag("lost", opponent));
        human.getTags().add(tag(won ? "won" : "lost", opponent));
        storage(mode(id)).add(group);
        return detail(id);
    }

    // --- Helpers ---

    private static String tag(String result, int opponent) { return "reforge-" + result + "-" + opponent; }
    private static String landTag(String code) { return "reforge-lands-" + code; }

    private static String landSet(Deck human) {
        for (String t : human.getTags()) if (t.startsWith("reforge-lands-")) return t.substring("reforge-lands-".length());
        return null;
    }

    private static int[] score(Deck human) {
        int wins = 0, losses = 0;
        if (human != null) for (String t : human.getTags()) {
            if (t.startsWith("reforge-won-")) wins++;
            if (t.startsWith("reforge-lost-")) losses++;
        }
        return new int[] {wins, losses};
    }

    /** Pool = sideboard + the deck's nonbasic cards (basic lands in the deck are free). */
    private static CardPool pool(Deck human) {
        CardPool out = new CardPool();
        if (human.has(DeckSection.Sideboard)) out.addAll(human.get(DeckSection.Sideboard));
        for (Map.Entry<PaperCard, Integer> e : human.getMain()) {
            if (!e.getKey().getRules().getType().isBasicLand()) out.add(e.getKey(), e.getValue());
        }
        return out;
    }

    private static void removeByName(CardPool pool, String name, int qty) {
        List<Map.Entry<PaperCard, Integer>> entries = new ArrayList<>();
        pool.forEach(entries::add);
        for (Map.Entry<PaperCard, Integer> e : entries) {
            if (qty <= 0) return;
            if (!e.getKey().getName().equals(name)) continue;
            int take = Math.min(qty, e.getValue());
            pool.remove(e.getKey(), take);
            qty -= take;
        }
    }

    private static PaperCard printing(String name, String set, String number) {
        var db = FModel.getMagicDb().getCommonCards();
        PaperCard card = set.isEmpty() ? null : number.isEmpty() ? db.getCard(name, set) : db.getCard(name, set, number);
        return card != null ? card : db.getCard(name);
    }

    private static PaperCard basic(String name, String landSet) {
        var db = FModel.getMagicDb().getCommonCards();
        PaperCard card = landSet == null ? null : db.getCard(name, landSet);
        return card != null ? card : db.getCard(name);
    }

    /** The deck's colours (Forge's W U B R G bits) from its nonland cards, for the opponent list. */
    private static int colors(Deck deck) {
        int mask = 0;
        for (Map.Entry<PaperCard, Integer> e : deck.getMain()) {
            if (!e.getKey().getRules().getType().isLand()) mask |= e.getKey().getRules().getColor().getColor();
        }
        return mask;
    }

    private static JsonArray cards(Iterable<Map.Entry<PaperCard, Integer>> pool) {
        JsonArray out = new JsonArray();
        for (Map.Entry<PaperCard, Integer> e : pool) {
            JsonObject c = CardCatalog.card(e.getKey());
            c.addProperty("qty", e.getValue());
            out.add(c);
        }
        return out;
    }

    private static JsonArray packCards(List<PaperCard> pack) {
        JsonArray out = new JsonArray();
        for (int i = 0; i < pack.size(); i++) {
            JsonObject c = CardCatalog.card(pack.get(i));
            c.addProperty("index", i);
            out.add(c);
        }
        return out;
    }

    /** "Dominaria 2026-10-26 0215": unique enough, and a valid file name for Forge's storage. */
    private static String eventName(CardEdition edition) {
        String set = edition == null ? "Draft" : edition.getName();
        return (set + " " + new SimpleDateFormat("yyyy-MM-dd HHmmss").format(new Date())).replaceAll("[\\\\/:*?\"<>|]", " ").trim();
    }

    private static String text(JsonObject o, String key) {
        return o.has(key) && !o.get(key).isJsonNull() ? o.get(key).getAsString() : "";
    }
}
