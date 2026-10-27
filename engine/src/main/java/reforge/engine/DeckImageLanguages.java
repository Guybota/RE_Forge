package reforge.engine;

import com.google.gson.JsonObject;
import com.google.gson.JsonParser;
import forge.deck.Deck;
import forge.deck.DeckSection;
import forge.util.ScryfallRateLimiter;
import java.net.HttpURLConnection;
import java.net.URI;
import java.nio.charset.StandardCharsets;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.concurrent.*;
import java.util.function.Consumer;

/** Checks the actual printing's scans, never translated rules text or a cached English fallback. */
final class DeckImageLanguages implements AutoCloseable {
    enum Availability { AVAILABLE, MISSING, UNKNOWN }
    record Entry(String key, int copies) { }
    record Cached(Availability value, long expires) { }
    private static final Map<String, Cached> CACHE = new LinkedHashMap<>();
    private final ExecutorService worker = Executors.newSingleThreadExecutor(r -> {
        Thread t = new Thread(r, "deck-image-language"); t.setDaemon(true); return t;
    });
    private volatile long generation;
    private Future<?> current;

    static List<Entry> entries(Deck deck) {
        Map<String, Integer> cards = new LinkedHashMap<>();
        if (deck != null) for (DeckSection section : List.of(DeckSection.Main, DeckSection.Commander)) {
            if (deck.has(section)) for (var entry : deck.get(section))
                cards.merge(entry.getKey().getImageKey(false), entry.getValue(), Integer::sum);
        }
        return cards.entrySet().stream().map(e -> new Entry(e.getKey(), e.getValue())).toList();
    }

    synchronized void cancel() {
        generation++;
        if (current != null) current.cancel(true);
    }

    synchronized void start(int requestId, String name, String source, String language, List<Entry> entries, Consumer<JsonObject> send) {
        if (worker.isShutdown()) return;
        cancel();
        long ticket = generation;
        current = worker.submit(() -> check(requestId, name, source, language, entries,
                () -> ticket != generation || Thread.currentThread().isInterrupted(), send, DeckImageLanguages::lookup));
    }

    @FunctionalInterface interface Probe { Availability get(String key, String language); }
    static void check(int id, String name, String source, String language, List<Entry> entries,
                      java.util.function.BooleanSupplier cancelled, Consumer<JsonObject> send, Probe probe) {
        int total = entries.stream().mapToInt(Entry::copies).sum(), checked = 0, available = 0, missing = 0;
        boolean networkFailed = false;
        for (int i = -1; i < entries.size(); i++) {
            if (cancelled.getAsBoolean()) return;
            if (i >= 0) {
                Entry entry = entries.get(i);
                Availability result = networkFailed ? Availability.UNKNOWN : probe.get(entry.key(), ImageServer.language(language));
                if (cancelled.getAsBoolean()) return;
                checked += entry.copies();
                if (result == Availability.AVAILABLE) available += entry.copies();
                if (result == Availability.MISSING) missing += entry.copies();
                // Fail fast offline / during rate limiting. A later explicit retry can verify the rest.
                if (result == Availability.UNKNOWN) networkFailed = true;
            }
            JsonObject reply = new JsonObject();
            reply.addProperty("type", "deckLanguage"); reply.addProperty("requestId", id);
            reply.addProperty("name", name); reply.addProperty("source", source); reply.addProperty("language", language);
            reply.addProperty("total", total); reply.addProperty("checked", checked);
            reply.addProperty("available", available); reply.addProperty("missing", missing);
            reply.addProperty("unknown", checked - available - missing);
            reply.addProperty("done", i == entries.size() - 1);
            send.accept(reply);
        }
    }

    static Availability lookup(String key, String language) {
        List<String> urls = ImageServer.downloadUrls(key, false, language);
        if (urls.isEmpty()) return Availability.UNKNOWN;
        for (String imageUrl : urls) {
            String url = imageUrl.split("\\?", 2)[0];
            String cacheKey = language + " " + url;
            Cached cached;
            synchronized (CACHE) { cached = CACHE.get(cacheKey); }
            Availability value = cached != null && cached.expires() > System.currentTimeMillis()
                    ? cached.value() : probe(url, language);
            if (value != Availability.UNKNOWN) synchronized (CACHE) {
                if (CACHE.size() >= 10000) CACHE.remove(CACHE.keySet().iterator().next());
                CACHE.put(cacheKey, new Cached(value, System.currentTimeMillis() + TimeUnit.HOURS.toMillis(12)));
            }
            if (value != Availability.MISSING) return value;
        }
        return Availability.MISSING;
    }

    static Availability probe(String url, String language) {
        if (Thread.currentThread().isInterrupted() || ScryfallRateLimiter.shouldSkip(url)) return Availability.UNKNOWN;
        HttpURLConnection conn = null;
        try {
            ScryfallRateLimiter.acquire(url);
            if (Thread.currentThread().isInterrupted()) return Availability.UNKNOWN;
            conn = (HttpURLConnection) URI.create(url).toURL().openConnection();
            conn.setRequestProperty("Accept", "application/json");
            conn.setRequestProperty("User-Agent", "RE-Forge/" + Main.VERSION);
            conn.setConnectTimeout(3000); conn.setReadTimeout(5000);
            int status = conn.getResponseCode();
            if (status != 200) {
                ScryfallRateLimiter.noteIfRateLimited(status, url, conn.getHeaderField("Retry-After"));
                return status == 404 || status == 422 ? Availability.MISSING : Availability.UNKNOWN;
            }
            try (var in = conn.getInputStream()) {
                return metadata(JsonParser.parseString(new String(in.readAllBytes(), StandardCharsets.UTF_8)).getAsJsonObject(), language);
            }
        } catch (Exception e) { return Availability.UNKNOWN; }
        finally { if (conn != null) conn.disconnect(); }
    }

    static Availability metadata(JsonObject card, String language) {
        if (!card.has("lang") || !card.has("image_status")) return Availability.UNKNOWN;
        if (!language.equals(card.get("lang").getAsString())) return Availability.MISSING;
        String status = card.get("image_status").getAsString();
        if (status.equals("placeholder") || status.equals("missing")) return Availability.MISSING;
        if (!List.of("lowres", "highres_scan").contains(status)) return Availability.UNKNOWN;
        if (card.has("image_uris") && card.getAsJsonObject("image_uris").has("normal")) return Availability.AVAILABLE;
        if (card.has("card_faces")) {
            for (var face : card.getAsJsonArray("card_faces")) {
                var obj = face.getAsJsonObject();
                if (!obj.has("image_uris") || !obj.getAsJsonObject("image_uris").has("normal")) return Availability.UNKNOWN;
            }
            if (!card.getAsJsonArray("card_faces").isEmpty()) return Availability.AVAILABLE;
        }
        return Availability.UNKNOWN;
    }

    public void close() { cancel(); worker.shutdownNow(); }
}
