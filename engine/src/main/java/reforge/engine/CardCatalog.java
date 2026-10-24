package reforge.engine;

import java.text.Normalizer;
import java.util.Comparator;
import java.util.List;
import java.util.Locale;

import com.google.gson.JsonArray;
import com.google.gson.JsonElement;
import com.google.gson.JsonObject;

import forge.StaticData;
import forge.card.CardEdition;
import forge.card.CardRules;
import forge.deck.DeckFormat;
import forge.item.PaperCard;
import forge.model.FModel;
import forge.util.CardTranslation;

/** The deck builder's card catalog: Commander-legal cards searched by name (any language), colour, type and cost. */
final class CardCatalog {
    private CardCatalog() { }

    static final int PAGE = 60;
    /** Cards only ever printed in Un-sets (acorn/silver-bordered): not playable in Commander. */
    private static final com.google.common.base.Supplier<java.util.Set<String>> UN_ONLY = com.google.common.base.Suppliers.memoize(() -> {
        var db = FModel.getMagicDb().getCommonCards();
        return db.streamUniqueCards().map(PaperCard::getName).filter(name -> db.getAllCards(name).stream().allMatch(pc -> {
            CardEdition e = StaticData.instance().getEditions().get(pc.getEdition());
            return e != null && e.getType() == CardEdition.Type.FUNNY;
        })).collect(java.util.stream.Collectors.toSet());
    });
    /** Colour filter bit for colourless cards, next to Forge's W U B R G bits (1, 2, 4, 8, 16). */
    private static final int COLORLESS = 32;

    /**
     * {@code query} matches the English or translated name; {@code colors} is a mask (any of them, 32 = colourless);
     * {@code identity} keeps cards whose colour identity fits the commander's; {@code cardType} is a group from
     * {@link DeckImporter#group}; {@code cmc} 7 means 7 or more; {@code commanders} keeps cards that can lead a deck.
     */
    static JsonObject search(JsonObject q) {
        String text = normalize(string(q, "query"));
        int colors = integer(q, "colors", 0);
        int identity = integer(q, "identity", -1);
        int cmc = integer(q, "cmc", -1);
        String type = string(q, "cardType"); // "type" is the message's own field
        boolean commanders = q.has("commanders") && q.get("commanders").getAsBoolean();
        int offset = Math.max(0, integer(q, "offset", 0));

        List<PaperCard> matches = FModel.getMagicDb().getCommonCards().streamUniqueCards()
                // Arena-only rebalanced versions ("A-Name") have no paper printing or picture.
                .filter(pc -> !pc.getRules().isCustom() && !pc.isRebalanced() && !pc.getName().startsWith("A-")
                        && DeckFormat.Commander.isLegalCard(pc) && !UN_ONLY.get().contains(pc.getName()))
                .filter(pc -> {
                    CardRules r = pc.getRules();
                    if (commanders && !r.canBeCommander()) return false;
                    if (!type.isEmpty() && !type.equals(DeckImporter.group(pc))) return false;
                    int mv = r.getManaCost() == null ? 0 : r.getManaCost().getCMC();
                    if (cmc >= 0 && (cmc >= 7 ? mv < 7 : mv != cmc)) return false;
                    byte cardColors = r.getColor().getColor();
                    if (colors != 0 && (cardColors & colors) == 0 && !(cardColors == 0 && (colors & COLORLESS) != 0)) return false;
                    if (identity >= 0 && (r.getColorIdentity().getColor() & ~identity) != 0) return false;
                    return text.isEmpty() || normalize(pc.getName()).contains(text)
                            || normalize(CardTranslation.getTranslatedName(pc.getName())).contains(text);
                })
                // Exact names first, then names starting with the text, then the rest; each alphabetically.
                .sorted(Comparator.comparing((PaperCard pc) -> rank(pc, text))
                        .thenComparing(pc -> normalize(CardTranslation.getTranslatedName(pc.getName()))))
                .toList();

        JsonArray cards = new JsonArray();
        matches.stream().skip(offset).limit(PAGE).forEach(pc -> cards.add(card(pc)));
        JsonObject o = new JsonObject();
        o.addProperty("type", "cardResults");
        o.addProperty("total", matches.size());
        o.addProperty("offset", offset);
        o.add("cards", cards);
        return o;
    }

    /** Every printing of one card, newest first, for choosing the art. */
    static JsonObject printings(String name) {
        JsonArray list = new JsonArray();
        FModel.getMagicDb().getCommonCards().getAllCards(name).stream()
                .sorted(Comparator.comparing((PaperCard pc) -> {
                    CardEdition e = StaticData.instance().getEditions().get(pc.getEdition());
                    return e == null || e.getDate() == null ? new java.util.Date(0) : e.getDate();
                }).reversed())
                .forEach(pc -> {
                    JsonObject p = new JsonObject();
                    CardEdition e = StaticData.instance().getEditions().get(pc.getEdition());
                    p.addProperty("set", pc.getEdition());
                    p.addProperty("setName", e == null ? pc.getEdition() : e.getName());
                    p.addProperty("number", pc.getCollectorNumber());
                    p.addProperty("imageKey", pc.getImageKey(false));
                    list.add(p);
                });
        JsonObject o = new JsonObject();
        o.addProperty("type", "printings");
        o.addProperty("name", name);
        o.add("printings", list);
        return o;
    }

    /** What the builder needs to show and add a card. Shared with the decklist preview lines. */
    static JsonObject card(PaperCard pc) {
        CardRules r = pc.getRules();
        JsonObject o = new JsonObject();
        o.addProperty("nameEn", pc.getName());
        o.addProperty("name", CardTranslation.getTranslatedName(pc.getName()));
        o.addProperty("set", pc.getEdition());
        o.addProperty("number", pc.getCollectorNumber());
        o.addProperty("imageKey", pc.getImageKey(false));
        o.addProperty("cost", r.getManaCost() == null ? "" : r.getManaCost().toString());
        o.addProperty("cmc", r.getManaCost() == null ? 0 : r.getManaCost().getCMC());
        o.addProperty("type", CardTranslation.getTranslatedType(pc.getName(), r.getType().toString()));
        o.addProperty("group", DeckImporter.group(pc));
        o.addProperty("canCommand", r.canBeCommander());
        o.addProperty("identity", r.getColorIdentity().getColor());
        return o;
    }

    private static int rank(PaperCard pc, String text) {
        if (text.isEmpty()) return 0;
        String en = normalize(pc.getName()), local = normalize(CardTranslation.getTranslatedName(pc.getName()));
        if (en.equals(text) || local.equals(text)) return 0;
        return en.startsWith(text) || local.startsWith(text) ? 1 : 2;
    }

    private static String normalize(String s) {
        if (s == null) return "";
        return Normalizer.normalize(s, Normalizer.Form.NFD).replaceAll("\\p{M}", "").toLowerCase(Locale.ROOT).trim();
    }

    private static String string(JsonObject o, String key) {
        JsonElement e = o.get(key);
        return e == null || e.isJsonNull() ? "" : e.getAsString();
    }

    private static int integer(JsonObject o, String key, int fallback) {
        JsonElement e = o.get(key);
        return e == null || e.isJsonNull() ? fallback : e.getAsInt();
    }
}
