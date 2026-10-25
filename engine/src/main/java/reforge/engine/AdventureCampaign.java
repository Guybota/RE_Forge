package reforge.engine;

import java.nio.file.*;
import java.util.*;
import com.google.gson.*;
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
    private JsonObject data;
    private AdventureWorld world;
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
        data.addProperty("hero", hero); data.addProperty("sex", sex);
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
        if (!region.isEmpty()) map = new AdventureMap(regionMap(region));
        if (data.has("battle")) { lose(); data.remove("battle"); }
    }
    private void openWorld() throws Exception {
        world = new AdventureWorld(root, data.get("seed").getAsLong(), enemies, sprites);
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
        AdventureMap next = new AdventureMap(regionMap(region));
        map = next; data.addProperty("region", region); data.addProperty("x", map.startX); data.addProperty("y", map.startY);
        data.add("rewards", new JsonArray());
    }
    void leave() { data.remove("region"); map = null; }
    void move(int dx, int dy) {
        if (Math.abs(dx) + Math.abs(dy) != 1) throw new IllegalArgumentException("Invalid movement");
        if (map == null) {
            int x = data.get("tx").getAsInt() + dx, y = data.get("ty").getAsInt() + dy;
            if (x >= 0 && y >= 0 && world.land(x / AdventureWorld.TILES, y / AdventureWorld.TILES)) { data.addProperty("tx", x); data.addProperty("ty", y); }
            return;
        }
        double x = data.get("x").getAsDouble(), y = data.get("y").getAsDouble();
        for (int i = 0; i < 4; i++) { if (!map.canStand(x + dx, y + dy)) break; x += dx; y += dy; }
        data.addProperty("x", x); data.addProperty("y", y);
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
            if (!place.type().equals("town") && !place.type().equals("capital")) { enter(id); return false; }
            // shortcut: towns only restore life; Forge's shops, inns and quest givers come with the missions step.
            data.addProperty("life", data.get("maxLife").getAsInt());
            JsonArray rewards = new JsonArray(); JsonObject rest = new JsonObject();
            rest.addProperty("kind", "rest"); rest.addProperty("name", place.name()); rewards.add(rest); data.add("rewards", rewards);
            return false;
        }
        AdventureMap.Item item = nearby(id);
        if (item.type().equals("enemy")) return true;
        if (item.type().equals("entry")) { leave(); return false; }
        JsonArray rewards = new JsonArray();
        String definition = item.properties().get("reward");
        if (definition != null && !definition.isBlank()) award(JsonParser.parseString(definition).getAsJsonArray(), null, rewards);
        data.getAsJsonArray("cleared").add(location(id)); data.add("rewards", rewards); storeCards();
        return false;
    }
    HostedMatch start(WebGuiGame gui, String id, CampaignStore store) throws Exception {
        Map<String, String> properties;
        if (map == null) {
            AdventureWorld.Enemy wandering = world.enemies.stream().filter(e -> e.id().equals(id) && !cleared(id) && near(e.x(), e.y())).findFirst()
                .orElseThrow(() -> new IllegalArgumentException("Move closer to interact"));
            properties = Map.of("enemy", wandering.name());
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
    private void award(JsonArray definitions, Deck source, JsonArray out) {
        for (JsonElement el : definitions) {
            JsonObject reward = el.getAsJsonObject();
            if (reward.has("probability") && random.nextFloat() >= reward.get("probability").getAsFloat()) continue;
            int count = Math.min(100, Math.max(0, CampaignStore.number(reward, "count", 0) + random.nextInt(Math.max(1, CampaignStore.number(reward, "addMaxCount", 0) + 1))));
            String type = CampaignStore.text(reward, "type");
            if (type.equals("gold") || type.equals("shards")) {
                data.addProperty(type, data.get(type).getAsInt() + count);
                JsonObject item = new JsonObject(); item.addProperty("kind", type); item.addProperty("count", count); out.add(item);
            } else if (type.equals("card") || type.equals("deckCard")) {
                List<PaperCard> possible = new ArrayList<>();
                Iterable<PaperCard> candidates = type.equals("deckCard") && source != null ? source.getMain().toFlatList() : FModel.getMagicDb().getCommonCards().getUniqueCards();
                for (PaperCard card : candidates) {
                    if (reward.has("rarity") && !matches(reward.getAsJsonArray("rarity"), card.getRarity().name())) continue;
                    if (reward.has("cardTypes") && !matches(reward.getAsJsonArray("cardTypes"), card.getRules().getType().toString())) continue;
                    if (reward.has("cardText") && !card.getRules().getOracleText().toLowerCase(Locale.ROOT).contains(reward.get("cardText").getAsString().toLowerCase(Locale.ROOT))) continue;
                    if (card.getName().startsWith("A-") || card.getRules().isCustom()) continue;
                    possible.add(card);
                }
                for (int i = 0; i < count && !possible.isEmpty(); i++) {
                    PaperCard card = possible.get(random.nextInt(possible.size())); pool.add(card, 1);
                    JsonObject item = CardCatalog.card(card); item.addProperty("kind", "card"); out.add(item);
                }
            }
        }
    }
    private static boolean matches(JsonArray values, String value) {
        String text = value.toLowerCase(Locale.ROOT).replace(" ", "");
        for (JsonElement v : values) if (text.contains(v.getAsString().toLowerCase(Locale.ROOT).replace(" ", ""))) return true;
        return false;
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
                objects.add(object(place.id(), place.type().equals("town") || place.type().equals("capital") ? "town" : "dungeon", place.name(), tile(place.x()), tile(place.y()), sprites.key(place.atlas(), used, place.sprite())));
            for (AdventureWorld.Enemy enemy : world.enemies) if (!cleared(enemy.id())) objects.add(object(enemy.id(), "enemy", enemy.name(), tile(enemy.x()), tile(enemy.y()), enemySprite(enemy.name(), used)));
        } else {
            out.add("map", map.json); out.add("x", data.get("x")); out.add("y", data.get("y"));
            String difficulty = CampaignStore.text(difficulty(), "name");
            for (AdventureMap.Item item : map.items) {
                if (cleared(item.id()) || item.properties().getOrDefault("spawn." + difficulty, "true").equals("false")) continue;
                String enemy = item.properties().getOrDefault("enemy", "");
                String atlas = item.properties().getOrDefault("sprite", "");
                String sprite = item.type().equals("enemy") ? enemySprite(enemy, used) : sprites.key(atlas.isEmpty() ? "" : "common/" + atlas, used, "Idle");
                objects.add(object(item.id(), item.type(), enemy, item.x(), item.y(), sprite));
            }
        }
        out.add("objects", objects);
        JsonObject catalog = new JsonObject(); used.forEach(catalog::add); out.add("sprites", catalog);
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
