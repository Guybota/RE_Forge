package reforge.engine;

import java.util.Calendar;
import java.util.Locale;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

import com.google.gson.JsonArray;
import com.google.gson.JsonObject;
import forge.StaticData;
import forge.card.CardEdition;
import forge.deck.Deck;
import forge.deck.DeckSection;
import forge.model.FModel;

/** Small, native deck summaries for choosing a match. No card-image requests or full decklists. */
final class DeckSelection {
    /** Commander precon files are named "Deck [SET] [YEAR]". */
    private static final Pattern PRECON_STAMP = Pattern.compile("\\[([A-Za-z0-9]+)]\\s*\\[(\\d{4})]\\s*$");

    private DeckSelection() { }

    static Deck find(String name, String source) {
        if (source != null && !source.equals("mine") && !source.equals("precon")) throw new IllegalArgumentException("Unknown deck source");
        if ("mine".equals(source)) return DeckImporter.mine().get(name);
        if ("precon".equals(source)) return FModel.getDecks().getCommanderPrecons().get(name);
        return DeckImporter.mine().contains(name) ? DeckImporter.mine().get(name) : FModel.getDecks().getCommanderPrecons().get(name);
    }

    static JsonArray summaries() {
        JsonArray result = new JsonArray();
        MatchStarter.myDeckNames().forEach(name -> result.add(summary(name, "mine", DeckImporter.mine().get(name))));
        MatchStarter.commanderPreconNames().forEach(name -> result.add(summary(name, "precon", FModel.getDecks().getCommanderPrecons().get(name))));
        return result;
    }

    private static JsonObject summary(String name, String source, Deck deck) {
        JsonObject result = new JsonObject();
        result.addProperty("name", name);
        result.addProperty("source", source);
        int identity = 0, count = deck.getMain().countAll();
        JsonArray commanders = new JsonArray();
        if (deck.has(DeckSection.Commander)) {
            count += deck.get(DeckSection.Commander).countAll();
            for (var card : deck.get(DeckSection.Commander).toFlatList()) {
                identity |= card.getRules().getColorIdentity().getColor();
                commanders.add(CardCatalog.card(card));
            }
        }
        result.addProperty("cards", count);
        result.addProperty("identity", identity);
        result.add("commanders", commanders);
        if ("precon".equals(source)) preconRelease(result, name);
        return result;
    }

    /** Set code, edition name and release, so the shelf can follow publication order. */
    private static void preconRelease(JsonObject result, String name) {
        Matcher matcher = PRECON_STAMP.matcher(name);
        if (!matcher.find()) return;
        String code = matcher.group(1).toUpperCase(Locale.ROOT);
        int year = Integer.parseInt(matcher.group(2));
        CardEdition edition = StaticData.instance().getEditions().get(code);
        long released = edition != null && edition.getDate() != null
                ? edition.getDate().getTime()
                : new Calendar.Builder().setDate(year, Calendar.JANUARY, 1).build().getTimeInMillis();
        result.addProperty("set", code);
        result.addProperty("setName", edition == null || edition.getName() == null || edition.getName().isBlank() ? code : edition.getName());
        result.addProperty("released", released);
        result.addProperty("year", year);
    }
}
