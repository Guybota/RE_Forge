package reforge.engine;

import com.google.gson.JsonArray;
import com.google.gson.JsonObject;
import forge.deck.Deck;
import forge.deck.DeckSection;
import forge.model.FModel;

/** Small, native deck summaries for choosing a match. No card-image requests or full decklists. */
final class DeckSelection {
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
        return result;
    }
}
