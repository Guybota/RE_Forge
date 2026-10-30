package reforge.engine;

import java.nio.file.Files;
import java.nio.file.Path;
import java.util.List;

import forge.deck.Deck;
import forge.game.GameRules;
import forge.game.GameState;
import forge.game.GameType;
import forge.game.player.RegisteredPlayer;
import forge.gamemodes.match.HostedMatch;
import forge.localinstance.properties.ForgePreferences.FPref;
import forge.model.FModel;
import forge.player.GamePlayerUtil;

/** Real card-effects regressions; never included in the production jar. */
public final class CodieHarness {
    public static void main(String[] args) throws Exception {
        List<String> engineArgs = new java.util.ArrayList<>();
        String scenario = "codie";
        for (int i = 0; i < args.length; i++) {
            if (args[i].equals("--scenario")) scenario = args[++i];
            else engineArgs.add(args[i]);
        }
        String selected = scenario;
        Main.launch(engineArgs.toArray(String[]::new), (gui, deck, source, opponents, profiles) -> start(gui, selected));
    }

    private static HostedMatch start(WebGuiGame gui, String scenario) {
        FModel.getPreferences().setPref(FPref.PLAYER_NAME, "Human");
        FModel.getPreferences().setPref(FPref.UI_RECORD_REPLAYS, false);
        FModel.getPreferences().setPref(FPref.UI_SHOW_ACTIONABLE_HIGHLIGHTS, true);
        FModel.getPreferences().setPref(FPref.UI_SELECT_FROM_CARD_DISPLAYS, true);
        // GameState replaces the precon's commander-effect cards; simulations cannot copy those stale ids.
        FModel.getPreferences().setPref(FPref.MATCH_AI_FLAT_MONTE_CARLO, false);
        Deck deck = FModel.getDecks().getCommanderPrecons().get(MatchStarter.commanderPreconNames().get(0));
        RegisteredPlayer human = RegisteredPlayer.forCommander(deck).setPlayer(GamePlayerUtil.getGuiPlayer("Human", 0, 0, false));
        RegisteredPlayer opponent = RegisteredPlayer.forCommander(deck).setPlayer(GamePlayerUtil.createAiPlayer("Defender", 1, "Default"));
        GameRules rules = new GameRules(GameType.Commander);
        rules.setGamesPerMatch(1);
        rules.setWarnAboutAICards(false);
        HostedMatch match = new HostedMatch();
        match.setStartGameHook(() -> {
            try {
                GameState state = new GameState();
                state.parse(Files.readAllLines(Path.of("scripts/fixtures/" + (scenario.equals("reveal") ? "reveal" : "codie") + "-cards.txt")));
                state.applyToGame(match.getGame());
                gui.pushStateNow();
            } catch (Exception error) {
                error.printStackTrace();
                gui.showErrorDialog(error.toString(), "Codie smoke failed");
            }
        });
        match.startMatch(rules, null, List.of(human, opponent), human, gui);
        return match;
    }
}
