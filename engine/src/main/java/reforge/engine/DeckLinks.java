package reforge.engine;

import java.io.IOException;
import java.io.InputStream;
import java.net.HttpURLConnection;
import java.net.URI;
import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import java.util.List;
import java.util.Locale;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

import com.google.gson.JsonElement;
import com.google.gson.JsonObject;
import com.google.gson.JsonParser;

import forge.item.PaperCard;
import forge.model.FModel;

/**
 * Fetches a public Archidekt or Moxfield deck and writes it as a decklist ({@code Commander} / {@code Deck} /
 * {@code Sideboard}, with set and collector number) for the import screen. Only these two sites' own APIs are
 * contacted: any other address is refused before a request is made.
 */
final class DeckLinks {
    private DeckLinks() { }

    private static final Pattern ARCHIDEKT = Pattern.compile("^https?://(?:www\\.)?archidekt\\.com/(?:api/)?decks/(\\d+)(?:[/?#].*)?$");
    private static final Pattern MOXFIELD = Pattern.compile("^https?://(?:www\\.)?moxfield\\.com/decks/([A-Za-z0-9_-]+)(?:[/?#].*)?$");
    private static final int MAX_BYTES = 8 << 20;

    record Deck(String name, String text) { }

    /** A failure the UI translates: {@code linkUnsupported}, {@code linkNotFound} or {@code linkUnavailable}. */
    static final class Problem extends RuntimeException {
        final String code;
        Problem(String code, String message) { super(message); this.code = code; }
    }

    static Deck fetch(String url) {
        String link = url == null ? "" : url.trim();
        Matcher m = ARCHIDEKT.matcher(link);
        if (m.matches()) return archidekt(get("https://archidekt.com/api/decks/" + m.group(1) + "/"));
        m = MOXFIELD.matcher(link);
        if (m.matches()) return moxfield(get("https://api2.moxfield.com/v3/decks/all/" + m.group(1)));
        throw new Problem("linkUnsupported", "Only Archidekt and Moxfield deck links are supported");
    }

    /** Archidekt: a card's first category decides where it goes; the premier category (Commander) leads. */
    static Deck archidekt(JsonObject deck) {
        List<String> premier = new ArrayList<>(), excluded = new ArrayList<>();
        for (JsonElement e : deck.getAsJsonArray("categories")) {
            JsonObject c = e.getAsJsonObject();
            if (bool(c, "isPremier")) premier.add(str(c, "name"));
            if (c.has("includedInDeck") && !bool(c, "includedInDeck")) excluded.add(str(c, "name"));
        }
        Sections s = new Sections();
        for (JsonElement e : deck.getAsJsonArray("cards")) {
            JsonObject entry = e.getAsJsonObject();
            if (entry.has("deletedAt") && !entry.get("deletedAt").isJsonNull()) continue;
            List<String> categories = new ArrayList<>();
            if (entry.has("categories") && entry.get("categories").isJsonArray()) {
                entry.getAsJsonArray("categories").forEach(c -> categories.add(c.getAsString()));
            }
            JsonObject card = entry.getAsJsonObject("card");
            String line = line(entry.get("quantity").getAsInt(), card.getAsJsonObject("oracleCard").get("name").getAsString(),
                    card.getAsJsonObject("edition").get("editioncode").getAsString(), str(card, "collectorNumber"));
            String first = categories.isEmpty() ? "" : categories.get(0);
            if (categories.stream().anyMatch(premier::contains)) s.commander.add(line);
            else if (excluded.contains(first) || first.equalsIgnoreCase("Maybeboard")) continue;
            else if (first.equalsIgnoreCase("Sideboard")) s.sideboard.add(line);
            else s.main.add(line);
        }
        return new Deck(str(deck, "name"), s.text());
    }

    /** Moxfield: boards by name; companions travel in the sideboard, maybeboards stay out. */
    static Deck moxfield(JsonObject deck) {
        JsonObject boards = deck.getAsJsonObject("boards");
        Sections s = new Sections();
        board(boards, "commanders", s.commander);
        board(boards, "mainboard", s.main);
        board(boards, "companions", s.sideboard);
        board(boards, "sideboard", s.sideboard);
        return new Deck(str(deck, "name"), s.text());
    }

    private static void board(JsonObject boards, String name, List<String> into) {
        if (boards == null || !boards.has(name)) return;
        JsonObject cards = boards.getAsJsonObject(name).getAsJsonObject("cards");
        if (cards == null) return;
        for (var e : cards.entrySet()) {
            JsonObject entry = e.getValue().getAsJsonObject(), card = entry.getAsJsonObject("card");
            into.add(line(entry.get("quantity").getAsInt(), card.get("name").getAsString(), str(card, "set"), str(card, "cn")));
        }
    }

    private static final class Sections {
        final List<String> commander = new ArrayList<>(), main = new ArrayList<>(), sideboard = new ArrayList<>();

        String text() {
            StringBuilder out = new StringBuilder();
            section(out, "Commander", commander);
            section(out, "Deck", main);
            section(out, "Sideboard", sideboard);
            return out.toString();
        }

        private static void section(StringBuilder out, String title, List<String> lines) {
            if (lines.isEmpty()) return;
            if (out.length() > 0) out.append('\n');
            out.append(title).append('\n');
            lines.forEach(l -> out.append(l).append('\n'));
        }
    }

    /**
     * One decklist line. The printing goes along only when Forge knows it: an unknown set or number (promos,
     * Secret Lair flavour names) makes Forge's recogniser reject a card it knows by name.
     */
    private static String line(int qty, String name, String set, String number) {
        String code = set.toUpperCase(Locale.ROOT);
        var db = FModel.getMagicDb().getCommonCards();
        // Forge answers an unknown set or number with another printing, so compare what comes back.
        PaperCard exact = code.isEmpty() || number.isEmpty() ? null : db.getCard(name, code, number);
        if (exact != null && exact.getEdition().equalsIgnoreCase(code) && exact.getCollectorNumber().equals(number)) {
            return qty + " " + name + " (" + code + ") " + number;
        }
        PaperCard inSet = code.isEmpty() ? null : db.getCard(name, code);
        return inSet != null && inSet.getEdition().equalsIgnoreCase(code) ? qty + " " + name + " (" + code + ")" : qty + " " + name;
    }

    private static JsonObject get(String url) {
        HttpURLConnection conn = null;
        try {
            conn = (HttpURLConnection) URI.create(url).toURL().openConnection();
            conn.setRequestProperty("Accept", "application/json");
            conn.setRequestProperty("User-Agent", "RE-Forge/" + Main.VERSION);
            conn.setInstanceFollowRedirects(false);
            conn.setConnectTimeout(10_000);
            conn.setReadTimeout(20_000);
            int code = conn.getResponseCode();
            // Private decks answer 401/403 on both sites; either way there is nothing to import.
            if (code == 404 || code == 401 || code == 403) throw new Problem("linkNotFound", "Deck not found or private");
            if (code != HttpURLConnection.HTTP_OK) throw new Problem("linkUnavailable", "The site answered " + code);
            try (InputStream in = conn.getInputStream()) {
                byte[] body = in.readNBytes(MAX_BYTES + 1);
                if (body.length > MAX_BYTES) throw new Problem("linkUnavailable", "Deck too large");
                return JsonParser.parseString(new String(body, StandardCharsets.UTF_8)).getAsJsonObject();
            }
        } catch (IOException | IllegalStateException | com.google.gson.JsonParseException e) {
            throw new Problem("linkUnavailable", "Could not read the deck: " + e.getMessage());
        } finally {
            if (conn != null) conn.disconnect();
        }
    }

    private static String str(JsonObject o, String key) {
        JsonElement e = o.get(key);
        return e == null || e.isJsonNull() ? "" : e.getAsString();
    }

    private static boolean bool(JsonObject o, String key) {
        JsonElement e = o.get(key);
        return e != null && !e.isJsonNull() && e.getAsBoolean();
    }
}
