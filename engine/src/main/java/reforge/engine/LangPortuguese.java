package reforge.engine;

import java.lang.reflect.Field;
import java.util.Map;

import forge.util.Lang;

/**
 * Forge has no Portuguese grammar helpers and falls back to English, which leaks "2nd" and
 * "Opponent's Upkeep" into Portuguese prompts and logs. This one is registered under pt-BR.
 */
final class LangPortuguese extends Lang {
    /** Must run before Forge creates its Lang instance (FModel.initialize or a language change). */
    @SuppressWarnings("unchecked")
    static void register() {
        try {
            Field languages = Lang.class.getDeclaredField("languages");
            languages.setAccessible(true);
            ((Map<String, Lang>) languages.get(null)).put("pt-BR", new LangPortuguese());
        } catch (ReflectiveOperationException e) {
            System.err.println("Portuguese grammar unavailable, using English: " + e);
        }
    }

    @Override
    public String getOrdinal(final int position) {
        return position + ".º";
    }

    @Override
    public String getPossesive(final String name) {
        return "de " + name;
    }

    @Override
    public String getPossessedObject(final String owner, final String object) {
        return object + " " + getPossesive(owner);
    }
}
