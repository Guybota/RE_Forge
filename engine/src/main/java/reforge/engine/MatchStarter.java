package reforge.engine;

import java.util.ArrayList;
import java.util.Collections;
import java.util.List;

import forge.deck.Deck;
import forge.game.GameRules;
import forge.game.GameType;
import forge.game.player.RegisteredPlayer;
import forge.gamemodes.match.HostedMatch;
import forge.localinstance.properties.ForgePreferences.FPref;
import forge.model.FModel;
import forge.player.GamePlayerUtil;
import forge.util.Localizer;

/** Starts a Commander game: the local player against 1–3 AI opponents, using Forge's precon decks. */
final class MatchStarter {
    private MatchStarter() { }

    /** "You" in Forge's current language ("Você", "Vous", …), capitalised to read as a name. */
    private static String playerName() {
        String you = Localizer.getInstance().getMessage("lblYou");
        return you.isEmpty() ? "You" : you.substring(0, 1).toUpperCase() + you.substring(1);
    }

    static List<String> commanderPreconNames() {
        List<String> names = new ArrayList<>(FModel.getDecks().getCommanderPrecons().getItemNames());
        Collections.sort(names);
        return names;
    }

    /** {@code deckName} null picks a random precon; opponents always get random ones. */
    static HostedMatch startCommander(WebGuiGame gui, String deckName, int opponents) {
        if (opponents < 1 || opponents > 3) {
            throw new IllegalArgumentException("opponents must be 1 to 3");
        }
        List<Deck> precons = new ArrayList<>();
        FModel.getDecks().getCommanderPrecons().forEach(precons::add);
        Collections.shuffle(precons);

        Deck mine = deckName == null ? precons.get(0) : FModel.getDecks().getCommanderPrecons().get(deckName);
        if (mine == null) {
            throw new IllegalArgumentException("Unknown deck: " + deckName);
        }
        precons.remove(mine);

        // Forge asks for a name when this preference is blank; we have no dialog for that.
        String name = playerName();
        FModel.getPreferences().setPref(FPref.PLAYER_NAME, name);
        // Replay recording serialises the whole game on every event; there is no replay viewer here yet.
        FModel.getPreferences().setPref(FPref.UI_RECORD_REPLAYS, false);
        // Tell the UI which cards can be used right now (playable, can attack, can block).
        FModel.getPreferences().setPref(FPref.UI_SHOW_ACTIONABLE_HIGHLIGHTS, true);

        GameRules rules = new GameRules(GameType.Commander);
        rules.setGamesPerMatch(1);
        // Forge's "the AI can't play these cards well" list is a deck-building hint, not something to show mid-game.
        rules.setWarnAboutAICards(false);

        List<RegisteredPlayer> players = new ArrayList<>();
        RegisteredPlayer human = RegisteredPlayer.forCommander(mine);
        human.setPlayer(GamePlayerUtil.getGuiPlayer(name, 0, 0, false));
        players.add(human);
        for (int i = 0; i < opponents; i++) {
            Deck deck = precons.get(i);
            RegisteredPlayer ai = RegisteredPlayer.forCommander(deck);
            ai.setPlayer(GamePlayerUtil.createAiPlayer(deck.getName(), i + 1));
            players.add(ai);
        }

        HostedMatch match = new HostedMatch();
        match.startMatch(rules, null, players, human, gui);
        return match;
    }
}
