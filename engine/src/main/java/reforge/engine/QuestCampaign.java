package reforge.engine;

import java.io.File;
import java.util.*;
import com.google.gson.*;
import forge.deck.*;
import forge.game.GameRules;
import forge.game.GameType;
import forge.game.GameView;
import forge.game.player.RegisteredPlayer;
import forge.gamemodes.match.HostedMatch;
import forge.gamemodes.quest.*;
import forge.gamemodes.quest.data.*;
import forge.gamemodes.quest.io.QuestDataIO;
import forge.gui.UiCommand;
import forge.gui.interfaces.*;
import forge.item.*;
import forge.localinstance.properties.ForgeConstants;
import forge.localinstance.skin.FSkinProp;
import forge.model.FModel;
import forge.player.GamePlayerUtil;

/** Native Quest economy, saves, opponent selection and reward controller, with a web view. */
final class QuestCampaign {
    private final QuestController quest = FModel.getQuest();
    private List<QuestEventDuel> duels;
    private final List<JsonObject> rewards = new ArrayList<>();

    static List<PreconDeck> starters() {
        List<PreconDeck> out = new ArrayList<>();
        QuestController.getPrecons().forEach(p -> {
            Deck d = p.getDeck();
            if (!d.has(DeckSection.Commander) && DeckFormat.QuestDeck.getDeckConformanceProblem(d) == null) out.add(p);
        });
        out.sort(Comparator.comparing(PreconDeck::getName));
        return out;
    }
    void create(JsonObject meta, String starter, int difficulty) {
        if (difficulty < 0 || difficulty > 3) throw new IllegalArgumentException("Invalid difficulty");
        PreconDeck precon = starters().stream().filter(p -> p.getName().equals(starter)).findFirst()
                .orElseThrow(() -> new IllegalArgumentException("Unknown Quest starter"));
        Deck deck = new Deck(precon.getDeck(), "Starter");
        quest.newGame(nativeName(meta), difficulty, QuestMode.Classic, null, false, deck, null,
                QuestWorld.MAINWORLDNAME,
                new StartingPoolPreferences(StartingPoolPreferences.PoolType.RANDOM, List.of(), true, false, true, 0),
                DeckConstructionRules.Default);
        quest.setCurrentDeck(deck.getName());
        quest.setMatchLength("1");
        quest.save();
        duels = null;
    }
    void open(JsonObject meta) throws Exception {
        quest.load(QuestDataIO.loadData(new File(ForgeConstants.QUEST_SAVE_DIR, nativeName(meta) + ".dat")));
        duels = null;
        // A closed/crashed match is a loss. Compare native counters to avoid settling it twice.
        if (meta.has("battle")) {
            JsonObject pending = meta.getAsJsonObject("battle");
            if (quest.getAchievements().getWin() == CampaignStore.number(pending, "wins", -1)
                    && quest.getAchievements().getLost() == CampaignStore.number(pending, "losses", -1)) abandon();
            meta.remove("battle");
        }
    }
    /** Removes Forge's native save and the backup QuestDataIO keeps next to it. */
    static void delete(JsonObject meta) throws java.io.IOException {
        for (String suffix : List.of(".dat", ".dat.bak")) java.nio.file.Files.deleteIfExists(new File(ForgeConstants.QUEST_SAVE_DIR, nativeName(meta) + suffix).toPath());
    }
    static String nativeName(JsonObject meta) { return "reforge-" + CampaignStore.text(meta, "id"); }
    Deck deck() { return quest.getMyDecks().get(quest.getCurrentDeck()); }
    void saveDeck(JsonArray entries) {
        CardPool main = validated(entries, quest.getCards().getCardpool(), DeckFormat.QuestDeck);
        deck().getMain().clear(); deck().getMain().addAll(main);
        quest.save();
    }
    static CardPool validated(JsonArray entries, Iterable<Map.Entry<PaperCard, Integer>> owned, DeckFormat format) {
        Map<String, Map.Entry<PaperCard, Integer>> lookup = new HashMap<>();
        for (var e : owned) lookup.put(CampaignStore.key(e.getKey()), e);
        CardPool main = new CardPool();
        Set<String> seen = new HashSet<>();
        for (JsonElement element : entries) {
            JsonObject e = element.getAsJsonObject(); String key = CampaignStore.text(e, "key");
            int qty = e.get("qty").getAsBigDecimal().intValueExact();
            var card = lookup.get(key);
            if (!seen.add(key) || card == null || qty < 0 || qty > card.getValue()) throw new IllegalArgumentException("Invalid owned-card quantity");
            if (qty > 0) main.add(card.getKey(), qty);
        }
        Deck deck = new Deck("Campaign"); deck.getMain().addAll(main);
        String problem = format.getDeckConformanceProblem(deck);
        if (problem != null) throw new IllegalArgumentException(problem);
        return main;
    }
    private List<QuestEventDuel> duels() {
        if (duels == null) duels = quest.getDuelsManager().generateDuels();
        return duels == null ? List.of() : duels;
    }
    JsonObject state() {
        JsonObject out = new JsonObject();
        out.addProperty("credits", quest.getAssets().getCredits());
        out.addProperty("wins", quest.getAchievements().getWin());
        out.addProperty("losses", quest.getAchievements().getLost());
        out.addProperty("rank", quest.getLevel());
        out.add("cards", CampaignStore.cards(quest.getCards().getCardpool(), deck().getMain()));
        JsonArray events = new JsonArray();
        for (int i = 0; i < duels().size(); i++) {
            QuestEventDuel d = duels().get(i); JsonObject item = new JsonObject();
            item.addProperty("id", Integer.toString(i)); item.addProperty("name", d.getTitle());
            item.addProperty("description", d.getDescription()); item.addProperty("difficulty", d.getDifficulty().name());
            events.add(item);
        }
        out.add("duels", events);
        JsonArray shop = new JsonArray();
        for (var e : quest.getCards().getShopList()) {
            if (!(e.getKey() instanceof PaperCard card)) continue;
            JsonObject item = CardCatalog.card(card); item.addProperty("key", CampaignStore.key(card));
            item.addProperty("available", e.getValue()); item.addProperty("price", QuestSpellShop.getCardValue(card));
            shop.add(item);
        }
        out.add("shop", shop);
        JsonArray messages = new JsonArray(); rewards.forEach(messages::add); out.add("rewards", messages);
        return out;
    }
    void buy(String key) {
        PaperCard card = null;
        for (var e : quest.getCards().getShopList()) if (e.getKey() instanceof PaperCard c && CampaignStore.key(c).equals(key)) { card = c; break; }
        if (card == null || quest.getCards().getShopList().count(card) < 1) throw new IllegalArgumentException("Shop card unavailable");
        int price = QuestSpellShop.getCardValue(card);
        if (quest.getAssets().getCredits() < price) throw new IllegalArgumentException("Not enough credits");
        quest.getCards().buyCard(card, 1, price);
        quest.getCards().getShopList().remove(card, 1);
        quest.save();
    }
    HostedMatch start(WebGuiGame gui, String id, JsonObject meta, CampaignStore store) throws Exception {
        int index = Integer.parseInt(id);
        if (index < 0 || index >= duels().size()) throw new IllegalArgumentException("Unknown Quest duel");
        QuestEventDuel event = duels().get(index);
        String problem = DeckFormat.QuestDeck.getDeckConformanceProblem(deck());
        if (problem != null) throw new IllegalArgumentException(problem);
        quest.setCurrentEvent(event);
        JsonObject pending = new JsonObject();
        pending.addProperty("wins", quest.getAchievements().getWin()); pending.addProperty("losses", quest.getAchievements().getLost());
        meta.add("battle", pending); store.save(meta);
        RegisteredPlayer human = new RegisteredPlayer(deck()).setPlayer(GamePlayerUtil.getQuestPlayer());
        human.setStartingLife(quest.getAssets().getLife(quest.getMode()));
        human.addExtraCardsOnBattlefield(QuestUtil.getHumanStartingCards(quest, event));
        RegisteredPlayer ai = new RegisteredPlayer(event.getEventDeck()).setPlayer(GamePlayerUtil.createAiPlayer(event.getTitle(), event.getProfile()));
        ai.addExtraCardsOnBattlefield(QuestUtil.getComputerStartingCards(event));
        GameRules rules = new GameRules(GameType.Quest); rules.setGamesPerMatch(1); rules.setPlayForAnte(false); rules.setWarnAboutAICards(false);
        HostedMatch match = new HostedMatch();
        match.startMatch(rules, null, List.of(human, ai), human, gui);
        rewards.clear();
        return match;
    }
    void finish(GameView view) {
        QuestWinLoseController controller = new QuestWinLoseController(view, new RewardView());
        controller.showRewards(); controller.actionOnQuit();
        quest.getDuelsManager().randomizeOpponents(); duels = null;
    }
    void abandon() {
        quest.getAchievements().addLost();
        quest.getAssets().subtractCredits(FModel.getQuestPreferences().getPrefInt(QuestPreferences.QPref.PENALTY_LOSS));
        quest.setCurrentEvent(null); quest.save(); duels = null;
    }
    private final class RewardView implements IWinLoseView<Button> {
        private final Button button = new Button();
        public Button getBtnContinue() { return button; } public Button getBtnRestart() { return button; } public Button getBtnQuit() { return button; }
        public void hide() { } public void showRewards(Runnable work) { work.run(); }
        public void showCards(String title, List<PaperCard> cards) {
            JsonObject m = new JsonObject(); m.addProperty("title", title);
            CardPool pool = new CardPool(); pool.addAllFlat(cards); m.add("cards", CampaignStore.cards(pool, null)); rewards.add(m);
        }
        public void showMessage(String message, String title, FSkinProp icon) {
            JsonObject m = new JsonObject(); m.addProperty("title", title); m.addProperty("message", message); rewards.add(m);
        }
    }
    private static final class Button implements IButton {
        public String getText() { return ""; } public void setText(String text) { }
        public boolean isSelected() { return false; } public void setSelected(boolean value) { }
        public boolean requestFocusInWindow() { return false; } public void setCommand(UiCommand command) { }
        public void setImage(FSkinProp icon) { } public void setTextColor(int r, int g, int b) { }
        public boolean isEnabled() { return true; } public void setEnabled(boolean value) { }
        public boolean isVisible() { return true; } public void setVisible(boolean value) { }
        public String getToolTipText() { return ""; } public void setToolTipText(String value) { }
    }
}
