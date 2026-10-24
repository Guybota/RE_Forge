package reforge.engine;

import java.io.File;
import java.io.IOException;
import java.io.InputStream;
import java.io.OutputStream;
import java.nio.file.Files;
import java.util.LinkedHashMap;
import java.util.Map;
import java.util.Properties;
import java.util.List;
import java.util.Set;
import java.util.stream.Collectors;

import com.google.gson.JsonArray;
import com.google.gson.JsonElement;
import com.google.gson.JsonObject;

import forge.localinstance.properties.ForgeConstants;
import forge.localinstance.properties.ForgePreferences;
import forge.localinstance.properties.ForgePreferences.FPref;
import forge.model.FModel;
import forge.util.CardTranslation;
import forge.util.Lang;
import forge.util.Localizer;

/**
 * RE:Forge's own settings (data/reforge.properties). Kept apart from Forge's preferences so we can
 * tell "chose English" from "hasn't chosen yet" and show the first-run language screen.
 */
final class Settings {
    // Untap never offers priority. Cleanup is only reached when Forge's rules require priority.
    static final List<String> PHASES = List.of("UPKEEP", "DRAW", "MAIN1", "COMBAT_BEGIN",
            "COMBAT_DECLARE_ATTACKERS", "COMBAT_DECLARE_BLOCKERS", "COMBAT_FIRST_STRIKE_DAMAGE",
            "COMBAT_DAMAGE", "COMBAT_END", "MAIN2", "END_OF_TURN", "CLEANUP");
    private static final Set<String> DEFAULT_MINE = Set.of("MAIN1", "MAIN2", "COMBAT_DECLARE_BLOCKERS");
    private static final Set<String> DEFAULT_OPPONENTS = Set.of("COMBAT_DECLARE_BLOCKERS", "END_OF_TURN");

    record PhaseStops(Set<String> mine, Set<String> opponents) {
        PhaseStops { mine = Set.copyOf(mine); opponents = Set.copyOf(opponents); }
    }
    /** Forge's translations (res/languages), shown by their own names. */
    static final Map<String, String> LANGUAGES = new LinkedHashMap<>();
    static {
        LANGUAGES.put("pt-BR", "Português");
        LANGUAGES.put("en-US", "English");
        LANGUAGES.put("es-ES", "Español");
        LANGUAGES.put("fr-FR", "Français");
        LANGUAGES.put("de-DE", "Deutsch");
        LANGUAGES.put("it-IT", "Italiano");
        LANGUAGES.put("ru-RU", "Русский");
        LANGUAGES.put("ja-JP", "日本語");
        LANGUAGES.put("ko-KR", "한국어");
        LANGUAGES.put("zh-CN", "简体中文");
    }

    private final File file;
    private final Properties props = new Properties();
    private volatile PhaseStops phaseStops;

    Settings(File dataDir) {
        file = new File(dataDir, "reforge.properties");
        if (file.isFile()) {
            try (InputStream in = Files.newInputStream(file.toPath())) {
                props.load(in);
            } catch (IOException e) {
                System.err.println("Could not read " + file + ": " + e.getMessage());
            }
        }
        phaseStops = new PhaseStops(readStops("phaseStops.mine", DEFAULT_MINE),
                readStops("phaseStops.opponents", DEFAULT_OPPONENTS));
    }

    private Set<String> readStops(String key, Set<String> fallback) {
        String value = props.getProperty(key);
        if (value == null) return fallback;
        return java.util.Arrays.stream(value.split(",")).map(String::trim).filter(PHASES::contains).collect(Collectors.toSet());
    }

    boolean stopsAt(boolean myTurn, String phase) {
        PhaseStops stops = phaseStops;
        return (myTurn ? stops.mine() : stops.opponents()).contains(phase);
    }

    JsonObject phaseStopsJson() {
        PhaseStops stops = phaseStops;
        JsonObject out = new JsonObject();
        out.add("mine", phasesJson(stops.mine()));
        out.add("opponents", phasesJson(stops.opponents()));
        return out;
    }

    private static JsonArray phasesJson(Set<String> stops) {
        JsonArray out = new JsonArray();
        PHASES.stream().filter(stops::contains).forEach(out::add);
        return out;
    }

    /** Validate both rows before saving, so an invalid update cannot partially change settings. */
    synchronized void changePhaseStops(JsonObject value) throws IOException {
        PhaseStops next = value == null ? new PhaseStops(DEFAULT_MINE, DEFAULT_OPPONENTS)
                : new PhaseStops(parseStops(value.get("mine")), parseStops(value.get("opponents")));
        Properties before = (Properties) props.clone();
        props.setProperty("phaseStops.mine", PHASES.stream().filter(next.mine()::contains).collect(Collectors.joining(",")));
        props.setProperty("phaseStops.opponents", PHASES.stream().filter(next.opponents()::contains).collect(Collectors.joining(",")));
        try {
            save();
            phaseStops = next;
        } catch (IOException e) {
            props.clear();
            props.putAll(before);
            throw e;
        }
    }

    private static Set<String> parseStops(JsonElement value) {
        if (value == null || !value.isJsonArray()) throw new IllegalArgumentException("Phase stops must be arrays");
        Set<String> out = new java.util.HashSet<>();
        for (JsonElement phase : value.getAsJsonArray()) {
            if (!phase.isJsonPrimitive() || !phase.getAsJsonPrimitive().isString() || !PHASES.contains(phase.getAsString())) {
                throw new IllegalArgumentException("Unknown phase stop: " + phase);
            }
            out.add(phase.getAsString());
        }
        return out;
    }

    /** The chosen language code, or null before the player has picked one. */
    String language() {
        String lang = props.getProperty("language");
        return LANGUAGES.containsKey(lang) ? lang : null;
    }

    /** The chosen skin id, or null before the player has picked one. The UI owns the list of skins. */
    String skin() {
        String skin = props.getProperty("skin");
        return skin != null && skin.matches("[a-z]{1,20}") ? skin : null;
    }

    synchronized void changeSkin(String id) throws IOException {
        if (id == null || !id.matches("[a-z]{1,20}")) {
            throw new IllegalArgumentException("Invalid skin: " + id);
        }
        props.setProperty("skin", id);
        save();
    }

    private synchronized void save() throws IOException {
        var target = file.toPath().toAbsolutePath();
        Files.createDirectories(target.getParent());
        var temporary = Files.createTempFile(target.getParent(), "reforge-", ".tmp");
        try {
            try (OutputStream out = Files.newOutputStream(temporary)) {
                props.store(out, "RE:Forge settings");
            }
            try {
                Files.move(temporary, target, java.nio.file.StandardCopyOption.REPLACE_EXISTING,
                        java.nio.file.StandardCopyOption.ATOMIC_MOVE);
            } catch (java.nio.file.AtomicMoveNotSupportedException e) {
                Files.move(temporary, target, java.nio.file.StandardCopyOption.REPLACE_EXISTING);
            }
        } finally {
            Files.deleteIfExists(temporary);
        }
    }

    /** Sets Forge's language before it loads its texts (FModel.initialize's preference hook). */
    Void applyTo(ForgePreferences prefs) {
        if (language() != null) {
            prefs.setPref(FPref.UI_LANGUAGE, language());
        }
        return null;
    }

    /** Switches Forge's messages and card texts now and remembers the choice. Not while a game runs. */
    synchronized void changeLanguage(String code) throws IOException {
        if (!LANGUAGES.containsKey(code)) {
            throw new IllegalArgumentException("Unknown language: " + code);
        }
        FModel.getPreferences().setPref(FPref.UI_LANGUAGE, code);
        FModel.getPreferences().save();
        Lang.createInstance(code);
        Localizer.getInstance().initialize(code, ForgeConstants.LANG_DIR);
        CardTranslation.preloadTranslation(code, ForgeConstants.LANG_DIR);

        props.setProperty("language", code);
        save();
    }
}
