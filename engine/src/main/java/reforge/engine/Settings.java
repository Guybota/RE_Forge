package reforge.engine;

import java.io.File;
import java.io.IOException;
import java.io.InputStream;
import java.io.OutputStream;
import java.nio.file.Files;
import java.util.LinkedHashMap;
import java.util.Map;
import java.util.Properties;

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

    Settings(File dataDir) {
        file = new File(dataDir, "reforge.properties");
        if (file.isFile()) {
            try (InputStream in = Files.newInputStream(file.toPath())) {
                props.load(in);
            } catch (IOException e) {
                System.err.println("Could not read " + file + ": " + e.getMessage());
            }
        }
    }

    /** The chosen language code, or null before the player has picked one. */
    String language() {
        String lang = props.getProperty("language");
        return LANGUAGES.containsKey(lang) ? lang : null;
    }

    private void save() throws IOException {
        file.getParentFile().mkdirs();
        try (OutputStream out = Files.newOutputStream(file.toPath())) {
            props.store(out, "RE:Forge settings");
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
    void changeLanguage(String code) throws IOException {
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
