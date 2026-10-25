package reforge.engine;

import java.nio.file.*;
import java.util.*;
import com.google.gson.*;

/** Shandalar's overworld from Forge's biome and point-of-interest data, rebuilt from a saved seed without libGDX. */
final class AdventureWorld {
    // shortcut: biomes are decided per cell of 4×4 original tiles, and Forge's wave-function structures
    // (forests, ruins) are left out; generate per tile if coastlines look too square.
    static final int SIZE = 175, TILES = 4;
    /** {@code tags}: the POI's questTags, which quests use to pick destinations. */
    record Place(String id, String name, String type, String map, String atlas, String sprite, Set<String> tags, int x, int y) {
        boolean town() { return type.equals("town") || type.equals("capital"); }
    }
    record Enemy(String id, String name, int x, int y) { }
    final byte[] cells = new byte[SIZE * SIZE];
    final List<Place> places = new ArrayList<>();
    final List<Enemy> enemies = new ArrayList<>();
    final JsonObject json = new JsonObject();
    private final List<String> biomeNames = new ArrayList<>();
    final int startX, startY;

    AdventureWorld(Path root, long seed, Map<String, JsonObject> knownEnemies, AdventureSprites sprites) throws Exception {
        Path world = root.resolve("Shandalar/world");
        JsonObject config = read(world.resolve("world.json")).getAsJsonObject();
        double zoom = config.get("noiseZoomBiome").getAsDouble();
        JsonObject spriteConfig = read(root.resolve("common").resolve(config.get("biomesSprites").getAsString())).getAsJsonObject();
        String spriteAtlas = "common/" + spriteConfig.get("textureAtlas").getAsString();
        Map<String, JsonObject> decorations = new HashMap<>();
        for (JsonElement e : spriteConfig.getAsJsonArray("sprites")) decorations.put(CampaignStore.text(e.getAsJsonObject(), "name"), e.getAsJsonObject());
        Map<String, JsonObject> poiData = new HashMap<>();
        for (JsonElement e : read(root.resolve("common/world/points_of_interest.json")).getAsJsonArray())
            poiData.put(CampaignStore.text(e.getAsJsonObject(), "name"), e.getAsJsonObject());
        List<JsonObject> biomes = new ArrayList<>();
        for (JsonElement name : config.getAsJsonArray("biomesNames")) biomes.add(read(root.resolve("common").resolve(name.getAsString())).getAsJsonObject());
        if (biomes.size() > 100) throw new IllegalStateException("Too many Adventure biomes");
        JsonArray palette = new JsonArray();
        for (int i = 0; i < biomes.size(); i++) {
            JsonObject b = biomes.get(i);
            JsonObject colour = new JsonObject(); colour.addProperty("name", CampaignStore.text(b, "name")); colour.addProperty("color", "#" + CampaignStore.text(b, "color")); palette.add(colour);
            biomeNames.add(CampaignStore.text(b, "name"));
            String tileAtlas = "common/" + CampaignStore.text(b, "tilesetAtlas");
            colour.add("tiles", region(sprites, tileAtlas, CampaignStore.text(b, "tilesetName")));
            JsonArray variants = new JsonArray();
            if (b.has("terrain")) for (JsonElement t : b.getAsJsonArray("terrain")) {
                JsonObject variant = t.getAsJsonObject().deepCopy();
                variant.add("tiles", region(sprites, tileAtlas, CampaignStore.text(variant, "spriteName"))); variants.add(variant);
            }
            colour.add("terrain", variants);
            JsonArray decor = new JsonArray();
            if (b.has("spriteNames")) for (JsonElement name : b.getAsJsonArray("spriteNames")) {
                JsonObject d = decorations.get(name.getAsString()), r = region(sprites, spriteAtlas, name.getAsString());
                if (d == null || r == null) continue;
                d = d.deepCopy(); d.add("sprite", r); decor.add(d);
            }
            colour.add("decorations", decor);
            double cx = b.get("startPointX").getAsDouble() * SIZE, cy = b.get("startPointY").getAsDouble() * SIZE;
            double bw = b.get("width").getAsDouble() * SIZE, bh = b.get("height").getAsDouble() * SIZE;
            boolean whole = bw >= SIZE && bh >= SIZE, invert = b.has("invertHeight") && b.get("invertHeight").getAsBoolean();
            double nw = b.get("noiseWeight").getAsDouble(), dw = b.get("distWeight").getAsDouble();
            for (int y = 0; y < SIZE; y++) for (int x = 0; x < SIZE; x++) {
                if (!whole && (Math.abs(x - cx) > bw / 2 || Math.abs(y - cy) > bh / 2)) continue;
                // Same test as World.generateNew: noise plus distance to the biome centre, later biomes on top.
                double noise = noise(seed, x * zoom / SIZE, y * zoom / SIZE), dist = Math.hypot(x - cx, y - cy) / (Math.max(bw, bh) / 2) * dw;
                if (noise * nw + dist < 1 || invert && (1 - noise) * nw + dist < 1) cells[y * SIZE + x] = (byte) i;
            }
        }
        Random random = new Random(seed);
        boolean[] taken = new boolean[SIZE * SIZE];
        int[] start = nearestLand((int) (config.get("playerStartPosX").getAsDouble() * SIZE), (int) (config.get("playerStartPosY").getAsDouble() * SIZE));
        startX = start[0]; startY = start[1];
        claim(taken, startX, startY, 4);
        for (int i = 1; i < biomes.size(); i++) {
            JsonObject b = biomes.get(i);
            if (!b.has("pointsOfInterest")) continue;
            List<String> townNames = new ArrayList<>();
            Path names = world.resolve("town_names_" + CampaignStore.text(b, "name") + ".txt");
            if (Files.exists(names)) for (String line : Files.readAllLines(names)) if (!line.isBlank()) townNames.add(line.strip());
            Collections.shuffle(townNames, random);
            double cx = b.get("startPointX").getAsDouble() * SIZE, cy = b.get("startPointY").getAsDouble() * SIZE;
            double bw = b.get("width").getAsDouble() * SIZE, bh = b.get("height").getAsDouble() * SIZE;
            for (JsonElement poiName : b.getAsJsonArray("pointsOfInterest")) {
                JsonObject poi = poiData.get(poiName.getAsString());
                if (poi == null || CampaignStore.text(poi, "map").isEmpty()) continue;
                String type = CampaignStore.text(poi, "type");
                String map = Path.of("Shandalar").resolve(CampaignStore.text(poi, "map")).normalize().toString().replace('\\', '/');
                if (!Files.isRegularFile(root.resolve(map))) continue;
                double radiusFactor = poi.has("radiusFactor") ? poi.get("radiusFactor").getAsDouble() : 0;
                for (int n = 0; n < CampaignStore.number(poi, "count", 1); n++) for (int tries = 0; tries < 500; tries++) {
                    double radius = Math.sqrt(random.nextDouble() / 2 * radiusFactor), theta = random.nextDouble() * 2 * Math.PI;
                    int x = (int) (cx + radius * Math.cos(theta) * bw / 2 + decimal(poi, "offsetX") * bw);
                    int y = (int) (cy + radius * Math.sin(theta) * bh / 2 + decimal(poi, "offsetY") * bh);
                    if (x < 1 || y < 1 || x >= SIZE - 1 || y >= SIZE - 1 || cells[y * SIZE + x] != i || taken[y * SIZE + x]) continue;
                    String name = CampaignStore.text(poi, "displayName");
                    if (name.isEmpty() && (type.equals("town") || type.equals("capital")) && !townNames.isEmpty()) name = townNames.remove(townNames.size() - 1);
                    if (name.isEmpty()) name = CampaignStore.text(poi, "name");
                    // POI atlases are written relative to either the world folder or common/.
                    String atlas = CampaignStore.text(poi, "spriteAtlas");
                    atlas = atlas.startsWith("../") ? Path.of("Shandalar").resolve(atlas).normalize().toString().replace('\\', '/') : "common/" + atlas;
                    Set<String> tags = new HashSet<>();
                    if (poi.has("questTags")) for (JsonElement tag : poi.getAsJsonArray("questTags")) if (!tag.isJsonNull()) tags.add(tag.getAsString());
                    places.add(new Place("p" + places.size(), name, type, map, atlas, CampaignStore.text(poi, "sprite"), tags, x, y));
                    claim(taken, x, y, 1);
                    break;
                }
            }
        }
        for (int tries = 0; tries < 20_000 && enemies.size() < 160; tries++) {
            int x = random.nextInt(SIZE), y = random.nextInt(SIZE), biome = cells[y * SIZE + x];
            if (biome == 0 || taken[y * SIZE + x] || Math.max(Math.abs(x - startX), Math.abs(y - startY)) < 6 || !biomes.get(biome).has("enemies")) continue;
            List<String> choices = new ArrayList<>();
            for (JsonElement e : biomes.get(biome).getAsJsonArray("enemies")) if (AdventureCampaign.playable(knownEnemies.get(e.getAsString()))) choices.add(e.getAsString());
            if (choices.isEmpty()) continue;
            enemies.add(new Enemy("e" + enemies.size(), choices.get(random.nextInt(choices.size())), x, y));
            claim(taken, x, y, 1);
        }
        StringBuilder grid = new StringBuilder(cells.length);
        for (byte cell : cells) grid.append((char) ('0' + cell));
        // Terrain variants and decorations are only looks: the UI derives them per tile from this seed.
        json.addProperty("size", SIZE); json.addProperty("tiles", TILES); json.addProperty("zoom", zoom);
        json.addProperty("seed", (int) seed); json.add("biomes", palette); json.addProperty("cells", grid.toString());
    }
    private static JsonObject region(AdventureSprites sprites, String atlas, String name) {
        Map<String, JsonObject> used = new HashMap<>();
        String key = sprites.key(atlas, used, name);
        return key.isEmpty() ? null : used.get(key);
    }
    /** Forge's biome name at a cell ("white", "waste"…), for quest texts' $(biome_N). */
    String biomeName(int x, int y) { return land(x, y) ? biomeNames.get(cells[y * SIZE + x]) : biomeNames.get(0); }
    boolean land(int x, int y) { return x >= 0 && y >= 0 && x < SIZE && y < SIZE && cells[y * SIZE + x] != 0; }
    private int[] nearestLand(int x, int y) {
        for (int r = 0; r < SIZE; r++) for (int dy = -r; dy <= r; dy++) for (int dx = -r; dx <= r; dx++)
            if (Math.max(Math.abs(dx), Math.abs(dy)) == r && land(x + dx, y + dy)) return new int[]{x + dx, y + dy};
        throw new IllegalStateException("Adventure world has no land");
    }
    private static void claim(boolean[] taken, int x, int y, int r) {
        for (int yy = Math.max(0, y - r); yy <= Math.min(SIZE - 1, y + r); yy++) for (int xx = Math.max(0, x - r); xx <= Math.min(SIZE - 1, x + r); xx++) taken[yy * SIZE + xx] = true;
    }
    private static double decimal(JsonObject j, String key) { return j.has(key) ? j.get(key).getAsDouble() : 0; }
    private static JsonElement read(Path file) throws Exception { return JsonParser.parseString(Files.readString(file)); }
    /** Smooth value noise in [0, 1]; stands in for Forge's OpenSimplexNoise, which lives in the libGDX module. */
    static double noise(long seed, double x, double y) {
        int xi = (int) Math.floor(x), yi = (int) Math.floor(y);
        double fx = x - xi, fy = y - yi;
        fx = fx * fx * (3 - 2 * fx); fy = fy * fy * (3 - 2 * fy);
        double a = hash(seed, xi, yi), b = hash(seed, xi + 1, yi), c = hash(seed, xi, yi + 1), d = hash(seed, xi + 1, yi + 1);
        return a + (b - a) * fx + (c - a) * fy + (a - b - c + d) * fx * fy;
    }
    private static double hash(long seed, int x, int y) {
        long h = seed ^ x * 0x9E3779B97F4A7C15L ^ y * 0xC2B2AE3D27D4EB4FL;
        h = (h ^ (h >>> 31)) * 0xBF58476D1CE4E5B9L; h = (h ^ (h >>> 29)) * 0x94D049BB133111EBL;
        return ((h ^ (h >>> 32)) >>> 11) * 0x1.0p-53;
    }
}
