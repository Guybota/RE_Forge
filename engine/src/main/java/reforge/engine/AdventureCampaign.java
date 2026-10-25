package reforge.engine;

import java.nio.file.*;
import java.util.*;
import com.google.gson.*;
import forge.card.MagicColor;
import forge.deck.*;
import forge.deck.io.DeckSerializer;
import forge.game.*;
import forge.game.player.RegisteredPlayer;
import forge.gamemodes.match.HostedMatch;
import forge.item.PaperCard;
import forge.localinstance.properties.ForgeConstants;
import forge.model.FModel;
import forge.player.GamePlayerUtil;

/** Adventure on Shandalar's overworld: original Tiled maps, decks, difficulties and reward data. */
final class AdventureCampaign {
    static final Map<String, String> REGIONS = Map.of(
        "rat", "common/maps/map/cave/cave_rat.tmx",
        "spider", "common/maps/map/cave/cave_spider.tmx",
        "snake", "common/maps/map/cave/cave_snake.tmx");
    private final Path root = Path.of(ForgeConstants.ADVENTURE_DIR).toAbsolutePath().normalize();
    private final JsonObject config;
    private final Map<String, JsonObject> enemies = new HashMap<>();
    private final Random random = new Random();
    private final AdventureSprites sprites;
    private final JsonObject heroes;
    private final AdventureShops shops;
    private JsonObject data;
    /** Shop object id → shops.json entry for the town map being explored. */
    private Map<String, JsonObject> townShops = Map.of();
    private final Map<String, List<PaperCard>> stocks = new HashMap<>();
    private AdventureWorld world;
    private AdventureQuests quests;
    private AdventureMap map;
    private CardPool pool;
    private Deck deck;
    private Deck opponent;

    AdventureCampaign() throws Exception {
        sprites = new AdventureSprites(root);
        config = JsonParser.parseString(Files.readString(root.resolve("common/config.json"))).getAsJsonObject();
        for (JsonElement e : JsonParser.parseString(Files.readString(root.resolve("common/world/enemies.json"))).getAsJsonArray()) {
            JsonObject enemy = e.getAsJsonObject(); enemies.put(CampaignStore.text(enemy, "name"), enemy);
        }
        heroes = JsonParser.parseString(Files.readString(root.resolve("common/world/heroes.json"))).getAsJsonObject();
        shops = new AdventureShops(root);
    }
    /** Forge's playable races with the portrait of each sex, for the creation form. */
    JsonArray heroes() {
        JsonArray out = new JsonArray();
        for (JsonElement e : heroes.getAsJsonArray("heroes")) {
            JsonObject hero = e.getAsJsonObject(), item = new JsonObject(), portraits = new JsonObject();
            item.addProperty("id", CampaignStore.text(hero, "name"));
            for (String sex : List.of("male", "female")) {
                Map<String, JsonObject> used = new HashMap<>();
                String key = sprites.key("common/" + CampaignStore.text(heroes, "avatar"), used, CampaignStore.text(hero, sex + "Avatar"));
                if (!key.isEmpty()) portraits.add(sex, used.get(key));
            }
            item.add("portraits", portraits); out.add(item);
        }
        return out;
    }
    private JsonObject hero(String name) {
        for (JsonElement e : heroes.getAsJsonArray("heroes")) if (CampaignStore.text(e.getAsJsonObject(), "name").equals(name)) return e.getAsJsonObject();
        return null;
    }
    void create(JsonObject meta, String color, int difficulty, String hero, String sex) throws Exception {
        if (!Set.of("W", "U", "B", "R", "G").contains(color) || difficulty < 0 || difficulty >= config.getAsJsonArray("difficulties").size()
                || hero(hero) == null || !Set.of("male", "female").contains(sex))
            throw new IllegalArgumentException("Invalid Adventure character");
        data = meta; data.addProperty("difficulty", difficulty);
        data.addProperty("hero", hero); data.addProperty("sex", sex); data.addProperty("color", color);
        JsonObject diff = difficulty();
        deck = DeckSerializer.fromFile(asset("common/" + diff.getAsJsonObject("constructedStarterDecks").get(color).getAsString()).toFile());
        pool = deck.getAllCardsInASinglePool();
        data.addProperty("life", diff.get("startingLife").getAsInt()); data.addProperty("maxLife", diff.get("startingLife").getAsInt());
        data.addProperty("gold", diff.get("startingMoney").getAsInt()); data.addProperty("shards", CampaignStore.number(diff, "startingShards", 0));
        data.addProperty("wins", 0); data.addProperty("losses", 0); data.add("cleared", new JsonArray());
        data.add("rewards", new JsonArray()); storeCards();
        data.addProperty("seed", random.nextLong()); openWorld();
    }
    void open(JsonObject meta) throws Exception {
        data = meta;
        pool = CampaignStore.readCards(data.getAsJsonArray("pool"));
        deck = new Deck("Adventure"); deck.getMain().addAll(CampaignStore.readCards(data.getAsJsonArray("deck")));
        if (!data.has("seed")) data.addProperty("seed", random.nextLong());
        openWorld();
        String region = CampaignStore.text(data, "region");
        if (!region.isEmpty()) load(region);
        if (data.has("battle")) { lose(); data.remove("battle"); }
    }
    private void openWorld() throws Exception {
        world = new AdventureWorld(root, data.get("seed").getAsLong(), enemies, sprites);
        quests = new AdventureQuests(root, world, enemies, random, (definitions, out) -> { award(definitions, null, out); storeCards(); });
        // The player walks original tiles; saves from the first open-world build kept whole cells in wx/wy.
        if (!data.has("tx")) {
            data.addProperty("tx", tile(data.has("wx") ? data.get("wx").getAsInt() : world.startX));
            data.addProperty("ty", tile(data.has("wy") ? data.get("wy").getAsInt() : world.startY));
            data.remove("wx"); data.remove("wy");
        }
    }
    static boolean playable(JsonObject enemy) {
        if (enemy == null || !enemy.has("deck")) return false;
        for (JsonElement e : enemy.getAsJsonArray("deck")) if (e.getAsString().endsWith(".dck")) return true;
        return false;
    }
    private AdventureWorld.Place place(String id) {
        return world.places.stream().filter(p -> p.id().equals(id)).findFirst().orElseThrow(() -> new IllegalArgumentException("Unknown Adventure region"));
    }
    private String regionMap(String region) { return REGIONS.containsKey(region) ? REGIONS.get(region) : place(region).map(); }
    /** Centre tile of a world cell. */
    private static int tile(int cell) { return cell * AdventureWorld.TILES + AdventureWorld.TILES / 2; }
    private boolean near(int x, int y) { return Math.max(Math.abs(tile(x) - data.get("tx").getAsInt()), Math.abs(tile(y) - data.get("ty").getAsInt())) <= AdventureWorld.TILES; }
    private JsonObject difficulty() { return config.getAsJsonArray("difficulties").get(data.get("difficulty").getAsInt()).getAsJsonObject(); }
    private Path asset(String name) throws Exception {
        Path real = root.resolve(name).normalize().toRealPath();
        if (!real.startsWith(root.toRealPath())) throw new IllegalArgumentException("Invalid Adventure asset");
        return real;
    }
    private void storeCards() { data.add("pool", CampaignStore.cards(pool, null)); data.add("deck", CampaignStore.cards(deck.getMain(), null)); }
    void saveDeck(JsonArray entries) { CardPool main = QuestCampaign.validated(entries, pool, DeckFormat.Adventure); deck.getMain().clear(); deck.getMain().addAll(main); storeCards(); }
    void enter(String region) throws Exception {
        if (map != null) throw new IllegalArgumentException("Leave the current region first");
        if (!REGIONS.containsKey(region) && !near(place(region).x(), place(region).y())) throw new IllegalArgumentException("Move closer to interact");
        load(region);
        data.addProperty("region", region); data.addProperty("x", map.startX); data.addProperty("y", map.startY);
        data.add("rewards", new JsonArray());
    }
    private void load(String region) throws Exception {
        map = new AdventureMap(regionMap(region));
        townShops = shops.assign(map, data.get("seed").getAsLong() ^ region.hashCode());
        stocks.clear();
    }
    void leave() {
        data.remove("region"); data.remove("shop"); map = null; townShops = Map.of();
        quests.left(data);
    }
    /** The starter colour stands in for Forge's colour identity in "colorID" rewards. */
    private byte colorIdentity() {
        return switch (CampaignStore.text(data, "color")) {
            case "W" -> MagicColor.WHITE; case "U" -> MagicColor.BLUE; case "B" -> MagicColor.BLACK;
            case "R" -> MagicColor.RED; case "G" -> MagicColor.GREEN; default -> MagicColor.ALL_COLORS;
        };
    }
    private long shopSeed(String object) { return data.get("seed").getAsLong() ^ (CampaignStore.text(data, "region") + ":" + object).hashCode() * 31L; }
    private boolean bought(String object, int index) {
        String key = CampaignStore.text(data, "region") + ":" + object + ":" + index;
        if (data.has("bought")) for (JsonElement e : data.getAsJsonArray("bought")) if (e.getAsString().equals(key)) return true;
        return false;
    }
    void buy(String key) {
        if (map == null || !data.has("shop")) throw new IllegalArgumentException("No shop open");
        String object = CampaignStore.text(data.getAsJsonObject("shop"), "object");
        int index;
        try { index = Integer.parseInt(key); } catch (NumberFormatException e) { throw new IllegalArgumentException("Unknown card"); }
        List<PaperCard> stock = stock(object);
        if (index < 0 || index >= stock.size() || bought(object, index)) throw new IllegalArgumentException("Card not for sale");
        int price = AdventureCards.price(stock.get(index));
        if (data.get("gold").getAsInt() < price) throw new IllegalArgumentException("Not enough gold");
        data.addProperty("gold", data.get("gold").getAsInt() - price);
        pool.add(stock.get(index), 1);
        if (!data.has("bought")) data.add("bought", new JsonArray());
        data.getAsJsonArray("bought").add(CampaignStore.text(data, "region") + ":" + object + ":" + index);
        storeCards();
    }
    void closeShop() { data.remove("shop"); }
    private List<PaperCard> stock(String object) {
        return stocks.computeIfAbsent(object, o -> AdventureShops.stock(townShops.get(o), shopSeed(o), colorIdentity()));
    }
    void move(int dx, int dy) {
        if (Math.abs(dx) + Math.abs(dy) != 1) throw new IllegalArgumentException("Invalid movement");
        if (map == null) {
            int x = data.get("tx").getAsInt() + dx, y = data.get("ty").getAsInt() + dy;
            if (x >= 0 && y >= 0 && world.land(x / AdventureWorld.TILES, y / AdventureWorld.TILES)) { data.addProperty("tx", x); data.addProperty("ty", y); }
            quests.moved(data, this::near);
            return;
        }
        double x = data.get("x").getAsDouble(), y = data.get("y").getAsDouble();
        for (int i = 0; i < 4; i++) { if (!map.canStand(x + dx, y + dy)) break; x += dx; y += dy; }
        data.addProperty("x", x); data.addProperty("y", y);
    }
    /** Still on the current region map: not beaten or taken, and spawned at this difficulty. */
    private boolean present(AdventureMap.Item item) {
        return !cleared(item.id()) && !item.properties().getOrDefault("spawn." + CampaignStore.text(difficulty(), "name"), "true").equals("false");
    }
    private String location(String id) { return (map == null ? "world" : CampaignStore.text(data, "region")) + ":" + id; }
    private boolean cleared(String id) { for (JsonElement e : data.getAsJsonArray("cleared")) if (e.getAsString().equals(location(id))) return true; return false; }
    private AdventureMap.Item nearby(String id) {
        if (map == null) throw new IllegalArgumentException("Not exploring a region");
        AdventureMap.Item item = map.items.stream().filter(i -> i.id().equals(id) && !cleared(id)).findFirst().orElseThrow(() -> new IllegalArgumentException("Encounter unavailable"));
        if (Math.hypot(item.x() - data.get("x").getAsDouble(), item.y() - data.get("y").getAsDouble()) > 30)
            throw new IllegalArgumentException("Move closer to interact");
        return item;
    }
    boolean interact(String id) throws Exception {
        if (map == null) {
            if (world.enemies.stream().anyMatch(e -> e.id().equals(id))) return true;
            AdventureWorld.Place place = place(id);
            if (!near(place.x(), place.y())) throw new IllegalArgumentException("Move closer to interact");
            enter(id);
            return false;
        }
        AdventureMap.Item item = nearby(id);
        switch (item.type()) {
            case "enemy" -> { return true; }
            case "entry" -> { leave(); return false; }
            case "inn" -> {
                // shortcut: Forge's inn charges for healing and sells temporary boons; here a night's rest is free.
                data.addProperty("life", data.get("maxLife").getAsInt());
                JsonArray rewards = new JsonArray(); JsonObject rest = new JsonObject();
                rest.addProperty("kind", "rest"); rest.addProperty("name", place(CampaignStore.text(data, "region")).name()); rewards.add(rest); data.add("rewards", rewards);
                return false;
            }
            case "quest" -> { quests.offer(data, place(CampaignStore.text(data, "region"))); return false; }
            case "shop" -> {
                if (!townShops.containsKey(id)) throw new IllegalArgumentException("This shop is closed");
                JsonObject open = new JsonObject(); open.addProperty("object", id); data.add("shop", open);
                return false;
            }
            default -> { }
        }
        JsonArray rewards = new JsonArray();
        String definition = item.properties().get("reward");
        if (definition != null && !definition.isBlank()) award(JsonParser.parseString(definition).getAsJsonArray(), null, rewards);
        data.getAsJsonArray("cleared").add(location(id)); data.add("rewards", rewards); storeCards();
        return false;
    }
    void acceptQuest() { quests.accept(data); }
    void declineQuest() { quests.decline(data); }
    void abandonQuest(String id) { quests.abandon(data, id); }
    HostedMatch start(WebGuiGame gui, String id, CampaignStore store) throws Exception {
        Map<String, String> properties;
        if (map == null) {
            String wandering = world.enemies.stream().filter(e -> e.id().equals(id) && !cleared(id) && near(e.x(), e.y())).map(AdventureWorld.Enemy::name).findFirst()
                .or(() -> quests.spawns(data).stream().filter(s -> CampaignStore.text(s, "id").equals(id) && near(s.get("x").getAsInt(), s.get("y").getAsInt()))
                    .map(s -> CampaignStore.text(s, "name")).findFirst())
                .orElseThrow(() -> new IllegalArgumentException("Move closer to interact"));
            properties = Map.of("enemy", wandering);
        } else {
            AdventureMap.Item item = nearby(id);
            if (!item.type().equals("enemy")) throw new IllegalArgumentException("Not an enemy");
            properties = item.properties();
        }
        JsonObject enemy = enemies.get(properties.get("enemy"));
        if (enemy == null) throw new IllegalArgumentException("Unknown Forge enemy");
        List<String> choices = new ArrayList<>();
        String override = properties.getOrDefault("deckOverride", "");
        if (!override.isBlank()) choices.add(override);
        else for (JsonElement e : enemy.getAsJsonArray("deck")) if (e.getAsString().endsWith(".dck")) choices.add(e.getAsString());
        if (choices.isEmpty()) throw new IllegalArgumentException("This enemy requires the Adventure generated-deck adapter");
        if (data.get("life").getAsInt() < 1) throw new IllegalArgumentException("This Adventure character is defeated");
        String problem = DeckFormat.Adventure.getDeckConformanceProblem(deck);
        if (problem != null) throw new IllegalArgumentException(problem);
        opponent = DeckSerializer.fromFile(asset("common/" + choices.get(random.nextInt(choices.size()))).toFile());
        RegisteredPlayer human = new RegisteredPlayer(deck).setPlayer(GamePlayerUtil.getGuiPlayer(CampaignStore.text(data, "name"), 0, 0, false));
        human.setStartingLife(data.get("life").getAsInt());
        RegisteredPlayer ai = new RegisteredPlayer(opponent).setPlayer(GamePlayerUtil.createAiPlayer(CampaignStore.text(enemy, "name"), 1));
        ai.setStartingLife(Math.max(1, Math.round(enemy.get("life").getAsFloat() * difficulty().get("enemyLifeFactor").getAsFloat())));
        String effect = properties.getOrDefault("effect", "");
        if (!effect.isBlank()) {
            JsonObject effects = JsonParser.parseString(effect).getAsJsonObject();
            if (effects.has("startBattleWithCard")) for (JsonElement name : effects.getAsJsonArray("startBattleWithCard")) {
                PaperCard card = FModel.getMagicDb().getCommonCards().getCard(name.getAsString());
                if (card != null) ai.addExtraCardsOnBattlefield(List.of(card));
            }
        }
        JsonObject pending = new JsonObject(); pending.addProperty("id", id); pending.addProperty("enemy", CampaignStore.text(enemy, "name"));
        data.add("battle", pending); store.save(data);
        GameRules rules = new GameRules(GameType.Adventure); rules.setGamesPerMatch(1); rules.setWarnAboutAICards(false);
        HostedMatch match = new HostedMatch(); match.startMatch(rules, null, List.of(human, ai), human, gui); return match;
    }
    void finish(GameView game) {
        boolean won = game.isMatchWonBy(GamePlayerUtil.getGuiPlayer());
        if (won) {
            JsonObject pending = data.getAsJsonObject("battle");
            JsonObject enemy = enemies.get(CampaignStore.text(pending, "enemy"));
            JsonArray rewards = new JsonArray();
            if (enemy.has("rewards")) award(enemy.getAsJsonArray("rewards"), opponent, rewards);
            data.add("rewards", rewards); data.getAsJsonArray("cleared").add(location(CampaignStore.text(pending, "id")));
            data.addProperty("wins", data.get("wins").getAsInt() + 1); data.addProperty("shards", data.get("shards").getAsInt() + 1);
            quests.won(data, CampaignStore.text(pending, "enemy"), CampaignStore.text(pending, "id"));
            if (map != null && map.items.stream().noneMatch(i -> i.type().equals("enemy") && present(i))) quests.cleared(data, CampaignStore.text(data, "region"));
            storeCards();
        } else lose();
        data.remove("battle"); opponent = null;
    }
    void abandon() { if (data.has("battle")) { lose(); data.remove("battle"); } }
    private void lose() {
        data.addProperty("losses", data.get("losses").getAsInt() + 1);
        data.addProperty("gold", (int) (data.get("gold").getAsInt() * (1 - difficulty().get("goldLoss").getAsFloat())));
        data.addProperty("life", Math.max(0, (int) (data.get("life").getAsInt() - data.get("maxLife").getAsInt() * difficulty().get("lifeLoss").getAsFloat())));
        data.add("rewards", new JsonArray());
    }
    /** Forge reward definitions: gold, shards, life and cards (filters as in AdventureCards; deckCard from the beaten deck). */
    private void award(JsonArray definitions, Deck source, JsonArray out) {
        for (JsonElement el : definitions) {
            JsonObject reward = el.getAsJsonObject();
            String type = CampaignStore.text(reward, "type");
            List<PaperCard> cards = List.of();
            if (type.equals("gold") || type.equals("shards") || type.equals("life")) {
                if (reward.has("probability") && random.nextFloat() >= reward.get("probability").getAsFloat()) continue;
                int count = Math.min(1000, Math.max(0, CampaignStore.number(reward, "count", 0) + random.nextInt(Math.max(1, CampaignStore.number(reward, "addMaxCount", 0) + 1))));
                if (type.equals("life")) { data.addProperty("maxLife", data.get("maxLife").getAsInt() + count); type = "maxLife"; }
                data.addProperty(type, data.get(type).getAsInt() + count);
                JsonObject item = new JsonObject(); item.addProperty("kind", type.equals("maxLife") ? "life" : type); item.addProperty("count", count); out.add(item);
            } else if (type.equals("deckCard") && source != null) {
                List<PaperCard> deckCards = source.getMain().toFlatList();
                java.util.function.Predicate<PaperCard> test = AdventureCards.filter(reward, colorIdentity());
                List<PaperCard> candidates = deckCards.stream().filter(test).toList();
                int count = CampaignStore.number(reward, "count", 1);
                if (!candidates.isEmpty() && !(reward.has("probability") && random.nextFloat() >= reward.get("probability").getAsFloat()))
                    cards = java.util.stream.IntStream.range(0, count).mapToObj(i -> candidates.get(random.nextInt(candidates.size()))).toList();
            } else if (type.equals("card") || type.equals("Union") || type.equals("randomCard")) cards = AdventureCards.generate(reward, random, colorIdentity());
            for (PaperCard card : cards) {
                pool.add(card, 1);
                JsonObject item = CardCatalog.card(card); item.addProperty("kind", "card"); out.add(item);
            }
        }
    }
    JsonObject state() {
        JsonObject out = new JsonObject();
        for (String field : List.of("life", "maxLife", "gold", "shards", "wins", "losses", "rewards")) out.add(field, data.get(field));
        out.add("cards", CampaignStore.cards(pool, deck.getMain()));
        out.addProperty("region", CampaignStore.text(data, "region"));
        Map<String, JsonObject> used = new HashMap<>();
        // Campaigns created before the hero choice play the male human.
        JsonObject hero = hero(data.has("hero") ? CampaignStore.text(data, "hero") : "Human");
        String heroAtlas = hero == null ? "" : CampaignStore.text(hero, data.has("sex") ? CampaignStore.text(data, "sex") : "male");
        out.addProperty("player", sprites.key(heroAtlas.isEmpty() ? "" : "common/" + heroAtlas, used, "IdleDown", "IdleRight", "Idle"));
        JsonArray objects = new JsonArray();
        if (map == null) {
            out.add("world", world.json); out.add("x", data.get("tx")); out.add("y", data.get("ty"));
            for (AdventureWorld.Place place : world.places)
                objects.add(object(place.id(), place.town() ? "town" : "dungeon", place.name(), tile(place.x()), tile(place.y()), sprites.key(place.atlas(), used, place.sprite())));
            for (AdventureWorld.Enemy enemy : world.enemies) if (!cleared(enemy.id())) objects.add(object(enemy.id(), "enemy", enemy.name(), tile(enemy.x()), tile(enemy.y()), enemySprite(enemy.name(), used)));
            for (JsonObject spawn : quests.spawns(data)) {
                String name = CampaignStore.text(spawn, "name");
                objects.add(object(CampaignStore.text(spawn, "id"), "enemy", name, tile(spawn.get("x").getAsInt()), tile(spawn.get("y").getAsInt()), enemySprite(name, used)));
            }
        } else {
            out.add("map", map.json); out.add("x", data.get("x")); out.add("y", data.get("y"));
            for (AdventureMap.Item item : map.items) {
                if (!present(item)) continue;
                String enemy = item.properties().getOrDefault("enemy", "");
                String atlas = item.properties().getOrDefault("sprite", "");
                String sprite = item.type().equals("enemy") ? enemySprite(enemy, used) : sprites.key(atlas.isEmpty() ? "" : "common/" + atlas, used, "Idle");
                JsonObject shop = townShops.get(item.id());
                JsonObject object = object(item.id(), item.type(), shop != null ? CampaignStore.text(shop, "name") : enemy, item.x(), item.y(), sprite);
                // The object's own tile (inn, quest giver, shop door…), drawn like Tiled does: bottom-left anchored.
                if (item.gid() != 0) { object.addProperty("gid", item.gid()); object.addProperty("w", item.w()); object.addProperty("h", item.h()); }
                if (shop != null) {
                    object.addProperty("title", CampaignStore.text(shop, "description"));
                    String sign = sprites.key("common/" + CampaignStore.text(shop, "spriteAtlas"), used, CampaignStore.text(shop, "sprite"));
                    if (!sign.isEmpty() && Boolean.parseBoolean(item.properties().getOrDefault("hasSign", "false"))) {
                        object.addProperty("sign", sign);
                        String overlay = sprites.key("common/" + CampaignStore.text(shop, "spriteAtlas"), used, CampaignStore.text(shop, "overlaySprite"));
                        if (!overlay.isEmpty()) object.addProperty("overlay", overlay);
                        object.addProperty("signX", Double.parseDouble(item.properties().getOrDefault("signXOffset", "0")));
                        object.addProperty("signY", Double.parseDouble(item.properties().getOrDefault("signYOffset", "0")));
                    }
                }
                objects.add(object);
            }
            if (data.has("shop")) out.add("shop", shopState(CampaignStore.text(data.getAsJsonObject("shop"), "object")));
        }
        out.add("objects", objects);
        JsonObject catalog = new JsonObject(); used.forEach(catalog::add); out.add("sprites", catalog);
        out.add("quests", questState());
        if (data.has("offer")) {
            JsonObject offer = new JsonObject(), pending = data.getAsJsonObject("offer");
            for (String field : List.of("name", "description", "dialog")) offer.add(field, pending.get(field));
            out.add("offer", offer);
        }
        return out;
    }
    /** Active quests for the UI: the current stage and where its targets are (world tiles). */
    private JsonArray questState() {
        JsonArray out = new JsonArray();
        for (JsonElement e : AdventureQuests.active(data)) {
            JsonObject quest = e.getAsJsonObject(), view = new JsonObject();
            for (String field : List.of("id", "name", "description", "source")) view.add(field, quest.get(field));
            JsonObject stage = quest.getAsJsonArray("stages").get(quest.get("stage").getAsInt()).getAsJsonObject().deepCopy();
            JsonArray targets = new JsonArray();
            if (stage.has("x")) targets.add(point(stage.get("x").getAsInt(), stage.get("y").getAsInt()));
            String objective = CampaignStore.text(stage, "objective");
            if (objective.equals("Defeat") || objective.equals("Hunt"))
                for (JsonElement s : quest.getAsJsonArray("spawns")) targets.add(point(s.getAsJsonObject().get("x").getAsInt(), s.getAsJsonObject().get("y").getAsInt()));
            stage.remove("x"); stage.remove("y"); stage.remove("place");
            view.add("stage", stage); view.add("targets", targets); out.add(view);
        }
        return out;
    }
    private static JsonArray point(int cellX, int cellY) { JsonArray p = new JsonArray(); p.add(tile(cellX)); p.add(tile(cellY)); return p; }
    private JsonObject shopState(String object) {
        JsonObject shop = townShops.get(object), out = new JsonObject();
        out.addProperty("name", CampaignStore.text(shop, "name")); out.addProperty("description", CampaignStore.text(shop, "description"));
        JsonArray items = new JsonArray();
        List<PaperCard> stock = stock(object);
        for (int i = 0; i < stock.size(); i++) {
            JsonObject card = CardCatalog.card(stock.get(i));
            card.addProperty("key", String.valueOf(i)); card.addProperty("price", AdventureCards.price(stock.get(i))); card.addProperty("sold", bought(object, i));
            items.add(card);
        }
        out.add("items", items);
        return out;
    }
    private String enemySprite(String name, Map<String, JsonObject> used) {
        JsonObject enemy = enemies.get(name);
        return enemy == null ? "" : sprites.key("common/" + CampaignStore.text(enemy, "sprite"), used, "Idle", "Avatar");
    }
    private static JsonObject object(String id, String kind, String name, double x, double y, String sprite) {
        JsonObject object = new JsonObject(); object.addProperty("id", id); object.addProperty("kind", kind);
        object.addProperty("name", name); object.addProperty("x", x); object.addProperty("y", y);
        if (!sprite.isEmpty()) object.addProperty("sprite", sprite);
        return object;
    }
}
