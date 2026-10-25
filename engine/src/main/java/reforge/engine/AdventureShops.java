package reforge.engine;

import java.nio.file.*;
import java.util.*;
import com.google.gson.*;
import forge.item.PaperCard;

/** Town shops from Shandalar/world/shops.json, chosen per shop object like Forge's MapStage and stocked from a seed. */
final class AdventureShops {
    // shortcut: card shops only (item, booster-pack and land-sketchbook shops are skipped) and no paid restock.
    private final List<JsonObject> shops = new ArrayList<>();

    AdventureShops(Path root) throws Exception {
        for (JsonElement e : JsonParser.parseString(Files.readString(root.resolve("Shandalar/world/shops.json"))).getAsJsonArray()) {
            JsonObject shop = e.getAsJsonObject();
            boolean cards = false;
            if (shop.has("rewards")) for (JsonElement r : shop.getAsJsonArray("rewards")) {
                String type = CampaignStore.text(r.getAsJsonObject(), "type");
                cards |= type.isEmpty() || type.equals("card") || type.equals("Union");
            }
            if (cards) shops.add(shop);
        }
    }

    /** Shop object id → shops.json entry for one town map, the same every visit for this seed. */
    Map<String, JsonObject> assign(AdventureMap map, long seed) {
        Map<String, JsonObject> out = new LinkedHashMap<>();
        Random random = new Random(seed);
        Set<String> present = new HashSet<>();
        for (AdventureMap.Item item : map.items) {
            if (!item.type().equals("shop")) continue;
            Map<String, String> p = item.properties();
            String list = p.getOrDefault("rotation", "");
            if (list.isBlank()) {
                int rarity = random.nextInt(100);
                if (rarity > 95) list = p.getOrDefault("mythicShopList", "");
                if (list.isBlank() && rarity > 85) list = p.getOrDefault("rareShopList", "");
                if (list.isBlank() && rarity > 55) list = p.getOrDefault("uncommonShopList", "");
                if (list.isBlank()) list = p.getOrDefault("commonShopList", "");
                if (list.isBlank()) list = p.getOrDefault("shopList", "");
            }
            Set<String> names = new HashSet<>(Arrays.asList(list.replaceAll("\\s", "").split(",")));
            names.remove("");
            List<JsonObject> candidates = new ArrayList<>(), fresh = new ArrayList<>();
            for (JsonObject shop : shops) if (names.isEmpty() || names.contains(CampaignStore.text(shop, "name"))) candidates.add(shop);
            for (JsonObject shop : candidates) if (!present.contains(CampaignStore.text(shop, "name"))) fresh.add(shop);
            if (!fresh.isEmpty()) candidates = fresh;
            if (candidates.isEmpty()) continue;
            JsonObject shop = candidates.get(random.nextInt(candidates.size()));
            present.add(CampaignStore.text(shop, "name"));
            out.put(item.id(), shop);
        }
        return out;
    }

    /** The cards a shop sells, in a fixed order so purchases can be remembered by index. */
    static List<PaperCard> stock(JsonObject shop, long seed, byte colorIdentity) {
        Random random = new Random(seed);
        List<PaperCard> out = new ArrayList<>();
        for (JsonElement r : shop.getAsJsonArray("rewards")) {
            JsonObject reward = r.getAsJsonObject();
            String type = CampaignStore.text(reward, "type");
            if (type.isEmpty() || type.equals("card") || type.equals("Union")) out.addAll(AdventureCards.generate(reward, random, colorIdentity));
        }
        return out;
    }
}
