package reforge.engine;

import java.nio.file.*;
import java.util.*;
import com.google.gson.*;
import forge.gui.GuiBase;
import forge.localinstance.properties.ForgeConstants;

/**
 * Test-only: every town of several seeded worlds offers a resolvable side quest, and each stage advances from the
 * events the campaign sends (arrive, win, clear) until the quest pays out. Run by scripts/smoke-quests.mjs.
 */
public final class QuestHarness {
    /** args: Forge's assets folder (holding res/), a throw-away data folder. */
    public static void main(String[] args) throws Exception {
        System.setProperty("java.awt.headless", "true");
        Main.writeProfile(new java.io.File(args[0]), new java.io.File(args[1]));
        GuiBase.setInterface(new HeadlessGui(args[0]));
        forge.model.FModel.initialize(null, new Settings(new java.io.File(args[1]))::applyTo);
        Path root = Path.of(ForgeConstants.ADVENTURE_DIR).toRealPath();
        Map<String, JsonObject> enemies = new HashMap<>();
        for (JsonElement e : JsonParser.parseString(Files.readString(root.resolve("common/world/enemies.json"))).getAsJsonArray())
            enemies.put(e.getAsJsonObject().get("name").getAsString(), e.getAsJsonObject());
        AdventureSprites sprites = new AdventureSprites(root);
        Set<Integer> templatesSeen = new TreeSet<>();
        Set<String> objectives = new TreeSet<>();
        int offers = 0, finished = 0;
        for (long seed : new long[]{1, 2, 3}) {
            AdventureWorld world = new AdventureWorld(root, seed, enemies, sprites);
            Random random = new Random(seed);
            int[] paid = {0};
            AdventureQuests quests = new AdventureQuests(root, world, enemies, random, (defs, out) -> { paid[0] += defs.size(); JsonObject r = new JsonObject(); r.addProperty("kind", "gold"); out.add(r); });
            for (AdventureWorld.Place town : world.places) {
                if (!town.town()) continue;
                JsonObject data = new JsonObject(); data.addProperty("name", "Tester");
                quests.offer(data, town);
                offers++;
                JsonObject offer = data.getAsJsonObject("offer");
                check(offer.getAsJsonObject("dialog").getAsJsonArray("options").size() > 0 || !CampaignStore.text(offer.getAsJsonObject("dialog"), "text").isEmpty(), "offer has a dialog");
                java.util.regex.Matcher left = java.util.regex.Pattern.compile("\\$\\([a-z_0-9]+\\)").matcher(offer.toString());
                check(!left.find(), "tokens resolved in " + offer.get("name") + (left.hitEnd() ? "" : ": " + left.group()));
                templatesSeen.add(offer.get("template").getAsInt());
                quests.accept(data);
                check(!data.has("offer"), "offer cleared");
                // Play each stage through the events AdventureCampaign forwards.
                for (int guard = 0; guard < 10 && !AdventureQuests.active(data).isEmpty(); guard++) {
                    JsonObject quest = AdventureQuests.active(data).get(0).getAsJsonObject();
                    JsonObject stage = quest.getAsJsonArray("stages").get(quest.get("stage").getAsInt()).getAsJsonObject();
                    String objective = stage.get("objective").getAsString();
                    objectives.add(objective);
                    switch (objective) {
                        case "Travel" -> {
                            int x = stage.get("x").getAsInt(), y = stage.get("y").getAsInt();
                            quests.moved(data, (cx, cy) -> false);
                            check(quest.get("stage").getAsInt() == quest.getAsJsonArray("stages").asList().indexOf(stage), "travel waits for arrival");
                            quests.moved(data, (cx, cy) -> cx == x && cy == y);
                        }
                        case "Leave" -> quests.left(data);
                        case "Clear" -> { quests.cleared(data, "elsewhere"); quests.cleared(data, stage.get("place").getAsString()); }
                        case "Defeat", "Hunt" -> {
                            JsonArray spawns = quest.getAsJsonArray("spawns");
                            check(spawns.size() >= stage.get("count").getAsInt(), objective + " spawned its targets");
                            quests.won(data, "Nobody", "x");
                            for (JsonElement s : List.copyOf(spawns.asList())) quests.won(data, s.getAsJsonObject().get("name").getAsString(), s.getAsJsonObject().get("id").getAsString());
                        }
                        default -> throw new AssertionError("Unsupported stage reached: " + objective);
                    }
                }
                check(AdventureQuests.active(data).isEmpty(), "quest finished: " + offer.get("name"));
                JsonArray rewards = data.getAsJsonArray("rewards");
                check(rewards.size() >= 2 && rewards.get(0).getAsJsonObject().get("kind").getAsString().equals("quest"), "quest completion is reported");
                finished++;
            }
            check(paid[0] > 0, "rewards were granted");
        }
        // Active limit and one quest per town.
        AdventureWorld world = new AdventureWorld(root, 4, enemies, sprites);
        AdventureQuests quests = new AdventureQuests(root, world, enemies, new Random(4), (d, o) -> { });
        JsonObject data = new JsonObject();
        List<AdventureWorld.Place> towns = world.places.stream().filter(AdventureWorld.Place::town).toList();
        for (int i = 0; i < 3; i++) { quests.offer(data, towns.get(i)); quests.accept(data); }
        rejected(() -> quests.offer(data, towns.get(3)), "a fourth active quest");
        String id = AdventureQuests.active(data).get(0).getAsJsonObject().get("id").getAsString();
        quests.abandon(data, id);
        rejected(() -> quests.offer(data, towns.get(1)), "a second quest from the same town");
        quests.offer(data, towns.get(0)); quests.decline(data);
        check(!data.has("offer"), "declined offer cleared");
        // Towns: every distinct town map has its people and shops, and every shop stocks priced cards.
        AdventureShops shops = new AdventureShops(root);
        Set<String> townMaps = new TreeSet<>();
        for (AdventureWorld.Place p : world.places) if (p.town()) townMaps.add(p.map());
        int shopCount = 0, cards = 0; long started = System.currentTimeMillis();
        Set<String> kinds = new TreeSet<>();
        for (String townMap : townMaps) {
            AdventureMap map = new AdventureMap(townMap);
            Set<String> here = new HashSet<>();
            for (AdventureMap.Item item : map.items) here.add(item.type());
            kinds.addAll(here);
            check(here.contains("entry") && here.contains("shop"), townMap + " has an entry and shops: " + here);
            for (AdventureMap.Item item : map.items) if (!item.type().equals("enemy")) check(item.gid() != 0 || item.type().equals("entry"), townMap + " " + item.type() + " has a tile");
            Map<String, JsonObject> assigned = shops.assign(map, 7);
            check(assigned.equals(shops.assign(map, 7)), "shop choice is stable for a seed");
            for (Map.Entry<String, JsonObject> shop : assigned.entrySet()) {
                List<forge.item.PaperCard> stock = AdventureShops.stock(shop.getValue(), shop.getKey().hashCode(), forge.card.MagicColor.GREEN);
                check(!stock.isEmpty(), townMap + " shop " + shop.getValue().get("name") + " has stock");
                check(stock.equals(AdventureShops.stock(shop.getValue(), shop.getKey().hashCode(), forge.card.MagicColor.GREEN)), "stock is stable for a seed");
                for (forge.item.PaperCard card : stock) check(AdventureCards.price(card) > 0, "priced");
                shopCount++; cards += stock.size();
            }
        }
        System.out.println("Towns: " + townMaps.size() + " maps, kinds " + kinds + ", " + shopCount + " shops, " + cards + " cards, " + (System.currentTimeMillis() - started) + " ms");
        System.out.println("OK: " + offers + " offers, " + finished + " quests finished, templates " + templatesSeen + ", objectives " + objectives);
    }
    private static void check(boolean ok, String what) { if (!ok) throw new AssertionError(what); }
    private interface Action { void run() throws Exception; }
    private static void rejected(Action action, String what) throws Exception {
        try { action.run(); } catch (IllegalArgumentException expected) { return; }
        throw new AssertionError("accepted " + what);
    }
}
