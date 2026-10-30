package reforge.engine;

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

/** Real stack targets for Counterspell and Stifle, including two activations of the same source. */
public final class StackTargetHarness {
    public static void main(String[] args) throws Exception {
        Main.launch(args, (gui, deck, source, opponents, profiles) -> start(gui, "stifle".equals(deck)));
    }

    private static HostedMatch start(WebGuiGame gui, boolean stifle) {
        FModel.getPreferences().setPref(FPref.PLAYER_NAME, "Human");
        FModel.getPreferences().setPref(FPref.UI_RECORD_REPLAYS, false);
        FModel.getPreferences().setPref(FPref.UI_SHOW_ACTIONABLE_HIGHLIGHTS, true);
        Deck deck = FModel.getDecks().getCommanderPrecons().get(MatchStarter.commanderPreconNames().get(0));
        RegisteredPlayer human = RegisteredPlayer.forCommander(deck).setPlayer(GamePlayerUtil.getGuiPlayer("Human", 0, 0, false));
        RegisteredPlayer opponent = RegisteredPlayer.forCommander(deck).setPlayer(GamePlayerUtil.createAiPlayer("Defender", 1));
        GameRules rules = new GameRules(GameType.Commander);
        rules.setGamesPerMatch(1);
        rules.setWarnAboutAICards(false);
        HostedMatch match = new HostedMatch();
        match.setStartGameHook(() -> {
            try {
                GameState state = new GameState();
                state.parse(List.of("activeplayer=p0", "activephase=MAIN1", "turn=3", "p0life=40", "p1life=40",
                    "p0battlefield=Island;Island;Island", "p1battlefield=Rod of Ruin|Id:1",
                    "p0hand=" + (stifle ? "Stifle" : "Counterspell"),
                    "p0library=Island;Island;Island;Island;Island", "p1library=Forest;Forest;Forest;Forest;Forest",
                    "p1putonstack=" + (stifle ? "1:1->Human;1:1->Human" : "Lightning Bolt->Human"),
                    "removesummoningsickness=true"));
                state.applyToGame(match.getGame());
                gui.pushStateNow();
            } catch (Exception error) {
                error.printStackTrace();
                gui.showErrorDialog(error.toString(), "Stack target smoke failed");
            }
        });
        match.startMatch(rules, null, List.of(human, opponent), human, gui);
        return match;
    }
}
