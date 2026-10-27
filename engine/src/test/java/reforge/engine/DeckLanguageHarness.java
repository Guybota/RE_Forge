package reforge.engine;

import com.google.gson.JsonObject;
import com.google.gson.JsonParser;
import com.sun.net.httpserver.HttpServer;
import forge.deck.Deck;
import forge.deck.DeckSection;
import forge.model.FModel;
import java.net.InetSocketAddress;
import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import java.util.List;
import java.util.concurrent.atomic.AtomicBoolean;
import java.util.concurrent.atomic.AtomicInteger;
import static reforge.engine.DeckImageLanguages.Availability.*;

/** Deterministic metadata HTTP, real printing identities and weighted totals; never a real API request. */
public final class DeckLanguageHarness {
    static void check(boolean ok, String message) { if (!ok) throw new AssertionError(message); }
    static JsonObject json(String text) { return JsonParser.parseString(text).getAsJsonObject(); }
    public static void main(String[] args) {
        try {
            Main.main(args);
            run();
            System.out.println("OK: deck languages, printing identities, weighted copies, partners, HTTP failures and cancellation");
            System.exit(0);
        } catch (Throwable e) { e.printStackTrace(); System.exit(1); }
    }
    static void run() throws Exception {
        var cards = FModel.getMagicDb().getCommonCards();
        var forest = cards.getCard("Forest", "M11");
        var otherForest = cards.getCard("Forest", "M12");
        var deck = new Deck("language fixture");
        deck.getMain().add(forest, 98);
        deck.getOrCreate(DeckSection.Commander).add(cards.getCard("Frodo, Adventurous Hobbit"), 1);
        deck.getOrCreate(DeckSection.Commander).add(cards.getCard("Sam, Loyal Attendant"), 1);
        deck.getOrCreate(DeckSection.Sideboard).add(otherForest, 12);
        var entries = DeckImageLanguages.entries(deck);
        check(entries.size() == 3 && entries.stream().mapToInt(DeckImageLanguages.Entry::copies).sum() == 100, "main + both commanders, excluding sideboard");
        deck.getMain().add(otherForest, 1);
        check(DeckImageLanguages.entries(deck).size() == 4, "different printings stay distinct");
        List<JsonObject> replies = new ArrayList<>(); AtomicInteger probes = new AtomicInteger();
        DeckImageLanguages.check(7, deck.getName(), "mine", "pt-BR", entries, () -> false, replies::add, (key, lang) -> {
            check(lang.equals("pt"), "Forge code maps to image language"); probes.incrementAndGet();
            return key.equals(forest.getImageKey(false)) ? AVAILABLE : MISSING;
        });
        var result = replies.get(replies.size() - 1);
        check(result.get("available").getAsInt() == 98 && result.get("missing").getAsInt() == 2 && result.get("total").getAsInt() == 100, "98% weighted, not 33% unique cards");
        check(result.get("done").getAsBoolean() && probes.get() == 3, "one probe per printing and completed progress");
        replies.clear(); probes.set(0);
        DeckImageLanguages.check(8, "offline", "mine", "pt-BR", entries, () -> false, replies::add, (key, lang) -> { probes.incrementAndGet(); return UNKNOWN; });
        check(replies.get(replies.size() - 1).get("unknown").getAsInt() == 100 && replies.get(replies.size() - 1).get("missing").getAsInt() == 0 && probes.get() == 1, "offline fails fast and is never missing");
        replies.clear(); AtomicBoolean cancelled = new AtomicBoolean();
        DeckImageLanguages.check(9, "cancelled", "precon", "en-US", entries, cancelled::get, replies::add, (key, lang) -> { cancelled.set(true); return AVAILABLE; });
        check(replies.size() == 1 && !replies.get(0).get("done").getAsBoolean(), "cancellation cannot publish stale results");
        check(DeckImageLanguages.metadata(json("{\"lang\":\"pt\",\"image_status\":\"placeholder\"}"), "pt") == MISSING, "localized placeholder is not a scan");
        check(DeckImageLanguages.metadata(json("{\"lang\":\"en\",\"image_status\":\"highres_scan\",\"image_uris\":{\"normal\":\"x\"}}"), "pt") == MISSING, "English fallback is not Portuguese");
        check(DeckImageLanguages.metadata(json("{}"), "pt") == UNKNOWN, "malformed metadata is unknown");
        check(DeckImageLanguages.metadata(json("{\"lang\":\"pt\",\"image_status\":\"lowres\",\"card_faces\":[{\"image_uris\":{\"normal\":\"front\"}},{\"image_uris\":{\"normal\":\"back\"}}]}"), "pt") == AVAILABLE, "both DFC faces available");
        var server = HttpServer.create(new InetSocketAddress("127.0.0.1", 0), 0);
        server.createContext("/", exchange -> {
            try (exchange) {
                int code = switch (exchange.getRequestURI().getPath()) { case "/missing" -> 404; case "/retry" -> 503; default -> 200; };
                byte[] body = "{\"lang\":\"pt\",\"image_status\":\"highres_scan\",\"image_uris\":{\"normal\":\"x\"}}".getBytes(StandardCharsets.UTF_8);
                exchange.sendResponseHeaders(code, body.length); exchange.getResponseBody().write(body);
            }
        }); server.start();
        try {
            String url = "http://127.0.0.1:" + server.getAddress().getPort();
            check(DeckImageLanguages.probe(url + "/ok", "pt") == AVAILABLE, "metadata HTTP success");
            check(DeckImageLanguages.probe(url + "/missing", "pt") == MISSING, "404 printing absent");
            check(DeckImageLanguages.probe(url + "/retry", "pt") == UNKNOWN, "503 does not poison availability");
        } finally { server.stop(0); }
    }
}
