package reforge.engine;

import java.awt.image.BufferedImage;
import java.io.ByteArrayOutputStream;
import java.net.InetSocketAddress;
import java.net.URI;
import java.net.URLEncoder;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.security.MessageDigest;
import java.time.Duration;
import java.util.Arrays;
import java.util.HexFormat;
import java.util.List;
import java.util.Map;
import java.util.concurrent.CompletableFuture;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.Executors;
import java.util.concurrent.atomic.AtomicInteger;

import javax.imageio.ImageIO;
import com.sun.net.httpserver.HttpServer;
import com.google.gson.JsonObject;
import forge.model.FModel;

/** Test-only: native Forge URL resolution plus deterministic HTTP/cache behavior. */
public final class ImageHarness {
    private static final HttpClient CLIENT = HttpClient.newBuilder().connectTimeout(Duration.ofSeconds(5)).build();

    public static void main(String[] args) {
        try {
            Main.main(args);
            nativeUrls();
            cacheAndFallback();
            System.out.println("OK: image resolution, language isolation, English fallback, placeholders, retry, concurrency and offline cache");
            System.exit(0);
        } catch (Throwable error) {
            error.printStackTrace();
            System.exit(1);
        }
    }

    private static void check(boolean condition, String message) {
        if (!condition) throw new AssertionError(message);
    }

    /** Shows the key and the URLs actually produced when the expectation fails. */
    private static void urlContains(String key, boolean crop, String language, String expected, String message) {
        List<String> urls = ImageServer.downloadUrls(key, crop, language);
        check(!urls.isEmpty() && urls.get(0).contains(expected), message + ": " + key + " -> " + urls + " (expected " + expected + ")");
    }

    private static void nativeUrls() {
        String bolt = FModel.getMagicDb().getCommonCards().getCard("Lightning Bolt", "M11").getImageKey(false);
        String back = FModel.getMagicDb().getCommonCards().getCard("Delver of Secrets", "ISD").getImageKey(true);
        String token = "t:w_1_1_spirit_flying|ISD|2|1";
        urlContains(bolt, false, "pt", "/m11/149/pt?format=image&version=normal", "localized printing");
        urlContains(back, false, "en", "face=back", "reverse card face");
        urlContains(token, true, "pt", "/tisd/2/pt?format=image&version=art_crop", "token set, collector and crop");
        urlContains("t:w_1_1_spirit_flying|ISD", false, "en", "/tisd/2/en?", "legacy token key resolves edition metadata");
        urlContains(token + "$alt", false, "en", "face=back", "reverse token face");
        check(ImageServer.downloadUrls("t:hidden", false, "en").isEmpty(), "hidden placeholder has no download");
        check(ImageServer.downloadUrls("t:missing|NOT_A_SET", false, "en").isEmpty(), "unknown token set has no download");
        check(ImageServer.language("pt-BR").equals("pt") && ImageServer.language("zh-CN").equals("zhs")
                && ImageServer.language("unknown").equals("en"), "language mapping");
        JsonObject examples = new JsonObject();
        examples.addProperty("localized", bolt);
        examples.addProperty("fallback", FModel.getMagicDb().getCommonCards().getCard("Sol Ring", "VOC").getImageKey(false));
        examples.addProperty("back", back);
        examples.addProperty("token", token);
        System.out.println("IMAGE_CASES " + examples);
    }

    private static byte[] jpeg(int color) throws Exception {
        BufferedImage image = new BufferedImage(8, 8, BufferedImage.TYPE_INT_RGB);
        for (int x = 0; x < 8; x++) for (int y = 0; y < 8; y++) image.setRGB(x, y, color);
        ByteArrayOutputStream out = new ByteArrayOutputStream();
        ImageIO.write(image, "jpg", out);
        return out.toByteArray();
    }

    private static String url(int port, String key, String language, boolean crop) {
        return "http://127.0.0.1:" + port + "/card?key=" + URLEncoder.encode(key, StandardCharsets.UTF_8)
                + "&format=" + (crop ? "crop" : "full") + "&lang=" + language;
    }

    private static HttpResponse<byte[]> get(int port, String key, String language, boolean crop) throws Exception {
        return CLIENT.send(HttpRequest.newBuilder(URI.create(url(port, key, language, crop)))
                .timeout(Duration.ofSeconds(10)).build(), HttpResponse.BodyHandlers.ofByteArray());
    }

    private static void same(byte[] expected, HttpResponse<byte[]> response, String message) {
        check(response.statusCode() == 200 && Arrays.equals(expected, response.body()), message);
    }

    private static void cacheAndFallback() throws Exception {
        byte[] english = jpeg(0x994422), portuguese = jpeg(0x224499);
        Path cache = Files.createTempDirectory("reforge-image-http-");
        Map<String, AtomicInteger> hits = new ConcurrentHashMap<>();
        HttpServer fixture = HttpServer.create(new InetSocketAddress("127.0.0.1", 0), 0);
        var fixtureWorkers = Executors.newCachedThreadPool();
        fixture.setExecutor(fixtureWorkers);
        fixture.createContext("/", exchange -> {
            try (exchange) {
                String path = exchange.getRequestURI().getPath();
                if (path.startsWith("/placeholder/") && exchange.getRequestURI().getQuery() == null) {
                    // Scryfall card JSON: the Portuguese printing exists but its picture is the English placeholder.
                    byte[] json = ("{\"image_status\":\"" + (path.contains("/pt/") ? "placeholder" : "highres_scan") + "\"}").getBytes(StandardCharsets.UTF_8);
                    exchange.getResponseHeaders().set("Content-Type", "application/json");
                    exchange.sendResponseHeaders(200, json.length);
                    exchange.getResponseBody().write(json);
                    return;
                }
                int count = hits.computeIfAbsent(path, ignored -> new AtomicInteger()).incrementAndGet();
                boolean localized = path.contains("/pt/");
                int status = path.startsWith("/missing/") || path.startsWith("/fallback") && localized ? 404
                        : path.startsWith("/retry/") && localized && count == 1 ? 503 : 200;
                byte[] bytes = localized ? portuguese : english;
                exchange.getResponseHeaders().set("Content-Type", "image/jpeg");
                if (path.startsWith("/bad-content/") && localized && count == 1) {
                    exchange.getResponseHeaders().set("Content-Type", "text/html");
                    bytes = "not a picture".getBytes(StandardCharsets.UTF_8);
                }
                exchange.sendResponseHeaders(status, bytes.length);
                exchange.getResponseBody().write(bytes);
            }
        });
        fixture.start();
        String origin = "http://127.0.0.1:" + fixture.getAddress().getPort();
        ImageServer.Source source = (key, crop, language) -> List.of(origin + "/" + key + "/" + language + "/" + (crop ? "crop" : "full")
                + (key.equals("placeholder") ? "?format=image" : ""));
        try {
            try (ImageServer server = new ImageServer(cache.toFile(), source)) {
                int port = server.start();
                same(portuguese, get(port, "localized", "pt-BR", false), "Portuguese image");
                same(english, get(port, "localized", "en-US", false), "English image separate from Portuguese");
                same(portuguese, get(port, "localized", "pt-BR", true), "crop has its own cache");
                for (int i = 0; i < 3; i++) same(portuguese, get(port, "localized", "pt-BR", false), "cached localized bytes");
                check(hits.get("/localized/pt/full").get() == 1 && hits.get("/localized/en/full").get() == 1, "one download per language");

                same(english, get(port, "fallback", "pt-BR", false), "missing Portuguese falls back to English");
                same(english, get(port, "fallback", "pt-BR", false), "fallback cached for requested language");
                check(hits.get("/fallback/pt/full").get() == 1 && hits.get("/fallback/en/full").get() == 1, "fallback fetched once");
                same(english, get(port, "placeholder", "pt-BR", false), "Scryfall placeholder counts as a missing translation");
                check(!hits.containsKey("/placeholder/pt/full"), "placeholder picture is never downloaded");
                var temporaryFallback = get(port, "retry", "pt-BR", false);
                same(english, temporaryFallback, "temporary failure can display English");
                check(temporaryFallback.headers().firstValue("Cache-Control").orElse("").equals("no-store"), "temporary fallback is not frozen by browser cache");
                same(portuguese, get(port, "retry", "pt-BR", false), "temporary failure does not poison localized cache");
                same(english, get(port, "bad-content", "pt-BR", false), "nonimage response falls back");
                same(portuguese, get(port, "bad-content", "pt-BR", false), "nonimage response is not cached");

                // A burst of missing translations must not deadlock all download workers.
                var burst = java.util.stream.IntStream.range(0, 12).mapToObj(i -> CLIENT.sendAsync(
                        HttpRequest.newBuilder(URI.create(url(port, "fallback" + i, "pt-BR", false)))
                                .timeout(Duration.ofSeconds(10)).build(), HttpResponse.BodyHandlers.ofByteArray())).toList();
                for (var request : burst) same(english, request.join(), "concurrent English fallback");
                var sameImage = java.util.stream.IntStream.range(0, 12).mapToObj(i -> CLIENT.sendAsync(
                        HttpRequest.newBuilder(URI.create(url(port, "parallel", "pt-BR", false)))
                                .timeout(Duration.ofSeconds(10)).build(), HttpResponse.BodyHandlers.ofByteArray())).toList();
                CompletableFuture.allOf(sameImage.toArray(CompletableFuture[]::new)).join();
                for (var request : sameImage) same(portuguese, request.join(), "concurrent same-image bytes");
                check(hits.get("/parallel/pt/full").get() == 1, "same-image requests share one download");

                check(get(port, "missing", "pt-BR", false).statusCode() == 404, "unavailable picture");
                check(get(port, "missing", "pt-BR", false).headers().firstValue("Cache-Control").orElse("").equals("no-store"), "failed request is not browser-cached");
                check(hits.get("/missing/pt/full").get() == 1 && hits.get("/missing/en/full").get() == 1, "missing image is not fetched repeatedly");
                String legacy = HexFormat.of().formatHex(MessageDigest.getInstance("SHA-1").digest("legacy".getBytes(StandardCharsets.UTF_8))) + ".full.jpg";
                Files.write(cache.resolve(legacy), english);
                same(english, get(port, "legacy", "en-US", false), "existing English cache remains usable");
            }
            fixture.stop(0);
            try (ImageServer offline = new ImageServer(cache.toFile(), (key, crop, language) -> {
                throw new AssertionError("Cached picture attempted a download: " + key);
            })) {
                int port = offline.start();
                same(portuguese, get(port, "localized", "pt-BR", false), "localized cache survives restart offline");
                same(english, get(port, "fallback", "pt-BR", false), "fallback cache survives restart offline");
                same(english, get(port, "legacy", "en-US", false), "legacy cache survives restart offline");
            }
            try (var files = Files.list(cache)) { check(files.noneMatch(p -> p.toString().endsWith(".tmp")), "no incomplete cache files"); }
        } finally {
            fixture.stop(0);
            fixtureWorkers.shutdownNow();
        }
    }
}
