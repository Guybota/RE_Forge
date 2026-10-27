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
import forge.ai.AiProfileUtil;
import forge.util.Localizer;

/** Starts a Commander game: the local player against 1–3 AI opponents, using Forge's precon decks. */
final class MatchStarter {
    private MatchStarter() { }

    /** "You" in Forge's current language ("Você", "Vous", …), capitalised to read as a name. */
    static String playerName() {
        String you = Localizer.getInstance().getMessage("lblYou");
        return you.isEmpty() ? "You" : you.substring(0, 1).toUpperCase() + you.substring(1);
    }

    static List<String> myDeckNames() {
        List<String> names = new ArrayList<>(DeckImporter.mine().getItemNames());
        Collections.sort(names, String.CASE_INSENSITIVE_ORDER);
        return names;
    }

    static List<String> commanderPreconNames() {
        List<String> names = new ArrayList<>(FModel.getDecks().getCommanderPrecons().getItemNames());
        Collections.sort(names);
        return names;
    }

    /** The engine's AI settings: default profile ("" = random) and seconds per decision. Set from {@link Settings}. */
    static volatile String aiProfile = "Default";
    static volatile int aiTimeout = 5;

    /** The profile for an AI opponent whose match doesn't choose one. */
    static String defaultAiProfile() {
        return aiProfile.isEmpty() || !aiProfiles().contains(aiProfile) ? AiProfileUtil.getRandomProfile() : aiProfile;
    }

    /** The Forge preferences every local match relies on; returns the player's name. */
    static String preparePreferences() {
        // Read by HostedMatch when each game starts.
        FModel.getPreferences().setPref(FPref.MATCH_AI_TIMEOUT, String.valueOf(aiTimeout));
        // Between games of a match the AI sideboards its own deck; Forge's default would ask the human to do it.
        FModel.getPreferences().setPref(FPref.MATCH_AI_SIDEBOARDING_MODE, "AI");
        AiProfileUtil.setAiSideboardingMode(AiProfileUtil.AISideboardingMode.AI);
        // Forge asks for a name when this preference is blank; we have no dialog for that.
        String name = playerName();
        FModel.getPreferences().setPref(FPref.PLAYER_NAME, name);
        // Replay recording serialises the whole game on every event; there is no replay viewer here yet.
        FModel.getPreferences().setPref(FPref.UI_RECORD_REPLAYS, false);
        // Tell the UI which cards can be used right now (playable, can attack, can block).
        FModel.getPreferences().setPref(FPref.UI_SHOW_ACTIONABLE_HIGHLIGHTS, true);
        return name;
    }

    /** Forge's AI profiles (res/ai), easiest first; ones we don't know go last. */
    static List<String> aiProfiles() {
        List<String> order = List.of("Default", "Cautious", "Reckless", "Hard", "Hardest", "Experimental");
        List<String> names = new ArrayList<>(AiProfileUtil.getAvailableProfiles());
        names.sort(java.util.Comparator.comparing((String n) -> order.contains(n) ? order.indexOf(n) : order.size()).thenComparing(n -> n));
        return names;
    }

    /**
     * {@code deckName} null picks a random precon; opponents always get random ones.
     * {@code aiProfiles[i]} is opponent i's Forge AI profile: blank picks one at random, missing means Forge's default.
     */
    static HostedMatch startCommander(WebGuiGame gui, String deckName, String source, int opponents, List<String> aiProfiles) {
        Deck deck = deckName == null ? null : DeckSelection.find(deckName, source);
        if (deckName != null && deck == null) throw new IllegalArgumentException("Unknown deck: " + deckName);
        return startCommander(gui, deck, opponents, aiProfiles);
    }

    /** An external list is played in memory; it never replaces a deck in Forge's storage. */
    static HostedMatch startCommander(WebGuiGame gui, Deck supplied, int opponents, List<String> aiProfiles) {
        if (opponents < 1 || opponents > 3) {
            throw new IllegalArgumentException("opponents must be 1 to 3");
        }
        List<String> available = aiProfiles();
        for (String profile : aiProfiles) {
            if (!profile.isEmpty() && !available.contains(profile)) throw new IllegalArgumentException("Unknown AI profile: " + profile);
        }
        List<Deck> precons = new ArrayList<>();
        FModel.getDecks().getCommanderPrecons().forEach(precons::add);
        Collections.shuffle(precons);

        // The player's own (imported) decks first, then Forge's precons.
        Deck mine = supplied == null ? precons.get(0) : supplied;
        precons.remove(mine);

        String name = preparePreferences();

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
            String profile = i >= aiProfiles.size() ? "Default"
                    : aiProfiles.get(i).isEmpty() ? AiProfileUtil.getRandomProfile() : aiProfiles.get(i);
            ai.setPlayer(GamePlayerUtil.createAiPlayer(deck.getName(), i + 1, profile));
            players.add(ai);
        }

        HostedMatch match = new HostedMatch();
        match.startMatch(rules, null, players, human, gui);
        return match;
    }
}
