package reforge.engine;

import java.io.File;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;

import com.google.gson.JsonArray;
import com.google.gson.JsonObject;

import forge.deck.Deck;
import forge.game.GameRules;
import forge.game.GameType;
import forge.game.player.RegisteredPlayer;
import forge.gamemodes.match.HostedMatch;
import forge.gamemodes.puzzle.Puzzle;
import forge.gamemodes.puzzle.PuzzleIO;
import forge.localinstance.properties.ForgeConstants;
import forge.player.GamePlayerUtil;
import forge.util.FileSection;
import forge.util.FileUtil;

/**
 * Forge's puzzles ({@code res/puzzle/*.pzl}): a fixed game state, a goal and a turn limit against the AI. The list reads
 * each file's metadata itself because {@link Puzzle} keeps it private; solved puzzles are Forge's own
 * {@code .complete} markers in the user's puzzle folder.
 */
final class Puzzles {
    private Puzzles() { }

    private static final List<String> DIFFICULTIES = List.of("Common", "Uncommon", "Rare", "Mythic", "Special");

    static JsonObject list() {
        record Entry(String id, Map<String, String> meta) { }
        List<Entry> entries = new ArrayList<>();
        for (String id : ids()) entries.add(new Entry(id, metadata(sections(id))));
        // Easiest first, then by file: "MTGP_01" before "MTGP_10".
        entries.sort(java.util.Comparator.comparingInt((Entry e) -> {
            int d = DIFFICULTIES.indexOf(e.meta().getOrDefault("difficulty", ""));
            return d < 0 ? DIFFICULTIES.size() : d;
        }).thenComparing(Entry::id));
        JsonArray puzzles = new JsonArray();
        for (Entry e : entries) puzzles.add(json(e.id(), e.meta()));
        JsonObject o = new JsonObject();
        o.addProperty("type", "puzzles");
        o.add("puzzles", puzzles);
        return o;
    }

    private static JsonObject json(String id, Map<String, String> meta) {
        JsonObject p = new JsonObject();
        p.addProperty("id", id);
        p.addProperty("name", meta.getOrDefault("name", id));
        p.addProperty("difficulty", meta.getOrDefault("difficulty", ""));
        p.addProperty("goal", meta.getOrDefault("goal", "Win"));
        p.addProperty("turns", meta.getOrDefault("turns", ""));
        // Forge writes line breaks in descriptions as a literal backslash-n.
        p.addProperty("description", meta.getOrDefault("description", "").replace("\\n", "\n"));
        p.addProperty("solved", solved(id));
        return p;
    }

    /** Starts {@code id} like Forge's desktop puzzle screen; the result is saved when the match ends. */
    static HostedMatch start(WebGuiGame gui, String id) {
        if (!ids().contains(id)) throw new IllegalArgumentException("Unknown puzzle: " + id);
        Map<String, List<String>> sections = sections(id);
        Puzzle puzzle = new Puzzle(sections, id, solved(id));
        // Its goal card is added straight to the zone and never reaches the views: the table shows this instead.
        gui.setPuzzle(json(id, metadata(sections)));
        MatchStarter.preparePreferences();
        HostedMatch match = new HostedMatch();
        match.setStartGameHook(() -> puzzle.applyToGame(match.getGame()));
        match.setEndGameHook(() -> puzzle.savePuzzleSolve(match.getGame().getOutcome().isWinner(GamePlayerUtil.getGuiPlayer())));
        // Puzzles bring their own cards: both players start with empty decks and hands.
        RegisteredPlayer human = new RegisteredPlayer(new Deck()).setPlayer(GamePlayerUtil.getGuiPlayer(MatchStarter.playerName(), 0, 0, true));
        human.setStartingHand(0);
        RegisteredPlayer ai = new RegisteredPlayer(new Deck()).setPlayer(GamePlayerUtil.createAiPlayer());
        ai.setStartingHand(0);
        GameRules rules = new GameRules(GameType.Puzzle);
        rules.setGamesPerMatch(1);
        match.startMatch(rules, null, List.of(human, ai), human, gui);
        return match;
    }

    private static List<String> ids() {
        String[] files = new File(ForgeConstants.PUZZLE_DIR).list();
        List<String> ids = new ArrayList<>();
        if (files != null) for (String f : files) if (f.endsWith(PuzzleIO.SUFFIX_DATA)) ids.add(f.substring(0, f.length() - PuzzleIO.SUFFIX_DATA.length()));
        return ids;
    }

    private static Map<String, List<String>> sections(String id) {
        return FileSection.parseSections(FileUtil.readFile(ForgeConstants.PUZZLE_DIR + id + PuzzleIO.SUFFIX_DATA));
    }

    /** The [metadata] lines as lower-case keys ("Name:…" → name). */
    private static Map<String, String> metadata(Map<String, List<String>> sections) {
        Map<String, String> out = new java.util.HashMap<>();
        for (String line : sections.getOrDefault("metadata", List.of())) {
            String[] kv = line.split(":", 2);
            if (kv.length == 2) out.put(kv[0].trim().toLowerCase(java.util.Locale.ROOT), kv[1].trim());
        }
        return out;
    }

    private static boolean solved(String id) {
        return FileUtil.doesFileExist(ForgeConstants.USER_PUZZLE_DIR + id + PuzzleIO.SUFFIX_COMPLETE);
    }
}
