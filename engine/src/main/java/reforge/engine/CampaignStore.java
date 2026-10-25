package reforge.engine;

import java.io.IOException;
import java.nio.file.*;
import java.util.*;
import com.google.gson.*;
import forge.card.CardDb;
import forge.deck.CardPool;
import forge.item.PaperCard;
import forge.localinstance.properties.ForgeConstants;
import forge.model.FModel;

/** RE:Forge metadata; Quest itself remains in Forge's native .dat files. */
final class CampaignStore {
    private static final Gson JSON = new GsonBuilder().setPrettyPrinting().create();
    private final Path root = Path.of(ForgeConstants.USER_DIR, "reforge-campaigns");

    List<JsonObject> list() throws IOException {
        Files.createDirectories(root);
        try (var files = Files.list(root)) {
            List<JsonObject> out = new ArrayList<>();
            for (Path p : files.filter(p -> p.getFileName().toString().matches("[a-f0-9-]{36}\\.json")).sorted().toList()) {
                try { out.add(JsonParser.parseString(Files.readString(p)).getAsJsonObject()); }
                catch (RuntimeException e) { System.err.println("Unreadable campaign: " + p.getFileName()); }
            }
            return out;
        }
    }

    JsonObject load(String id) throws IOException { return JsonParser.parseString(Files.readString(file(id))).getAsJsonObject(); }
    void save(JsonObject data) throws IOException {
        Files.createDirectories(root);
        Path file = file(text(data, "id"));
        Path temp = Files.createTempFile(root, ".campaign-", ".tmp");
        try {
            Files.writeString(temp, JSON.toJson(data));
            try { Files.move(temp, file, StandardCopyOption.REPLACE_EXISTING, StandardCopyOption.ATOMIC_MOVE); }
            catch (AtomicMoveNotSupportedException e) { Files.move(temp, file, StandardCopyOption.REPLACE_EXISTING); }
        } finally { Files.deleteIfExists(temp); }
    }
    void delete(String id) throws IOException { Files.deleteIfExists(file(id)); }
    private Path file(String id) {
        if (id == null || !id.matches("[a-f0-9-]{36}")) throw new IllegalArgumentException("Invalid campaign id");
        return root.resolve(id + ".json");
    }
    static String text(JsonObject j, String key) { return j.has(key) && !j.get(key).isJsonNull() ? j.get(key).getAsString() : ""; }
    static int number(JsonObject j, String key, int fallback) { return j.has(key) ? j.get(key).getAsInt() : fallback; }
    static String key(PaperCard c) { return c.getName() + "|" + c.getEdition() + "|" + c.getCollectorNumber() + "|" + c.isFoil(); }
    static JsonArray cards(Iterable<Map.Entry<PaperCard, Integer>> pool, CardPool deck) {
        JsonArray out = new JsonArray();
        for (var e : pool) {
            JsonObject c = CardCatalog.card(e.getKey());
            c.addProperty("key", key(e.getKey()));
            c.addProperty("owned", e.getValue());
            c.addProperty("qty", deck == null ? e.getValue() : deck.count(e.getKey()));
            out.add(c);
        }
        return out;
    }
    static CardPool readCards(JsonArray cards) {
        CardPool out = new CardPool();
        CardDb db = FModel.getMagicDb().getCommonCards();
        for (JsonElement el : cards) {
            JsonObject c = el.getAsJsonObject();
            PaperCard card = db.getCard(text(c, "nameEn"), text(c, "set"), text(c, "number"));
            if (card == null) throw new IllegalArgumentException("Missing campaign card: " + text(c, "nameEn"));
            if (text(c, "key").endsWith("|true")) card = card.getFoiled();
            out.add(card, number(c, "qty", 1));
        }
        return out;
    }
}
