package reforge.engine;

import java.io.File;
import java.io.IOException;
import java.io.InputStream;
import java.io.OutputStream;
import java.net.HttpURLConnection;
import java.net.InetAddress;
import java.net.URI;
import java.net.URLEncoder;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.StandardCopyOption;
import java.text.Normalizer;
import java.util.ArrayList;
import java.util.Comparator;
import java.util.LinkedHashMap;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.Set;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.function.IntConsumer;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

import com.google.gson.Gson;
import com.google.gson.JsonArray;
import com.google.gson.JsonElement;
import com.google.gson.JsonNull;
import com.google.gson.JsonObject;
import com.google.gson.JsonParser;

import forge.StaticData;
import forge.card.CardEdition;
import forge.deck.Deck;
import forge.deck.DeckSection;
import forge.item.PaperCard;
import forge.localinstance.properties.ForgeConstants;
import forge.model.FModel;
import forge.util.CardTranslation;
import forge.util.ScryfallRateLimiter;

/**
 * The deck tools' online services, ported from Central: Cardmarket EUR prices from Scryfall (exact printings and the
 * cheapest printing Forge also has), and commander combos from EDHREC with Commander Spellbook's generic pieces.
 * Only these three hosts are contacted. Answers are cached for a day under {@code <cache>/reforge-services.json}.
 * {@code RE_FORGE_SERVICES_URL} (loopback only) replaces all three hosts with {@code <url>/scryfall},
 * {@code <url>/edhrec} and {@code <url>/spellbook} for tests.
 */
final class DeckServices {
    private DeckServices() { }

    /** The service could not be reached or answered with an error; the UI says "unavailable", never "none". */
    static final class Unavailable extends RuntimeException {
        Unavailable(String message) { super(message); }
    }

    private static final String SCRYFALL, EDHREC, SPELLBOOK;
    static {
        String base = System.getProperty("reforge.services.url", System.getenv("RE_FORGE_SERVICES_URL"));
        if (base != null && !base.isBlank() && loopback(base)) {
            String b = base.replaceAll("/+$", "");
            SCRYFALL = b + "/scryfall"; EDHREC = b + "/edhrec"; SPELLBOOK = b + "/spellbook";
        } else {
            SCRYFALL = "https://api.scryfall.com"; EDHREC = "https://json.edhrec.com"; SPELLBOOK = "https://backend.commanderspellbook.com";
        }
    }

    private static final long DAY = 24L * 60 * 60 * 1000;
    private static final int MAX_BYTES = 8 << 20;
    private static final int SEARCH_BATCH = 10;
    private static final Gson GSON = new Gson();
    private static final Set<String> BASICS = Set.of("Plains", "Island", "Swamp", "Mountain", "Forest", "Wastes",
            "Snow-Covered Plains", "Snow-Covered Island", "Snow-Covered Swamp", "Snow-Covered Mountain", "Snow-Covered Forest");
    /** /combos/mono-black/628-2034 or the same id with a template suffix, 628-2034--5. */
    private static final Pattern COMBO_PATH = Pattern.compile("^/combos/[a-z0-9-]+/[0-9]+(?:-[0-9]+)+(?:--[0-9]+(?:-[0-9]+)*)?$");
    private static final Pattern TEMPLATES = Pattern.compile("--(\\d+(?:-\\d+)*)$");
    private static final Pattern CARD_PIECE = Pattern.compile(
            "\\b(creature|artifact|enchantment|equipment|instant|sorcery|planeswalker|aura|land)\\b", Pattern.CASE_INSENSITIVE);

    /** Slow lookups (several seconds) run here, never on the WebSocket thread or a connection's action queue. */
    static final ExecutorService WORK = Executors.newFixedThreadPool(2, r -> {
        Thread t = new Thread(r, "deck-services");
        t.setDaemon(true);
        return t;
    });

    // ---- prices ---------------------------------------------------------------------------------------------

    private record Printing(String name, String set, String number) {
        String key() { return set + "/" + number; }
    }

    private static List<Printing> printings(Deck deck) {
        Map<String, Printing> out = new LinkedHashMap<>();
        for (DeckSection section : List.of(DeckSection.Commander, DeckSection.Main, DeckSection.Sideboard)) {
            if (!deck.has(section)) continue;
            for (var entry : deck.get(section)) {
                PaperCard pc = entry.getKey();
                Printing p = new Printing(pc.getName(), pc.getEdition(), pc.getCollectorNumber());
                out.putIfAbsent(p.key(), p);
            }
        }
        return new ArrayList<>(out.values());
    }

    private static String scryfallSet(String forgeSet) {
        CardEdition edition = StaticData.instance().getEditions().get(forgeSet);
        return edition == null ? forgeSet.toLowerCase(Locale.ROOT) : edition.getScryfallCode();
    }

    /**
     * EUR of every printing in the deck: {@code prices: [{set, number, eur, exact}]} with Forge's set codes.
     * {@code exact} is false when Scryfall did not know the printing and the card's default printing priced it;
     * {@code eur} is null when Scryfall has no Cardmarket price.
     */
    static JsonObject prices(Deck deck) {
        List<Printing> all = printings(deck);
        List<Printing> missing = all.stream().filter(p -> fresh("p:" + p.key()) == null).toList();
        if (!missing.isEmpty()) {
            Map<String, Printing> byScryfall = new LinkedHashMap<>();
            JsonArray ids = new JsonArray();
            for (Printing p : missing) {
                JsonObject id = new JsonObject();
                id.addProperty("set", scryfallSet(p.set()));
                id.addProperty("collector_number", p.number());
                ids.add(id);
                byScryfall.put(scryfallSet(p.set()) + "/" + p.number().toLowerCase(Locale.ROOT), p);
            }
            List<Printing> unknown = new ArrayList<>(missing);
            for (JsonObject card : collection(ids)) {
                Printing p = byScryfall.get(str(card, "set") + "/" + str(card, "collector_number").toLowerCase(Locale.ROOT));
                if (p == null) continue;
                store("p:" + p.key(), price(eur(card), true));
                unknown.remove(p);
            }
            if (!unknown.isEmpty()) {
                JsonArray names = new JsonArray();
                Map<String, List<Printing>> byName = new LinkedHashMap<>();
                for (Printing p : unknown) {
                    byName.computeIfAbsent(p.name(), k -> new ArrayList<>()).add(p);
                }
                for (String name : byName.keySet()) {
                    JsonObject id = new JsonObject();
                    id.addProperty("name", name);
                    names.add(id);
                }
                for (JsonObject card : collection(names)) {
                    for (String face : faces(card)) {
                        List<Printing> ps = byName.remove(face);
                        if (ps != null) for (Printing p : ps) store("p:" + p.key(), price(eur(card), false));
                    }
                }
                for (List<Printing> ps : byName.values()) for (Printing p : ps) store("p:" + p.key(), price(null, false));
            }
            save();
        }
        JsonArray out = new JsonArray();
        for (Printing p : all) {
            JsonObject o = fresh("p:" + p.key()).getAsJsonObject().deepCopy();
            o.addProperty("set", p.set());
            o.addProperty("number", p.number());
            out.add(o);
        }
        JsonObject o = new JsonObject();
        o.add("prices", out);
        return o;
    }

    private static JsonObject price(Double eur, boolean exact) {
        JsonObject o = new JsonObject();
        if (eur == null) o.add("eur", JsonNull.INSTANCE); else o.addProperty("eur", eur);
        o.addProperty("exact", exact);
        return o;
    }

    /** Scryfall's /cards/collection, 75 identifiers per request. */
    private static List<JsonObject> collection(JsonArray identifiers) {
        List<JsonObject> cards = new ArrayList<>();
        for (int i = 0; i < identifiers.size(); i += 75) {
            JsonArray chunk = new JsonArray();
            for (int j = i; j < Math.min(identifiers.size(), i + 75); j++) chunk.add(identifiers.get(j));
            JsonObject body = new JsonObject();
            body.add("identifiers", chunk);
            JsonElement answer = request(SCRYFALL + "/cards/collection", body);
            if (answer == null) continue;
            for (JsonElement card : answer.getAsJsonObject().getAsJsonArray("data")) cards.add(card.getAsJsonObject());
        }
        return cards;
    }

    /**
     * Printings Forge also has that cost less than the deck's current ones:
     * {@code offers: [{nameEn, name, from: {set, number, imageKey, eur}, to: {…}}]}, biggest saving first.
     * {@code progress} receives how many names were looked up.
     */
    static JsonObject cheaper(Deck deck, IntConsumer total, IntConsumer progress) {
        prices(deck);
        List<Printing> lines = printings(deck);
        List<String> names = new ArrayList<>(new LinkedHashSet<>(lines.stream().map(Printing::name).toList()));
        List<String> todo = names.stream().filter(n -> fresh("s:" + n) == null).toList();
        // A basic land has hundreds of printings: it gets a search of its own, whose first page has the cheapest.
        List<List<String>> batches = new ArrayList<>();
        List<String> others = todo.stream().filter(n -> !BASICS.contains(n)).toList();
        for (int i = 0; i < others.size(); i += SEARCH_BATCH) batches.add(others.subList(i, Math.min(others.size(), i + SEARCH_BATCH)));
        todo.stream().filter(BASICS::contains).forEach(n -> batches.add(List.of(n)));
        total.accept(names.size());
        int done = names.size() - todo.size();
        progress.accept(done);
        for (List<String> batch : batches) {
            boolean basic = batch.size() == 1 && BASICS.contains(batch.get(0));
            Map<String, JsonArray> found = new LinkedHashMap<>();
            for (String n : batch) found.put(n, new JsonArray());
            StringBuilder q = new StringBuilder("(");
            for (String n : batch) q.append(q.length() > 1 ? " or " : "").append("!\"").append(n.replace("\"", "")).append('"');
            q.append(") unique:prints game:paper");
            String url = SCRYFALL + "/cards/search?order=eur&dir=asc&q=" + URLEncoder.encode(q.toString(), StandardCharsets.UTF_8);
            for (int page = 0; url != null && page < (basic ? 1 : 6); page++) {
                JsonElement answer = request(url, null);
                if (answer == null) break; // Scryfall answers 404 when no card matched
                JsonObject o = answer.getAsJsonObject();
                for (JsonElement e : o.getAsJsonArray("data")) {
                    JsonObject card = e.getAsJsonObject();
                    Double eur = eur(card);
                    if (eur == null) continue;
                    for (String face : faces(card)) {
                        JsonArray list = found.get(face);
                        if (list == null) continue;
                        JsonObject print = new JsonObject();
                        print.addProperty("set", str(card, "set"));
                        print.addProperty("number", str(card, "collector_number"));
                        print.addProperty("eur", eur);
                        list.add(print);
                        break;
                    }
                }
                url = o.has("has_more") && o.get("has_more").getAsBoolean() ? str(o, "next_page") : null;
                if (url != null && !url.startsWith(SCRYFALL + "/")) url = null;
            }
            found.forEach((n, list) -> store("s:" + n, list));
            save();
            done += batch.size();
            progress.accept(done);
        }

        record Offer(JsonObject json, double saving) { }
        List<Offer> offers = new ArrayList<>();
        for (Printing line : lines) {
            JsonElement current = fresh("p:" + line.key()).getAsJsonObject().get("eur");
            if (current == null || current.isJsonNull()) continue;
            double now = current.getAsDouble();
            Map<String, PaperCard> forge = new LinkedHashMap<>();
            for (PaperCard pc : FModel.getMagicDb().getCommonCards().getAllCards(line.name())) {
                forge.putIfAbsent(scryfallSet(pc.getEdition()) + "/" + pc.getCollectorNumber().toLowerCase(Locale.ROOT), pc);
            }
            for (JsonElement e : fresh("s:" + line.name()).getAsJsonArray()) {
                JsonObject print = e.getAsJsonObject();
                double eur = print.get("eur").getAsDouble();
                if (eur >= now - 0.005) break; // sorted by price; nothing cheaper Forge has
                PaperCard pc = forge.get(str(print, "set") + "/" + str(print, "number").toLowerCase(Locale.ROOT));
                if (pc == null) continue;
                PaperCard from = FModel.getMagicDb().getCommonCards().getCard(line.name(), line.set(), line.number());
                JsonObject o = new JsonObject();
                o.addProperty("nameEn", line.name());
                o.addProperty("name", CardTranslation.getTranslatedName(line.name()));
                o.add("from", side(line.set(), line.number(), from == null ? null : from.getImageKey(false), now));
                o.add("to", side(pc.getEdition(), pc.getCollectorNumber(), pc.getImageKey(false), eur));
                offers.add(new Offer(o, now - eur));
                break;
            }
        }
        offers.sort(Comparator.comparingDouble(Offer::saving).reversed());
        JsonArray out = new JsonArray();
        offers.forEach(o -> out.add(o.json()));
        JsonObject o = new JsonObject();
        o.add("offers", out);
        return o;
    }

    private static JsonObject side(String set, String number, String imageKey, double eur) {
        JsonObject o = new JsonObject();
        o.addProperty("set", set);
        o.addProperty("number", number);
        if (imageKey != null) o.addProperty("imageKey", imageKey);
        o.addProperty("eur", eur);
        return o;
    }

    private static Double eur(JsonObject card) {
        JsonObject prices = card.has("prices") && card.get("prices").isJsonObject() ? card.getAsJsonObject("prices") : null;
        if (prices == null || !prices.has("eur") || prices.get("eur").isJsonNull()) return null;
        try { return Double.parseDouble(prices.get("eur").getAsString()); } catch (NumberFormatException e) { return null; }
    }

    /** The names a Scryfall card answers to in Forge: its full name and, for two-faced cards, the front face. */
    private static List<String> faces(JsonObject card) {
        String name = str(card, "name");
        List<String> out = new ArrayList<>(List.of(name));
        int split = name.indexOf(" // ");
        if (split > 0) out.add(name.substring(0, split));
        return out;
    }

    // ---- combos ---------------------------------------------------------------------------------------------

    /** EDHREC commander slugs: lowercase, accents and apostrophes dropped, words joined by hyphens. */
    static String slug(String name) {
        String plain = Normalizer.normalize(name, Normalizer.Form.NFKD).replaceAll("\\p{M}", "").toLowerCase(Locale.ROOT);
        return plain.replaceAll("['’]", "").replaceAll("[^a-z0-9]+", "-").replaceAll("^-+|-+$", "");
    }

    /**
     * Each commander's EDHREC combo tab: {@code groups: [{commander, total, url, combos: [{id, cardNames, results,
     * decks, href, pieces}]}]} and {@code missing} for commanders EDHREC has no tab for. {@code pieces} are Commander
     * Spellbook template names for "any card of a kind" pieces.
     */
    static JsonObject combos(List<String> commanders) {
        JsonArray groups = new JsonArray(), missing = new JsonArray();
        for (String commander : commanders) {
            String slug = slug(commander);
            JsonElement page = fresh("e:" + slug);
            if (page == null) {
                page = request(EDHREC + "/pages/combos/" + slug + ".json", null);
                store("e:" + slug, page == null ? JsonNull.INSTANCE : comboPage(commander, slug, page.getAsJsonObject()));
                page = fresh("e:" + slug);
            }
            if (page.isJsonNull()) { missing.add(commander); continue; }
            groups.add(page);
        }
        save();
        JsonObject o = new JsonObject();
        o.add("groups", groups);
        o.add("missing", missing);
        return o;
    }

    private static JsonObject comboPage(String commander, String slug, JsonObject page) {
        JsonArray lists = new JsonArray();
        JsonObject container = page.has("container") ? page.getAsJsonObject("container") : null;
        if (container != null && container.has("json_dict") && container.getAsJsonObject("json_dict").has("cardlists")) {
            lists = container.getAsJsonObject("json_dict").getAsJsonArray("cardlists");
        }
        JsonArray combos = new JsonArray();
        for (JsonElement e : lists) {
            JsonObject list = e.getAsJsonObject();
            JsonArray names = new JsonArray();
            if (list.has("cardviews")) for (JsonElement v : list.getAsJsonArray("cardviews")) {
                String n = str(v.getAsJsonObject(), "name").trim();
                if (!n.isEmpty()) names.add(n);
            }
            if (names.isEmpty()) continue;
            JsonObject combo = list.has("combo") && list.get("combo").isJsonObject() ? list.getAsJsonObject("combo") : new JsonObject();
            String href = str(list, "href");
            JsonObject o = new JsonObject();
            o.addProperty("id", combo.has("comboId") ? str(combo, "comboId") : href.isEmpty() ? names.toString() : href);
            o.add("cardNames", names);
            JsonArray results = new JsonArray();
            if (combo.has("results")) for (JsonElement r : combo.getAsJsonArray("results")) if (results.size() < 4 && !r.getAsString().isBlank()) results.add(r.getAsString());
            o.add("results", results);
            o.addProperty("decks", combo.has("count") ? combo.get("count").getAsInt() : 0);
            o.addProperty("href", href.isEmpty() ? "https://edhrec.com/combos/" + slug : "https://edhrec.com" + href);
            JsonArray pieces = new JsonArray();
            Matcher m = TEMPLATES.matcher(href);
            if (m.find()) for (String id : m.group(1).split("-")) {
                String piece = template(id);
                if (piece != null) pieces.add(piece);
            }
            o.add("pieces", pieces);
            combos.add(o);
        }
        Matcher total = Pattern.compile("\\(([\\d,]+)\\s+Combos\\)", Pattern.CASE_INSENSITIVE).matcher(str(page, "header"));
        JsonObject o = new JsonObject();
        o.addProperty("commander", commander);
        o.addProperty("total", total.find() ? Integer.parseInt(total.group(1).replace(",", "")) : combos.size());
        o.addProperty("url", "https://edhrec.com/combos/" + slug);
        o.add("combos", combos);
        return o;
    }

    /** A Commander Spellbook template's name when it stands for a card ("Persist Creature"), else null. */
    private static String template(String id) {
        JsonElement cached = fresh("t:" + id);
        if (cached == null) {
            JsonElement t;
            try { t = request(SPELLBOOK + "/templates/" + id + "/", null); }
            catch (Unavailable e) { return null; } // the combo still shows, without that piece
            JsonObject o = new JsonObject();
            if (t != null) {
                String name = str(t.getAsJsonObject(), "name").trim();
                String query = str(t.getAsJsonObject(), "scryfallQuery");
                boolean card = Pattern.compile("\\bt:(creature|artifact|enchantment|instant|sorcery|planeswalker|land|equipment|aura)\\b",
                        Pattern.CASE_INSENSITIVE).matcher(query).find() || CARD_PIECE.matcher(name).find();
                if (!name.isEmpty() && card) o.addProperty("name", name);
            }
            store("t:" + id, o);
            cached = o;
        }
        JsonObject o = cached.getAsJsonObject();
        return o.has("name") ? o.get("name").getAsString() : null;
    }

    /**
     * Combos whose every card is already in the deck, from Commander Spellbook's find-my-combos:
     * {@code combos: [{id, cardNames, produces}]} (at most 24; {@code produces} in English).
     */
    static JsonObject spellbook(Deck deck) {
        JsonArray main = new JsonArray(), commanders = new JsonArray();
        List<String> names = new ArrayList<>();
        for (DeckSection section : List.of(DeckSection.Commander, DeckSection.Main)) {
            if (!deck.has(section)) continue;
            for (var entry : deck.get(section)) {
                JsonObject card = new JsonObject();
                card.addProperty("card", entry.getKey().getName());
                card.addProperty("quantity", entry.getValue());
                (section == DeckSection.Commander ? commanders : main).add(card);
                names.add(entry.getKey().getName());
            }
        }
        names.sort(null);
        String key = "f:" + Integer.toHexString(String.join("|", names).hashCode());
        JsonElement cached = fresh(key);
        if (cached == null) {
            JsonObject body = new JsonObject();
            body.add("main", main);
            body.add("commanders", commanders);
            JsonElement answer = request(SPELLBOOK + "/find-my-combos/", body);
            JsonArray combos = new JsonArray();
            JsonObject results = answer != null && answer.getAsJsonObject().has("results") ? answer.getAsJsonObject().getAsJsonObject("results") : null;
            if (results != null && results.has("included")) for (JsonElement e : results.getAsJsonArray("included")) {
                if (combos.size() >= 24) break;
                JsonObject variant = e.getAsJsonObject();
                JsonArray cards = new JsonArray(), produces = new JsonArray();
                if (variant.has("uses")) for (JsonElement u : variant.getAsJsonArray("uses")) {
                    JsonObject use = u.getAsJsonObject();
                    if (use.has("card") && use.get("card").isJsonObject()) cards.add(str(use.getAsJsonObject("card"), "name"));
                }
                if (variant.has("produces")) for (JsonElement p : variant.getAsJsonArray("produces")) {
                    JsonObject feature = p.getAsJsonObject().has("feature") ? p.getAsJsonObject().getAsJsonObject("feature") : null;
                    if (feature != null && produces.size() < 4) produces.add(str(feature, "name"));
                }
                JsonObject combo = new JsonObject();
                combo.addProperty("id", str(variant, "id"));
                combo.add("cardNames", cards);
                combo.add("produces", produces);
                combos.add(combo);
            }
            store(key, combos);
            save();
            cached = combos;
        }
        JsonObject o = new JsonObject();
        o.add("combos", cached);
        return o;
    }

    /** How one EDHREC combo plays: {@code prerequisites} and {@code steps}, in English as EDHREC writes them. */
    static JsonObject comboDetail(String href) {
        String path;
        try {
            URI uri = URI.create(href);
            path = "https".equals(uri.getScheme()) && "edhrec.com".equals(uri.getHost()) ? uri.getPath() : null;
        } catch (IllegalArgumentException e) { path = null; }
        if (path == null || !COMBO_PATH.matcher(path).matches()) throw new IllegalArgumentException("Not an EDHREC combo");
        JsonElement page = request(EDHREC + "/pages" + path + ".json", null);
        JsonObject combo = page != null && page.getAsJsonObject().has("combo") ? page.getAsJsonObject().getAsJsonObject("combo") : null;
        JsonArray prerequisites = new JsonArray(), steps = new JsonArray();
        if (combo != null) {
            if (combo.has("prerequisites")) for (JsonElement p : combo.getAsJsonArray("prerequisites")) {
                lines(str(p.getAsJsonObject(), "description"), prerequisites);
            }
            if (combo.has("steps") && combo.get("steps").isJsonArray()) for (JsonElement s : combo.getAsJsonArray("steps")) {
                if (s.isJsonPrimitive()) lines(s.getAsString(), steps);
            }
        }
        JsonObject o = new JsonObject();
        o.add("prerequisites", prerequisites);
        o.add("steps", steps);
        return o;
    }

    private static void lines(String text, JsonArray into) {
        for (String line : text.split("\\n+")) if (!line.isBlank()) into.add(line.trim());
    }

    // ---- HTTP and cache -------------------------------------------------------------------------------------

    private static boolean loopback(String url) {
        try { return InetAddress.getByName(URI.create(url).getHost()).isLoopbackAddress(); }
        catch (IOException | IllegalArgumentException | NullPointerException e) { return false; }
    }

    /** GET (or POST with a JSON body). Null on 404; {@link Unavailable} on any other failure. */
    private static JsonElement request(String url, JsonObject body) {
        if (!(url.startsWith(SCRYFALL + "/") || url.startsWith(EDHREC + "/") || url.startsWith(SPELLBOOK + "/"))) {
            throw new Unavailable("Refused host: " + url);
        }
        boolean scryfall = ScryfallRateLimiter.isApiUrl(url);
        if (scryfall && ScryfallRateLimiter.shouldSkip(url)) throw new Unavailable("Scryfall asked us to wait");
        HttpURLConnection conn = null;
        try {
            if (scryfall) ScryfallRateLimiter.acquire(url);
            conn = (HttpURLConnection) URI.create(url).toURL().openConnection();
            conn.setRequestProperty("Accept", "application/json");
            conn.setRequestProperty("User-Agent", "RE-Forge/" + Main.VERSION);
            conn.setInstanceFollowRedirects(false);
            conn.setConnectTimeout(10_000);
            conn.setReadTimeout(20_000);
            if (body != null) {
                conn.setRequestMethod("POST");
                conn.setDoOutput(true);
                conn.setRequestProperty("Content-Type", "application/json");
                try (OutputStream out = conn.getOutputStream()) { out.write(GSON.toJson(body).getBytes(StandardCharsets.UTF_8)); }
            }
            int code = conn.getResponseCode();
            if (code == 404) return null;
            if (code != HttpURLConnection.HTTP_OK) {
                if (scryfall) ScryfallRateLimiter.noteIfRateLimited(code, url, conn.getHeaderField("Retry-After"));
                throw new Unavailable(url.replaceAll("\\?.*", "") + " answered " + code);
            }
            try (InputStream in = conn.getInputStream()) {
                byte[] bytes = in.readNBytes(MAX_BYTES + 1);
                if (bytes.length > MAX_BYTES) throw new Unavailable("Answer too large");
                return JsonParser.parseString(new String(bytes, StandardCharsets.UTF_8));
            }
        } catch (IOException | IllegalStateException | com.google.gson.JsonParseException e) {
            throw new Unavailable(e.getMessage());
        } finally {
            if (conn != null) conn.disconnect();
        }
    }

    private static final Map<String, JsonObject> CACHE = new ConcurrentHashMap<>();
    private static volatile boolean loaded;

    private static File cacheFile() { return new File(ForgeConstants.CACHE_DIR, "reforge-services.json"); }

    private static synchronized void load() {
        if (loaded) return;
        loaded = true;
        File f = cacheFile();
        if (!f.isFile()) return;
        try {
            JsonObject all = JsonParser.parseString(Files.readString(f.toPath())).getAsJsonObject();
            long now = System.currentTimeMillis();
            for (var e : all.entrySet()) {
                JsonObject entry = e.getValue().getAsJsonObject();
                if (now - entry.get("at").getAsLong() < DAY) CACHE.put(e.getKey(), entry);
            }
        } catch (IOException | RuntimeException e) {
            System.err.println("Ignoring the services cache: " + e.getMessage());
        }
    }

    /** The cached value if it is less than a day old, else null. */
    private static JsonElement fresh(String key) {
        load();
        JsonObject entry = CACHE.get(key);
        if (entry == null || System.currentTimeMillis() - entry.get("at").getAsLong() >= DAY) return null;
        return entry.get("value");
    }

    private static void store(String key, JsonElement value) {
        JsonObject entry = new JsonObject();
        entry.addProperty("at", System.currentTimeMillis());
        entry.add("value", value);
        CACHE.put(key, entry);
    }

    private static synchronized void save() {
        JsonObject all = new JsonObject();
        long now = System.currentTimeMillis();
        CACHE.forEach((k, v) -> { if (now - v.get("at").getAsLong() < DAY) all.add(k, v); });
        File f = cacheFile();
        try {
            Files.createDirectories(f.getParentFile().toPath());
            File tmp = new File(f.getPath() + ".tmp");
            Files.writeString(tmp.toPath(), GSON.toJson(all));
            Files.move(tmp.toPath(), f.toPath(), StandardCopyOption.REPLACE_EXISTING, StandardCopyOption.ATOMIC_MOVE);
        } catch (IOException e) {
            System.err.println("Could not save the services cache: " + e.getMessage());
        }
    }

    private static String str(JsonObject o, String key) {
        JsonElement e = o.get(key);
        return e == null || e.isJsonNull() ? "" : e.getAsString();
    }
}
