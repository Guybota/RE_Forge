package reforge.engine;

import java.lang.reflect.Field;
import java.util.Enumeration;
import java.util.Map;
import java.util.ResourceBundle;

import forge.localinstance.properties.ForgePreferences.FPref;
import forge.model.FModel;
import forge.util.Lang;
import forge.util.Localizer;

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

    /**
     * Forge's pt-BR texts put the owner before the zone ("Escolha a carta de {0} {1}"), which only reads well
     * with an English possessive ("your library"); ours gives "de de você grimório". The owner goes after the zone.
     */
    private static final Map<String, String> ZONE_MESSAGES = Map.of(
            "lblSelectCardFromPlayerZone", "Escolha uma carta: {1} {0}",
            "lblSelectCardsFromPlayerZone", "Escolha cartas: {1} {0}",
            "lblSearchPlayerZoneConfirm", "Procurar: {1} {0}?",
            "lblPutThatCardFromPlayerOriginToDestination", "Mover a carta ({1} {0}) para: {2}?",
            "lblLookCardInPlayerZone", "Olhando as cartas: {1} {0}",
            "lblPlayerZone", "{1} {0}",
            "lblThereNoCardInPlayerZone", "Sem cartas: {1} {0}");

    /** Must run after Forge loads its messages (FModel.initialize or a language change). */
    static void fixMessages() {
        if (!"pt-BR".equals(FModel.getPreferences().getPref(FPref.UI_LANGUAGE))) return;
        try {
            Field bundle = Localizer.class.getDeclaredField("resourceBundle");
            bundle.setAccessible(true);
            ResourceBundle forge = (ResourceBundle) bundle.get(Localizer.getInstance());
            if (!(forge instanceof Overrides)) bundle.set(Localizer.getInstance(), new Overrides(forge));
        } catch (ReflectiveOperationException e) {
            System.err.println("Portuguese zone messages unavailable: " + e);
        }
    }

    /** Our texts first; every other key falls through to Forge's bundle. */
    private static final class Overrides extends ResourceBundle {
        Overrides(ResourceBundle forge) { setParent(forge); }
        @Override protected Object handleGetObject(String key) { return ZONE_MESSAGES.get(key); }
        @Override public Enumeration<String> getKeys() { return parent.getKeys(); }
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
