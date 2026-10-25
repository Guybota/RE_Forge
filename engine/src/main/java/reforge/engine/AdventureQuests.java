package reforge.engine;

import java.nio.file.*;
import java.util.*;
import java.util.function.*;
import java.util.regex.*;
import com.google.gson.*;

/**
 * Forge's Adventure side quests (Shandalar/world/quests.json) on our overworld: town quest givers offer a template,
 * its targets and texts are resolved at offer time (like AdventureQuestData.initialize) and the stages advance from
 * campaign events. Saved inside the campaign JSON.
 */
final class AdventureQuests {
    // shortcut: story quests and the Arena, flag, item and reputation objectives are left out; add them with the
    // dialogs and items that drive them.
    static final Set<String> SUPPORTED = Set.of("Defeat", "Hunt", "Travel", "Clear", "Leave");
    static final int MAX_ACTIVE = 3; // Forge's maximumSideQuests
    private static final Pattern QUEST_TYPE = Pattern.compile("name=\"questtype\" value=\"([^\"]+)\"");
    private static final Map<String, Boolean> PLAYABLE_MAPS = new HashMap<>();
    private final List<JsonObject> templates = new ArrayList<>();
    private final Path root;
    private final AdventureWorld world;
    private final Map<String, JsonObject> enemies;
    private final Random random;
    /** Grants Forge reward definitions into the campaign and lists what was given in {@code out}. */
    private final BiConsumer<JsonArray, JsonArray> award;

    AdventureQuests(Path root, AdventureWorld world, Map<String, JsonObject> enemies, Random random, BiConsumer<JsonArray, JsonArray> award) throws Exception {
        this.root = root; this.world = world; this.enemies = enemies; this.random = random; this.award = award;
        for (JsonElement e : JsonParser.parseString(Files.readString(root.resolve("Shandalar/world/quests.json"))).getAsJsonArray()) {
            JsonObject q = e.getAsJsonObject();
            if (bool(q, "storyQuest") || !q.has("stages") || q.getAsJsonArray("stages").isEmpty()) continue;
            boolean supported = true;
            for (JsonElement s : q.getAsJsonArray("stages")) supported &= SUPPORTED.contains(CampaignStore.text(s.getAsJsonObject(), "objective"));
            if (supported) templates.add(q);
        }
    }

    static JsonArray active(JsonObject data) {
        if (!data.has("quests")) data.add("quests", new JsonArray());
        return data.getAsJsonArray("quests");
    }

    /** The quest a town offers now, resolved and kept in {@code data.offer} until accepted or declined. */
    void offer(JsonObject data, AdventureWorld.Place town) throws Exception {
        if (!town.town()) throw new IllegalArgumentException("Only towns give quests");
        JsonArray quests = active(data);
        if (quests.size() >= MAX_ACTIVE) throw new IllegalArgumentException("Too many active quests");
        Set<Integer> taken = new HashSet<>();
        for (JsonElement q : quests) {
            if (CampaignStore.text(q.getAsJsonObject(), "source").equals(town.id())) throw new IllegalArgumentException("This town's quest is still active");
            taken.add(q.getAsJsonObject().get("template").getAsInt());
        }
        // The town map's questtype property, and its file name too: Forge's property has a typo for one plains town.
        Set<String> questTypes = new HashSet<>(Set.of(Path.of(town.map()).getFileName().toString().replace(".tmx", "")));
        Matcher type = QUEST_TYPE.matcher(Files.readString(root.resolve(town.map())));
        if (type.find()) questTypes.add(type.group(1));
        List<JsonObject> options = new ArrayList<>(), anywhere = new ArrayList<>();
        for (JsonObject t : templates) {
            if (taken.contains(t.get("id").getAsInt())) continue;
            JsonArray sources = t.has("questSourceTags") && !t.get("questSourceTags").isJsonNull() ? t.getAsJsonArray("questSourceTags") : new JsonArray();
            if (sources.isEmpty()) anywhere.add(t);
            for (JsonElement s : sources) if (questTypes.contains(s.getAsString())) { options.add(t); break; }
        }
        Collections.shuffle(options, random); Collections.shuffle(anywhere, random);
        options.addAll(anywhere);
        for (JsonObject template : options) {
            JsonObject quest = resolve(data, template, town);
            if (quest != null) { data.add("offer", quest); return; }
        }
        throw new IllegalArgumentException("No quest available here");
    }

    void accept(JsonObject data) {
        if (!data.has("offer")) throw new IllegalArgumentException("No quest offered");
        JsonObject quest = data.getAsJsonObject("offer"); data.remove("offer");
        quest.remove("dialog");
        active(data).add(quest);
    }
    void decline(JsonObject data) { data.remove("offer"); }
    void abandon(JsonObject data, String id) {
        JsonArray quests = active(data);
        for (int i = 0; i < quests.size(); i++) if (CampaignStore.text(quests.get(i).getAsJsonObject(), "id").equals(id)) { quests.remove(i); return; }
        throw new IllegalArgumentException("Unknown quest");
    }

    /** Quest-only enemies still waiting on the world map (Defeat and Hunt targets). */
    List<JsonObject> spawns(JsonObject data) {
        List<JsonObject> out = new ArrayList<>();
        for (JsonElement q : active(data)) for (JsonElement s : q.getAsJsonObject().getAsJsonArray("spawns")) out.add(s.getAsJsonObject());
        return out;
    }

    /** The player stands on (x, y) cells: arrive at Travel destinations. */
    void moved(JsonObject data, BiPredicate<Integer, Integer> near) {
        for (JsonObject quest : List.copyOf(list(data))) {
            JsonObject stage = stage(quest);
            if (stage != null && CampaignStore.text(stage, "objective").equals("Travel") && near.test(stage.get("x").getAsInt(), stage.get("y").getAsInt()))
                complete(data, quest);
        }
    }
    /** The player walked out of a town or dungeon (Forge's LEAVEPOI). */
    void left(JsonObject data) {
        for (JsonObject quest : List.copyOf(list(data))) {
            JsonObject stage = stage(quest);
            if (stage != null && CampaignStore.text(stage, "objective").equals("Leave")) complete(data, quest);
        }
    }
    /** A won battle against {@code enemy} (a quest spawn's id when it was one). */
    void won(JsonObject data, String enemy, String enemyId) {
        for (JsonObject quest : List.copyOf(list(data))) {
            JsonArray spawns = quest.getAsJsonArray("spawns");
            for (int i = 0; i < spawns.size(); i++) if (CampaignStore.text(spawns.get(i).getAsJsonObject(), "id").equals(enemyId)) { spawns.remove(i); break; }
            JsonObject stage = stage(quest);
            if (stage == null || !CampaignStore.text(stage, "enemy").equals(enemy)) continue;
            String objective = CampaignStore.text(stage, "objective");
            if (objective.equals("Hunt") && !enemyId.startsWith(CampaignStore.text(quest, "id") + "_")) continue;
            if (!objective.equals("Defeat") && !objective.equals("Hunt")) continue;
            stage.addProperty("progress", stage.get("progress").getAsInt() + 1);
            if (stage.get("progress").getAsInt() >= stage.get("count").getAsInt()) complete(data, quest);
        }
    }
    /** Every enemy of the dungeon at {@code placeId} has been beaten. */
    void cleared(JsonObject data, String placeId) {
        for (JsonObject quest : List.copyOf(list(data))) {
            JsonObject stage = stage(quest);
            if (stage != null && CampaignStore.text(stage, "objective").equals("Clear") && CampaignStore.text(stage, "place").equals(placeId)) complete(data, quest);
        }
    }

    private static List<JsonObject> list(JsonObject data) {
        List<JsonObject> out = new ArrayList<>();
        for (JsonElement q : active(data)) out.add(q.getAsJsonObject());
        return out;
    }
    private static JsonObject stage(JsonObject quest) {
        int at = quest.get("stage").getAsInt();
        JsonArray stages = quest.getAsJsonArray("stages");
        return at < stages.size() ? stages.get(at).getAsJsonObject() : null;
    }
    /** Next stage; a quest past its last stage pays out. */
    private void complete(JsonObject data, JsonObject quest) {
        quest.addProperty("stage", quest.get("stage").getAsInt() + 1);
        if (stage(quest) != null) return;
        JsonArray quests = active(data);
        for (int i = 0; i < quests.size(); i++) if (quests.get(i).equals(quest)) { quests.remove(i); break; }
        JsonArray given = new JsonArray();
        award.accept(quest.getAsJsonArray("rewards"), given);
        JsonObject done = new JsonObject();
        done.addProperty("kind", "quest"); done.addProperty("title", CampaignStore.text(quest, "name")); done.addProperty("message", CampaignStore.text(quest, "epilogue"));
        if (!data.has("rewards") || !data.get("rewards").isJsonArray()) data.add("rewards", new JsonArray());
        data.getAsJsonArray("rewards").add(done); data.getAsJsonArray("rewards").addAll(given);
    }

    /** Pick targets for every stage; null when this world cannot host the template (no matching enemy or place). */
    private JsonObject resolve(JsonObject data, JsonObject template, AdventureWorld.Place town) throws Exception {
        Map<String, String> tokens = new HashMap<>();
        tokens.put("$(playername)", CampaignStore.text(data, "name"));
        tokens.put("$(playerrace)", data.has("hero") ? CampaignStore.text(data, "hero") : "Human");
        tokens.put("$(currentbiome)", world.biomeName(town.x(), town.y()));
        Map<String, AdventureWorld.Place> poiTokens = new HashMap<>();
        int uid = CampaignStore.number(data, "questSeq", 0) + 1;
        String questId = "q" + uid;
        JsonArray stages = new JsonArray(), spawns = new JsonArray();
        for (JsonElement e : template.getAsJsonArray("stages")) {
            JsonObject s = e.getAsJsonObject(), stage = new JsonObject();
            String objective = CampaignStore.text(s, "objective"), stageId = s.has("id") ? s.get("id").getAsString() : String.valueOf(stages.size() + 1);
            stage.addProperty("objective", objective); stage.addProperty("progress", 0);
            stage.addProperty("count", Math.max(1, CampaignStore.number(s, "count3", 1)));
            if (objective.equals("Defeat") || objective.equals("Hunt")) {
                String enemy = pickEnemy(strings(s, "enemyTags"), strings(s, "enemyExcludeTags"));
                if (enemy == null) return null;
                if (objective.equals("Hunt")) stage.addProperty("count", 1);
                stage.addProperty("enemy", enemy);
                tokens.put("$(enemy_" + stageId + ")", enemy);
                // Quest enemies appear around the town, so every Defeat/Hunt target can be found.
                for (int k = 0; k < stage.get("count").getAsInt(); k++) {
                    int[] at = freeCell(town, data, spawns);
                    if (at == null) return null;
                    JsonObject spawn = new JsonObject();
                    spawn.addProperty("id", questId + "_" + spawns.size()); spawn.addProperty("name", enemy);
                    spawn.addProperty("x", at[0]); spawn.addProperty("y", at[1]); spawns.add(spawn);
                }
            } else if (objective.equals("Travel") || objective.equals("Clear")) {
                AdventureWorld.Place target = pickPlace(s, town, poiTokens, objective.equals("Clear"));
                if (target == null) return null;
                stage.addProperty("place", target.id()); stage.addProperty("x", target.x()); stage.addProperty("y", target.y());
                poiTokens.put("$(poi_" + stageId + ")", target);
                tokens.put("$(poi_" + stageId + ")", target.name());
                tokens.put("$(biome_" + stageId + ")", world.biomeName(target.x(), target.y()));
            }
            // Forge gives every stage a POI; for Leave/Defeat/Hunt texts that is the quest giver's town.
            if (!poiTokens.containsKey("$(poi_" + stageId + ")")) {
                poiTokens.put("$(poi_" + stageId + ")", town);
                tokens.put("$(poi_" + stageId + ")", town.name());
                tokens.put("$(biome_" + stageId + ")", world.biomeName(town.x(), town.y()));
            }
            stage.addProperty("name", CampaignStore.text(s, "name"));
            stage.addProperty("description", CampaignStore.text(s, "description"));
            stages.add(stage);
        }
        JsonObject quest = new JsonObject();
        quest.addProperty("id", questId); quest.addProperty("template", template.get("id").getAsInt()); quest.addProperty("source", town.id());
        quest.addProperty("stage", 0); quest.add("stages", stages); quest.add("spawns", spawns);
        JsonArray rewards = new JsonArray();
        collectRewards(template, rewards);
        if (rewards.isEmpty()) { JsonObject gold = new JsonObject(); gold.addProperty("type", "gold"); gold.addProperty("count", 100); rewards.add(gold); }
        quest.add("rewards", rewards);
        quest.addProperty("epilogue", template.has("epilogue") && template.get("epilogue").isJsonObject() ? CampaignStore.text(template.getAsJsonObject("epilogue"), "text") : "");
        quest.addProperty("name", CampaignStore.text(template, "name")); quest.addProperty("description", CampaignStore.text(template, "description"));
        quest.add("dialog", template.has("offerDialog") ? dialog(template.getAsJsonObject("offerDialog")) : new JsonObject());
        replaceTokens(quest, tokens);
        data.addProperty("questSeq", uid);
        return quest;
    }

    private String pickEnemy(List<String> tags, List<String> exclude) {
        List<String> candidates = new ArrayList<>();
        for (JsonObject enemy : enemies.values()) {
            if (!AdventureCampaign.playable(enemy)) continue;
            List<String> has = strings(enemy, "questTags");
            if (has.containsAll(tags) && Collections.disjoint(has, exclude)) candidates.add(CampaignStore.text(enemy, "name"));
        }
        Collections.sort(candidates); // HashMap order must not leak into the seeded choice
        return candidates.isEmpty() ? null : candidates.get(random.nextInt(candidates.size()));
    }
    /** Destination by tags, as AdventureQuestStage.setTargetPOI: here, a token, or count1% ± count2% down the distance list. */
    private AdventureWorld.Place pickPlace(JsonObject s, AdventureWorld.Place town, Map<String, AdventureWorld.Place> tokens, boolean clear) throws Exception {
        if (bool(s, "here")) return clear ? null : town;
        String token = CampaignStore.text(s, "POIToken");
        if (!token.isEmpty() && tokens.containsKey(token)) return tokens.get(token);
        List<String> tags = strings(s, "POITags");
        List<AdventureWorld.Place> candidates = new ArrayList<>();
        for (AdventureWorld.Place p : world.places) if (p != town && p.tags().containsAll(tags) && (!clear || !p.town())) candidates.add(p);
        candidates.sort(Comparator.comparingDouble(p -> Math.hypot(p.x() - town.x(), p.y() - town.y())));
        int size = candidates.size(), index = CampaignStore.number(s, "count1", 0) * size / 100, variance = CampaignStore.number(s, "count2", 0) * size / 100;
        index = Math.max(0, (int) (index - variance + random.nextFloat() * variance * 2));
        if (index < size) { AdventureWorld.Place first = candidates.remove(index); candidates.add(0, first); }
        for (AdventureWorld.Place p : candidates) if (!clear || playable(p)) return p;
        return null;
    }
    /** A dungeon can be a Clear target only when every enemy in it has a fixed deck we can play. */
    private boolean playable(AdventureWorld.Place place) {
        return PLAYABLE_MAPS.computeIfAbsent(place.map(), map -> {
            try {
                AdventureMap m = new AdventureMap(map);
                boolean any = false;
                for (AdventureMap.Item item : m.items) if (item.type().equals("enemy")) {
                    any = true;
                    if (item.properties().getOrDefault("deckOverride", "").isBlank() && !AdventureCampaign.playable(enemies.get(item.properties().get("enemy")))) return false;
                }
                return any;
            } catch (Exception e) { return false; }
        });
    }
    private int[] freeCell(AdventureWorld.Place town, JsonObject data, JsonArray spawns) {
        for (int tries = 0; tries < 300; tries++) {
            double angle = random.nextDouble() * Math.PI * 2, radius = 6 + random.nextDouble() * 18;
            int x = (int) Math.round(town.x() + Math.cos(angle) * radius), y = (int) Math.round(town.y() + Math.sin(angle) * radius);
            if (!world.land(x, y) || world.places.stream().anyMatch(p -> p.x() == x && p.y() == y)) continue;
            boolean busy = false;
            for (JsonElement s : spawns) busy |= s.getAsJsonObject().get("x").getAsInt() == x && s.getAsJsonObject().get("y").getAsInt() == y;
            for (JsonObject s : spawns(data)) busy |= s.get("x").getAsInt() == x && s.get("y").getAsInt() == y;
            if (!busy) return new int[]{x, y};
        }
        return null;
    }

    /** Forge's dialog tree, reduced to text and choices; a choice that issues the quest accepts it. */
    private static JsonObject dialog(JsonObject d) {
        JsonObject out = new JsonObject();
        out.addProperty("text", CampaignStore.text(d, "text"));
        JsonArray options = new JsonArray();
        if (d.has("options")) for (JsonElement e : d.getAsJsonArray("options")) {
            JsonObject o = e.getAsJsonObject(), option = new JsonObject();
            option.addProperty("name", CampaignStore.text(o, "name"));
            if (issues(o)) option.addProperty("accept", true);
            else if (!CampaignStore.text(o, "text").isEmpty() || o.has("options")) option.add("next", dialog(o));
            options.add(option);
        }
        out.add("options", options);
        return out;
    }
    private static boolean issues(JsonObject option) {
        if (!option.has("action")) return false;
        for (JsonElement a : option.getAsJsonArray("action")) if (!CampaignStore.text(a.getAsJsonObject(), "issueQuest").isEmpty()) return true;
        return false;
    }
    /** grantRewards and addGold from every epilogue: that is where Forge pays a finished quest. */
    private static void collectRewards(JsonElement e, JsonArray out) {
        if (e.isJsonArray()) for (JsonElement x : e.getAsJsonArray()) collectRewards(x, out);
        if (!e.isJsonObject()) return;
        for (Map.Entry<String, JsonElement> entry : e.getAsJsonObject().entrySet()) {
            if (entry.getKey().equals("offerDialog") || entry.getKey().equals("declinedDialog") || entry.getKey().equals("failureDialog")) continue;
            if (entry.getKey().equals("grantRewards") && entry.getValue().isJsonArray()) out.addAll(entry.getValue().getAsJsonArray());
            else if (entry.getKey().equals("addGold") && entry.getValue().isJsonPrimitive() && entry.getValue().getAsInt() > 0) {
                JsonObject gold = new JsonObject(); gold.addProperty("type", "gold"); gold.addProperty("count", entry.getValue().getAsInt()); out.add(gold);
            } else collectRewards(entry.getValue(), out);
        }
    }
    private static void replaceTokens(JsonElement e, Map<String, String> tokens) {
        if (e.isJsonArray()) for (JsonElement x : e.getAsJsonArray()) replaceTokens(x, tokens);
        if (!e.isJsonObject()) return;
        for (Map.Entry<String, JsonElement> entry : e.getAsJsonObject().entrySet()) {
            JsonElement v = entry.getValue();
            if (v.isJsonPrimitive() && v.getAsJsonPrimitive().isString() && v.getAsString().contains("$(")) {
                String text = v.getAsString();
                for (Map.Entry<String, String> t : tokens.entrySet()) text = text.replace(t.getKey(), t.getValue());
                entry.setValue(new JsonPrimitive(text));
            } else replaceTokens(v, tokens);
        }
    }
    private static List<String> strings(JsonObject o, String key) {
        List<String> out = new ArrayList<>();
        if (o.has(key) && o.get(key).isJsonArray()) for (JsonElement e : o.getAsJsonArray(key)) if (!e.isJsonNull()) out.add(e.getAsString());
        return out;
    }
    private static boolean bool(JsonObject o, String key) { return o.has(key) && o.get(key).isJsonPrimitive() && o.get(key).getAsBoolean(); }
}
