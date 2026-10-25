package reforge.engine;

import java.util.*;
import com.google.gson.*;
import forge.game.GameView;
import forge.gamemodes.match.HostedMatch;
import forge.localinstance.properties.ForgePreferences.FPref;
import forge.model.FModel;
import forge.player.GamePlayerUtil;

/** One campaign owner per engine: Forge's Quest model is process-wide. */
final class Campaigns {
    private final CampaignStore store = new CampaignStore();
    private final String assetBase;
    private Session owner;
    private JsonObject selected;
    private QuestCampaign quest;
    private AdventureCampaign adventure;

    Campaigns(String imageBase) { assetBase = imageBase.substring(0, imageBase.lastIndexOf('/')) + "/adventure?path="; }
    synchronized void handle(Session session, JsonObject request) throws Exception {
        String action = CampaignStore.text(request, "action");
        if (action.equals("list")) { session.send(list(CampaignStore.text(request, "mode"))); return; }
        if (action.equals("delete")) {
            String id = CampaignStore.text(request, "id");
            JsonObject meta = store.load(id);
            if (selected != null && CampaignStore.text(selected, "id").equals(id)) throw new IllegalArgumentException("Close the campaign before deleting it");
            if (CampaignStore.text(meta, "mode").equals("quest")) QuestCampaign.delete(meta);
            store.delete(id);
            session.send(list(CampaignStore.text(meta, "mode"))); return;
        }
        if (owner != null && owner != session) throw new IllegalArgumentException("A campaign is open in another connection");
        if (action.equals("close")) { close(session); JsonObject result = new JsonObject(); result.addProperty("type", "campaignClosed"); session.send(result); return; }
        if (selected != null && selected.has("battle")) throw new IllegalArgumentException("Finish the current campaign battle first");
        if ((action.equals("create") || action.equals("open")) && owner == session) close(session);
        if (action.equals("create")) {
            String mode = CampaignStore.text(request, "mode"), name = CampaignStore.text(request, "name").strip();
            if (!Set.of("quest", "adventure").contains(mode) || name.isEmpty() || name.length() > 64 || name.chars().anyMatch(Character::isISOControl))
                throw new IllegalArgumentException("Invalid campaign name or mode");
            JsonObject meta = new JsonObject(); meta.addProperty("id", UUID.randomUUID().toString());
            meta.addProperty("mode", mode); meta.addProperty("name", name); meta.addProperty("difficulty", CampaignStore.number(request, "difficulty", 0));
            if (mode.equals("quest")) { QuestCampaign next = new QuestCampaign(); next.create(meta, CampaignStore.text(request, "starter"), meta.get("difficulty").getAsInt()); quest = next; adventure = null; }
            else {
                AdventureCampaign next = new AdventureCampaign();
                next.create(meta, CampaignStore.text(request, "starter"), meta.get("difficulty").getAsInt(), CampaignStore.text(request, "hero"), CampaignStore.text(request, "sex"));
                adventure = next; quest = null;
            }
            selected = meta; owner = session;
        } else if (action.equals("open")) {
            JsonObject meta = store.load(CampaignStore.text(request, "id"));
            if (CampaignStore.text(meta, "mode").equals("quest")) { QuestCampaign next = new QuestCampaign(); next.open(meta); quest = next; adventure = null; }
            else { AdventureCampaign next = new AdventureCampaign(); next.open(meta); adventure = next; quest = null; }
            selected = meta; owner = session;
        } else {
            requireOwner(session);
            switch (action) {
                case "state" -> { }
                case "deck" -> { if (quest != null) quest.saveDeck(request.getAsJsonArray("entries")); else adventure.saveDeck(request.getAsJsonArray("entries")); }
                case "buy" -> { if (quest == null) throw new IllegalArgumentException("Not a Quest shop"); quest.buy(CampaignStore.text(request, "key")); }
                case "enter" -> requireAdventure().enter(CampaignStore.text(request, "region"));
                case "leave" -> requireAdventure().leave();
                case "move" -> requireAdventure().move(request.get("dx").getAsBigDecimal().intValueExact(), request.get("dy").getAsBigDecimal().intValueExact());
                case "interact" -> { if (requireAdventure().interact(CampaignStore.text(request, "target"))) throw new IllegalArgumentException("Use duel to engage an enemy"); }
                default -> throw new IllegalArgumentException("Unknown campaign action");
            }
        }
        send(session);
    }
    private AdventureCampaign requireAdventure() { if (adventure == null) throw new IllegalArgumentException("Not an Adventure campaign"); return adventure; }
    private void requireOwner(Session session) { if (owner != session || selected == null) throw new IllegalArgumentException("Open a campaign first"); }
    synchronized HostedMatch start(Session session, WebGuiGame gui, String target) throws Exception {
        requireOwner(session);
        if (selected.has("battle")) throw new IllegalArgumentException("A campaign battle is already pending");
        FModel.getPreferences().setPref(FPref.PLAYER_NAME, CampaignStore.text(selected, "name"));
        FModel.getPreferences().setPref(FPref.UI_RECORD_REPLAYS, false);
        FModel.getPreferences().setPref(FPref.UI_SHOW_ACTIONABLE_HIGHLIGHTS, true);
        GamePlayerUtil.getGuiPlayer(CampaignStore.text(selected, "name"), 0, 0, false);
        try { return quest != null ? quest.start(gui, target, selected, store) : adventure.start(gui, target, store); }
        catch (Exception e) { selected.remove("battle"); store.save(selected); throw e; }
    }
    synchronized void finish(Session session, GameView game) throws Exception {
        if (owner != session || selected == null || !selected.has("battle")) return;
        if (quest != null) quest.finish(game); else adventure.finish(game);
        selected.remove("battle"); send(session);
    }
    synchronized void close(Session session) throws Exception {
        if (owner != session) return;
        if (selected.has("battle")) {
            if (quest != null) quest.abandon(); else adventure.abandon();
            selected.remove("battle");
        }
        store.save(selected); owner = null; selected = null; quest = null; adventure = null;
    }
    private void send(Session session) throws Exception {
        JsonObject result = quest != null ? quest.state() : adventure.state();
        for (String field : List.of("id", "name", "mode", "difficulty")) result.add(field, selected.get(field));
        result.addProperty("type", "campaign"); result.addProperty("assetBase", assetBase);
        if (result.has("wins")) selected.add("wins", result.get("wins"));
        if (result.has("losses")) selected.add("losses", result.get("losses"));
        store.save(selected); session.send(result);
    }
    private JsonObject list(String mode) throws Exception {
        if (!Set.of("quest", "adventure").contains(mode)) throw new IllegalArgumentException("Unknown campaign mode");
        JsonObject result = new JsonObject(); result.addProperty("type", "campaigns"); result.addProperty("mode", mode);
        JsonArray campaigns = new JsonArray();
        for (JsonObject meta : store.list()) if (CampaignStore.text(meta, "mode").equals(mode)) {
            JsonObject summary = new JsonObject();
            for (String field : List.of("id", "name", "difficulty", "wins", "losses")) if (meta.has(field)) summary.add(field, meta.get(field));
            campaigns.add(summary);
        }
        result.add("campaigns", campaigns);
        JsonArray starters = new JsonArray();
        if (mode.equals("quest")) for (var precon : QuestCampaign.starters()) {
            JsonObject starter = new JsonObject(); starter.addProperty("id", precon.getName()); starter.addProperty("name", precon.getName()); starters.add(starter);
        }
        else for (String color : List.of("W", "U", "B", "R", "G")) { JsonObject starter = new JsonObject(); starter.addProperty("id", color); starter.addProperty("name", color); starters.add(starter); }
        result.add("starters", starters);
        if (mode.equals("adventure")) { result.add("heroes", new AdventureCampaign().heroes()); result.addProperty("assetBase", assetBase); }
        return result;
    }
}
