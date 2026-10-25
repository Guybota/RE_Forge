package reforge.engine;

import java.nio.file.Files;
import java.nio.file.Path;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

import forge.deck.Deck;
import forge.game.GameRules;
import forge.game.GameState;
import forge.game.GameType;
import forge.game.card.Card;
import forge.game.card.CardView;
import forge.game.player.DelayedReveal;
import forge.game.player.RegisteredPlayer;
import forge.game.zone.ZoneType;
import forge.gamemodes.match.HostedMatch;
import forge.localinstance.properties.ForgePreferences.FPref;
import forge.model.FModel;
import forge.player.GamePlayerUtil;

/** Test-only launcher. Scenarios and assertions are never packaged in the production engine jar. */
public final class DialogHarness {
    public static void main(String[] args) throws Exception {
        List<String> engineArgs = new ArrayList<>();
        String scenario = "combat";
        for (int i = 0; i < args.length; i++) {
            if (args[i].equals("--scenario")) scenario = args[++i];
            else engineArgs.add(args[i]);
        }
        String selected = scenario;
        Main.launch(engineArgs.toArray(String[]::new), (gui, deck, opponents, profiles) -> start(gui, selected));
    }

    private static HostedMatch start(WebGuiGame gui, String scenario) {
        FModel.getPreferences().setPref(FPref.PLAYER_NAME, "Human");
        FModel.getPreferences().setPref(FPref.UI_RECORD_REPLAYS, false);
        FModel.getPreferences().setPref(FPref.UI_SHOW_ACTIONABLE_HIGHLIGHTS, true);
        FModel.getPreferences().setPref(FPref.LEGACY_ORDER_COMBATANTS, true);
        Deck deck = FModel.getDecks().getCommanderPrecons().get(MatchStarter.commanderPreconNames().get(0));
        RegisteredPlayer human = RegisteredPlayer.forCommander(deck).setPlayer(GamePlayerUtil.getGuiPlayer("Human", 0, 0, false));
        List<RegisteredPlayer> players = new java.util.ArrayList<>(List.of(human));
        // "table" is a busy four-player board for checking the multiplayer layout.
        int opponents = scenario.equals("table") ? 3 : 1;
        for (int i = 1; i <= opponents; i++) {
            players.add(RegisteredPlayer.forCommander(deck).setPlayer(GamePlayerUtil.createAiPlayer(i == 1 ? "Defender" : "Opponent " + i, i)));
        }
        GameRules rules = new GameRules(GameType.Commander);
        rules.setGamesPerMatch(1);
        rules.setWarnAboutAICards(false);
        rules.setOrderCombatants(true);
        HostedMatch match = new HostedMatch();
        match.setStartGameHook(() -> {
            try {
                GameState state = new GameState();
                state.parse(Files.readAllLines(Path.of(List.of("images", "zones", "table", "sounds", "animations").contains(scenario)
                        ? "scripts/fixtures/" + scenario.replace("images", "image").replace("sounds", "sound") + "-cards.txt" : "scripts/fixtures/dialog-combat.txt")));
                // Applying a native Forge state on the game thread creates real cards/combat.
                state.applyToGame(match.getGame());
                gui.pushStateNow();
                if (scenario.equals("suite")) exerciseDialogs(gui, match);
            } catch (Exception | AssertionError error) {
                error.printStackTrace();
                gui.showErrorDialog(error.toString(), "Dialog smoke failed");
            }
        });
        match.startMatch(rules, null, players, human, gui);
        return match;
    }

    private static void check(boolean valid, String message) {
        if (!valid) throw new AssertionError(message);
    }

    private static void exerciseDialogs(WebGuiGame gui, HostedMatch match) {
        var game = match.getGame();
        var human = game.getPlayers().get(0);
        var defender = game.getPlayers().get(1);
        Card attacker = human.getCardsIn(ZoneType.Battlefield).get(0);
        List<CardView> blockers = CardView.getCollection(defender.getCardsIn(ZoneType.Battlefield)).stream().toList();

        Map<CardView, Integer> split = gui.assignCombatDamage(attacker.getView(), blockers, 6, defender.getView(), false, false);
        check(!split.containsKey(null) && split.values().stream().mapToInt(Integer::intValue).sum() == 6, "normal damage cannot target defender");
        check(gui.assignCombatDamage(attacker.getView(), blockers, 6, defender.getView(), false, true) == null, "skip damage contract");

        // Keywords and lethal numbers come from real Forge card views.
        Card trampler = Card.fromPaperCard(FModel.getMagicDb().getCommonCards().getCard("Colossal Dreadmaw"), human);
        var trample = gui.assignCombatDamage(trampler.getView(), blockers, 8, defender.getView(), false, false);
        check(trample.get(null) == 2 && trample.get(blockers.get(0)) == 3 && trample.get(blockers.get(1)) == 3, "trample after lethal");
        Card deathtouch = Card.fromPaperCard(FModel.getMagicDb().getCommonCards().getCard("Deadly Recluse"), human);
        var death = gui.assignCombatDamage(deathtouch.getView(), blockers, 2, defender.getView(), true, false);
        check(death.get(blockers.get(0)) == 1 && death.get(blockers.get(1)) == 1, "deathtouch uses one lethal damage");

        Map<Object, Integer> caps = new LinkedHashMap<>();
        caps.put(blockers.get(0), 2);
        caps.put(blockers.get(1), 4);
        var generic = gui.assignGenericAmount(attacker.getView(), caps, 5, true, "Generic capped assignment");
        check(generic.get(blockers.get(0)) == 2 && generic.get(blockers.get(1)) == 3, "generic minima and caps");
        Map<Object, Integer> mana = new LinkedHashMap<>();
        mana.put(forge.card.MagicColor.Color.WHITE, 1);
        mana.put(forge.card.MagicColor.Color.BLUE, 1);
        mana.put(forge.card.MagicColor.Color.GREEN, 1);
        var colors = gui.assignGenericAmount(attacker.getView(), mana, 2, false, "Mana choices");
        check(colors.get(forge.card.MagicColor.Color.WHITE) == 1 && colors.get(forge.card.MagicColor.Color.BLUE) == 1
                && colors.get(forge.card.MagicColor.Color.GREEN) == 0, "different mana colors obey their caps");
        check(gui.getInteger("Bounded number", -5, 500, false) == 257, "number beyond 100 and signed range");
        check(gui.getInteger("Optional number", 0, 1000, 99) == null, "number cancellation");

        List<Card> library = human.getCardsIn(ZoneType.Library).stream().toList();
        List<CardView> views = CardView.getCollection(library).stream().toList();
        // Revealing two cards does not authorize exporting the rest of the library.
        gui.reveal("Reveal two cards", views.subList(0, 2));
        List<String> modes = gui.getChoices("Choose two modes", 2, 2, List.of("A", "B", "C"), null, null);
        check(modes.equals(List.of("A", "C")), "mode cardinality");
        var order = gui.order("Order triggers", "", 0, 0, List.of("A", "B", "C"), null, null, false, false);
        check(order.ordered().equals(List.of("C", "A", "B")), "trigger ordering");
        check(gui.insertInList("Insert trigger", "D", List.of("A", "B", "C")).equals(List.of("D", "A", "B", "C")), "insertion includes the new item");

        var controller = (forge.player.PlayerControllerHuman) human.getController();
        controller.tempShowCards(library.subList(0, 2));
        var moved = gui.manipulateCardList("Arrange library", views, views.subList(0, 2), true, true, false);
        controller.endTempShowCards();
        check(moved.equals(List.of(views.get(1), views.get(2), views.get(3), views.get(4), views.get(0))), "only movable cards change ends");
        FModel.getPreferences().setPref(FPref.UI_SELECT_FROM_CARD_DISPLAYS, true);
        var scry = controller.arrangeForScry(new forge.game.card.CardCollection(library.subList(0, 2)));
        check(scry.getLeft().stream().toList().equals(List.of(library.get(1))) && scry.getRight().stream().toList().equals(List.of(library.get(0))), "native scry top and bottom");
        var surveil = controller.arrangeForSurveil(new forge.game.card.CardCollection(library.subList(0, 2)));
        check(surveil.getLeft().stream().toList().equals(List.of(library.get(1))) && surveil.getRight().stream().toList().equals(List.of(library.get(0))), "native surveil library and graveyard");
        controller.tempShowCards(library);
        check(gui.chooseSingleEntityForEffect("Search library", views, null, false).equals(views.get(0)), "required library search");
        controller.endTempShowCards();
        var reveal = new DelayedReveal(library.subList(0, 2), ZoneType.Library, human.getView());
        check(gui.chooseSingleEntityForEffect("Optional target", List.of(defender.getView()), reveal, true) == null, "delayed reveal and optional target");
        gui.message("DIALOG_SUITE_OK");
    }
}
