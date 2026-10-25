package reforge.engine;

import java.util.HashMap;
import java.util.List;
import java.util.Map;

import com.google.gson.JsonArray;
import com.google.gson.JsonObject;

import forge.game.GameEntityView;
import forge.game.GameLogEntry;
import forge.game.GameView;
import forge.game.card.CardView;
import forge.game.card.CardView.CardStateView;
import forge.game.card.CounterEnumType;
import forge.game.card.CounterType;
import forge.game.combat.CombatView;
import forge.game.player.PlayerView;
import forge.game.spellability.StackItemView;
import forge.game.zone.ZoneType;
import forge.gamemodes.match.Selection;
import forge.trackable.TrackableObject;
import forge.util.CardTranslation;

/**
 * Turns Forge's GameView into the JSON "state" message, and remembers which id is which view so
 * the UI's clicks (which only carry ids) can be mapped back. Cards the local player may not see
 * are sent as {id, hidden: true}.
 */
final class GameSnapshot {
    private static final int LOG_LINES = 40;
    private static final ZoneType[] PUBLIC_ZONES = { ZoneType.Battlefield, ZoneType.Graveyard, ZoneType.Exile, ZoneType.Command };

    final Map<Integer, CardView> cards = new HashMap<>();
    final Map<Integer, PlayerView> players = new HashMap<>();
    final JsonObject json;

    /** Everything the UI needs for the prompt bar: text, the two buttons and what can be picked. */
    record Prompt(String message, String ok, String cancel, boolean okEnabled, boolean cancelEnabled, Selection selection) {
        static final Prompt NONE = new Prompt("", "", "", false, false, Selection.NONE);
    }

    GameSnapshot(GameView game, WebGuiGame gui, Prompt prompt) {
        json = new JsonObject();
        json.addProperty("type", "state");
        json.addProperty("turn", game.getTurn());
        json.addProperty("phase", game.getPhase() == null ? null : game.getPhase().name());
        json.addProperty("activePlayerId", game.getPlayerTurn() == null ? null : game.getPlayerTurn().getId());
        json.addProperty("gameOver", game.isGameOver());
        json.addProperty("winner", game.isGameOver() ? game.getWinningPlayerName() : null);

        JsonArray ps = new JsonArray();
        for (PlayerView p : game.getPlayers()) {
            ps.add(player(p, game, gui));
        }
        json.add("players", ps);
        json.add("stack", stack(game, gui));
        json.add("combat", combat(game.getCombat()));
        json.add("log", log(game));
        json.add("prompt", prompt(prompt));
    }

    private JsonObject player(PlayerView p, GameView game, WebGuiGame gui) {
        players.put(p.getId(), p);
        JsonObject o = new JsonObject();
        o.addProperty("id", p.getId());
        o.addProperty("name", p.getName());
        o.addProperty("life", p.getLife());
        o.addProperty("poison", p.getCounters(CounterEnumType.POISON));
        o.addProperty("isLocal", gui.isLocalPlayer(p));
        o.addProperty("isAi", p.isAI());
        o.addProperty("hasLost", p.getHasLost());
        o.addProperty("handSize", p.getZoneSize(ZoneType.Hand));
        o.addProperty("librarySize", p.getZoneSize(ZoneType.Library));

        JsonObject zones = new JsonObject();
        zones.add("hand", cards(p.getCards(ZoneType.Hand), gui));
        for (ZoneType z : PUBLIC_ZONES) {
            zones.add(z.name().toLowerCase(), cards(p.getCards(z), gui));
        }
        o.add("zones", zones);

        // Damage this player has taken from each other player's commanders (21 kills).
        JsonArray cmdDamage = new JsonArray();
        for (PlayerView other : game.getPlayers()) {
            if (other == p || other.getCommanders() == null) continue;
            for (CardView commander : other.getCommanders()) {
                JsonObject d = new JsonObject();
                d.addProperty("commanderId", commander.getId());
                d.addProperty("fromPlayerId", other.getId());
                d.addProperty("damage", p.getCommanderDamage(commander));
                cmdDamage.add(d);
            }
        }
        o.add("commanderDamage", cmdDamage);

        JsonArray casts = new JsonArray();
        if (p.getCommanders() != null) {
            for (CardView commander : p.getCommanders()) {
                JsonObject c = new JsonObject();
                c.addProperty("id", commander.getId());
                c.addProperty("casts", p.getCommanderCast(commander));
                casts.add(c);
            }
        }
        o.add("commanderCasts", casts);
        return o;
    }

    private JsonArray cards(Iterable<CardView> list, WebGuiGame gui) {
        JsonArray arr = new JsonArray();
        if (list == null) return arr;
        for (CardView c : list) {
            arr.add(card(c, gui));
        }
        return arr;
    }

    private JsonObject card(CardView c, WebGuiGame gui) {
        cards.put(c.getId(), c);
        return describeCard(c, gui);
    }

    static JsonObject describeCard(CardView c, WebGuiGame gui) {
        return describeCard(c, gui, false);
    }

    static JsonObject describeCard(CardView c, WebGuiGame gui, boolean revealed) {
        JsonObject o = new JsonObject();
        o.addProperty("id", c.getId());
        if (!revealed && !gui.mayView(c)) {
            o.addProperty("hidden", true);
            return o;
        }
        CardStateView s = c.getCurrentState();
        o.addProperty("name", name(s));
        o.addProperty("cost", s.getManaCost() == null ? "" : s.getManaCost().toString());
        o.addProperty("type", s.getType() == null ? "" : CardTranslation.getTranslatedType(s));
        // Untranslated, for the UI's own logic (is it a land? which basic?) in any language.
        o.addProperty("typeEn", s.getType() == null ? "" : s.getType().toString());
        o.addProperty("colors", s.getColors() == null ? "" : s.getColors().toString());
        o.addProperty("set", s.getSetCode());
        if (s.getRarity() != null) o.addProperty("rarity", s.getRarity().name());
        o.addProperty("imageKey", s.getImageKey());
        o.addProperty("text", text(s));
        if (s.getType() != null && s.getType().isCreature()) {
            o.addProperty("power", s.getPower());
            o.addProperty("toughness", s.getToughness());
        }
        if (s.getType() != null && s.getType().isPlaneswalker()) o.addProperty("loyalty", s.getLoyalty());
        if (s.getType() != null && s.getType().isBattle()) o.addProperty("defense", s.getDefense());
        o.addProperty("controllerId", c.getController() == null ? null : c.getController().getId());
        o.addProperty("actionable", gui.isWeaklySelectable(c));
        o.addProperty("tapped", c.isTapped());
        o.addProperty("sick", c.isSick());
        o.addProperty("attacking", c.isAttacking());
        o.addProperty("blocking", c.isBlocking());
        o.addProperty("token", c.isToken());
        o.addProperty("commander", c.isCommander());
        o.addProperty("faceDown", c.isFaceDown());
        o.addProperty("damage", c.getDamage());
        if (c.getAttachedTo() != null) o.addProperty("attachedToId", c.getAttachedTo().getId());
        if (c.getCounters() != null && !c.getCounters().isEmpty()) {
            JsonObject counters = new JsonObject();
            for (CounterType t : c.getCounters().elementSet()) {
                counters.addProperty(t.getName(), c.getCounters().count(t));
            }
            o.add("counters", counters);
        }
        return o;
    }

    /** The card's name in Forge's current language (English when there's no translation). */
    static String name(CardStateView s) {
        return CardTranslation.getTranslatedName(s);
    }

    /** Rules text in the current language; falls back to the English oracle text. */
    private static String text(CardStateView s) {
        String translated = CardTranslation.getTranslatedOracle(s);
        return translated == null || translated.isEmpty() ? s.getOracleText() : translated.replace("\\n", "\n");
    }

    private JsonArray stack(GameView game, WebGuiGame gui) {
        JsonArray arr = new JsonArray();
        if (game.getStack() == null) return arr;
        for (StackItemView si : game.getStack()) {
            JsonObject o = new JsonObject();
            o.addProperty("id", si.getId());
            o.addProperty("text", si.getText());
            o.addProperty("isSpell", !si.isAbility());
            o.addProperty("sourceCardId", si.getSourceCard() == null ? null : si.getSourceCard().getId());
            // The spell's own card, so the UI can show it flying to the stack (card() still hides what may not be seen).
            if (!si.isAbility() && si.getSourceCard() != null) o.add("card", card(si.getSourceCard(), gui));
            o.addProperty("controllerId", si.getActivatingPlayer() == null ? null : si.getActivatingPlayer().getId());
            JsonArray targetCards = new JsonArray(), targetPlayers = new JsonArray();
            if (si.getTargetCards() != null) si.getTargetCards().forEach(t -> targetCards.add(t.getId()));
            if (si.getTargetPlayers() != null) si.getTargetPlayers().forEach(t -> targetPlayers.add(t.getId()));
            o.add("targetCardIds", targetCards);
            o.add("targetPlayerIds", targetPlayers);
            arr.add(o);
        }
        return arr;
    }

    private static JsonArray combat(CombatView combat) {
        JsonArray arr = new JsonArray();
        if (combat == null) return arr;
        for (CardView attacker : combat.getAttackers()) {
            JsonObject o = new JsonObject();
            o.addProperty("attackerId", attacker.getId());
            GameEntityView defender = combat.getDefender(attacker);
            // A defender is a player, or a planeswalker/battle card.
            if (defender instanceof PlayerView) o.addProperty("defenderPlayerId", defender.getId());
            else if (defender != null) o.addProperty("defenderCardId", defender.getId());
            // While blockers are being declared Forge keeps them as "planned"; after that, as blockers.
            JsonArray blockers = new JsonArray();
            var declared = combat.getBlockers(attacker);
            var planned = combat.getPlannedBlockers(attacker);
            var shown = declared != null && !declared.isEmpty() ? declared : planned;
            if (shown != null) shown.forEach(b -> blockers.add(b.getId()));
            o.add("blockerIds", blockers);
            arr.add(o);
        }
        return arr;
    }

    private static JsonArray log(GameView game) {
        JsonArray arr = new JsonArray();
        if (game.getGameLog() == null) return arr;
        List<GameLogEntry> entries = game.getGameLog().getLogEntries(null);
        for (int i = 0; i < Math.min(LOG_LINES, entries.size()); i++) {
            arr.add(entries.get(i).message());
        }
        return arr;
    }

    private static JsonObject prompt(Prompt p) {
        JsonObject o = new JsonObject();
        o.addProperty("message", p.message());
        o.add("ok", button(p.ok(), p.okEnabled()));
        o.add("cancel", button(p.cancel(), p.cancelEnabled()));
        // Card, player and stack ids are separate number spaces in Forge, so keep them in separate lists.
        JsonObject selectable = ids(p.selection().targets());
        p.selection().cards().forEach(c -> selectable.getAsJsonArray("cards").add(c.getId()));
        o.add("selectable", selectable);
        o.add("chosen", ids(p.selection().chosen()));
        return o;
    }

    private static JsonObject ids(List<TrackableObject> objects) {
        JsonArray cardIds = new JsonArray(), playerIds = new JsonArray(), stackIds = new JsonArray();
        for (TrackableObject t : objects) {
            if (t instanceof CardView) cardIds.add(t.getId());
            else if (t instanceof PlayerView) playerIds.add(t.getId());
            else if (t instanceof StackItemView) stackIds.add(t.getId());
        }
        JsonObject o = new JsonObject();
        o.add("cards", cardIds);
        o.add("players", playerIds);
        o.add("stack", stackIds);
        return o;
    }

    private static JsonObject button(String label, boolean enabled) {
        JsonObject o = new JsonObject();
        o.addProperty("label", label);
        o.addProperty("enabled", enabled);
        return o;
    }
}
