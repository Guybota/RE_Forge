package reforge.engine;

import java.io.File;
import java.io.IOException;
import java.io.InputStream;
import java.io.OutputStream;
import java.net.HttpURLConnection;
import java.net.InetSocketAddress;
import java.net.URI;
import java.net.URLDecoder;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.AtomicMoveNotSupportedException;
import java.nio.file.StandardCopyOption;
import java.security.MessageDigest;
import java.security.NoSuchAlgorithmException;
import java.util.HexFormat;
import java.util.Map;
import java.util.List;
import java.util.LinkedHashSet;
import java.util.Locale;
import java.util.Set;
import java.util.concurrent.CompletableFuture;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.TimeUnit;

import com.sun.net.httpserver.HttpExchange;
import com.sun.net.httpserver.HttpServer;

import forge.ImageKeys;
import forge.StaticData;
import forge.card.CardEdition;
import forge.item.PaperCard;
import forge.localinstance.properties.ForgeConstants;
import forge.util.ImageUtil;
import forge.util.ScryfallRateLimiter;

/**
 * Serves card pictures to the UI at http://127.0.0.1:PORT/card?key=IMAGE_KEY&format=crop|full.
 * The first request for a picture downloads it from Scryfall (through Forge's rate limiter, so
 * we stay inside Scryfall's request limits) and keeps it in the cache folder; later requests
 * read it from disk, so a game works offline once its cards have been seen.
 */
final class ImageServer implements AutoCloseable {
    private static final long WAIT_FOR_DOWNLOAD_SECONDS = 20;
    private static final Map<String, String> LANGUAGES = Map.ofEntries(
            Map.entry("en-US", "en"), Map.entry("pt-BR", "pt"), Map.entry("es-ES", "es"),
            Map.entry("fr-FR", "fr"), Map.entry("de-DE", "de"), Map.entry("it-IT", "it"),
            Map.entry("ru-RU", "ru"), Map.entry("ja-JP", "ja"), Map.entry("ko-KR", "ko"),
            Map.entry("zh-CN", "zhs"));

    @FunctionalInterface
    interface Source { List<String> urls(String key, boolean crop, String language); }

    private final File dir;
    private final Source source;
    private final ExecutorService downloads = Executors.newFixedThreadPool(4, daemon("image-download"));
    private final ExecutorService requests = Executors.newFixedThreadPool(8, daemon("image-http"));
    private final Map<String, CompletableFuture<File>> inFlight = new ConcurrentHashMap<>();
    /** Pictures Scryfall doesn't have; not asked for again this session. */
    private final Set<String> missing = ConcurrentHashMap.newKeySet();
    private HttpServer http;

    ImageServer() { this(new File(ForgeConstants.CACHE_DIR, "reforge-art"), ImageServer::downloadUrls); }

    /** Tests can use an isolated cache and a local HTTP source, without changing the production endpoint. */
    ImageServer(File dir, Source source) { this.dir = dir; this.source = source; }

    int start() throws IOException {
        Files.createDirectories(dir.toPath());
        http = HttpServer.create(new InetSocketAddress("127.0.0.1", 0), 0);
        http.createContext("/card", this::handle);
        http.setExecutor(requests);
        http.start();
        return http.getAddress().getPort();
    }

    private void handle(HttpExchange ex) throws IOException {
        try (ex) {
            Map<String, String> q = query(ex.getRequestURI());
            String key = q.get("key");
            boolean crop = !"full".equals(q.get("format"));
            String language = language(q.get("lang"));
            File file = key == null ? null : picture(key, crop, language);
            if (file == null) {
                ex.getResponseHeaders().set("Cache-Control", "no-store");
                ex.sendResponseHeaders(404, -1);
                return;
            }
            ex.getResponseHeaders().set("Content-Type", "image/jpeg");
            // An English response to a transient localized failure must also be retried by browsers.
            boolean transientFallback = !language.equals("en") && !file.getName().equals(fileName(key, crop, language));
            ex.getResponseHeaders().set("Cache-Control", transientFallback ? "no-store" : "max-age=31536000, immutable");
            ex.sendResponseHeaders(200, file.length());
            try (OutputStream out = ex.getResponseBody()) {
                Files.copy(file.toPath(), out);
            }
        }
    }

    /** The cached file, downloading it first if needed. Null if there is no picture. */
    private File picture(String key, boolean crop, String language) {
        try {
            return request(key, crop, language).get(WAIT_FOR_DOWNLOAD_SECONDS, TimeUnit.SECONDS);
        } catch (Exception e) {
            return null; // slow or failed; the UI keeps its colour block and may ask again later
        }
    }

    private CompletableFuture<File> request(String key, boolean crop, String language) {
        String name = fileName(key, crop, language);
        File cached = cached(key, crop, language);
        if (cached != null) return CompletableFuture.completedFuture(cached);
        // Compose the English fallback asynchronously: four localized requests must not block all
        // download workers waiting for four English downloads queued behind them.
        synchronized (inFlight) {
            CompletableFuture<File> existing = inFlight.get(name);
            if (existing != null) return existing;
            CompletableFuture<File> variant = CompletableFuture.supplyAsync(() -> downloadVariant(key, crop, language), downloads);
            CompletableFuture<File> result = variant.thenCompose(file -> file != null || language.equals("en")
                    ? CompletableFuture.completedFuture(file) : request(key, crop, "en")
                            .thenApply(english -> cacheFallback(english, name)));
            inFlight.put(name, result);
            result.whenComplete((file, error) -> inFlight.remove(name, result));
            return result;
        }
    }

    /** A confirmed missing translation may reuse English offline. Transient errors must be retried. */
    private File cacheFallback(File english, String name) {
        if (english == null || !missing.contains(name)) return english;
        java.nio.file.Path temporary = null;
        try {
            temporary = Files.createTempFile(dir.toPath(), "image-", ".tmp");
            Files.copy(english.toPath(), temporary, StandardCopyOption.REPLACE_EXISTING);
            File target = new File(dir, name);
            replace(temporary, target.toPath());
            return target;
        } catch (IOException e) {
            return english;
        } finally {
            if (temporary != null) try { Files.deleteIfExists(temporary); } catch (IOException ignored) { }
        }
    }

    private File cached(String key, boolean crop, String language) {
        File file = new File(dir, fileName(key, crop, language));
        if (file.isFile()) return file;
        // Existing caches were English-only; keep them useful offline after the upgrade.
        if (language.equals("en")) {
            File legacy = new File(dir, fileName(key, crop, ""));
            if (legacy.isFile()) return legacy;
        }
        return null;
    }

    private File downloadVariant(String key, boolean crop, String language) {
        String name = fileName(key, crop, language);
        if (missing.contains(name)) return null;
        File target = new File(dir, name);
        boolean retry = false;
        try {
            for (String url : source.urls(key, crop, language)) {
                Fetch result = download(url, target);
                if (result == Fetch.SAVED) return target;
                retry |= result == Fetch.RETRY;
            }
            if (!retry) missing.add(name);
        } catch (RuntimeException e) {
            System.err.println("Could not resolve image " + key + ": " + e.getMessage());
        }
        return null;
    }

    static String language(String code) {
        if (code == null) return "en";
        return LANGUAGES.getOrDefault(code, LANGUAGES.containsValue(code) ? code : "en");
    }

    /** Resolve the requested printing from Forge's own card/token edition metadata. */
    static List<String> downloadUrls(String key, boolean crop, String language) {
        String face = key.endsWith(ImageKeys.BACKFACE_POSTFIX) ? "back" : "";
        if (key.startsWith(ImageKeys.CARD_PREFIX)) {
            PaperCard card = ImageUtil.getPaperCardFromImageKey(key);
            if (card == null || card.getRules().isCustom()) return List.of();
            CardEdition edition = StaticData.instance().getEditions().get(card.getEdition());
            return List.of(ForgeConstants.URL_PIC_SCRYFALL_DOWNLOAD + ImageUtil.getScryfallDownloadUrl(
                    card, face, edition == null ? "" : edition.getScryfallCode(), language, crop));
        }
        if (!key.startsWith(ImageKeys.TOKEN_PREFIX)) return List.of();
        String tokenKey = face.isEmpty() ? key : key.substring(0, key.length() - ImageKeys.BACKFACE_POSTFIX.length());
        String[] parts = tokenKey.substring(ImageKeys.TOKEN_PREFIX.length()).split("\\|");
        if (parts.length < 2) return List.of();
        CardEdition edition = StaticData.instance().getEditions().get(parts[1]);
        if (edition == null || edition.getType() == CardEdition.Type.CUSTOM_SET) return List.of();
        Set<String> numbers = new LinkedHashSet<>();
        if (parts.length > 2 && !parts[2].isBlank()) numbers.add(parts[2]);
        else for (CardEdition.EditionEntry token : edition.getTokens().get(parts[0])) {
            if (token.collectorNumber() != null && !token.collectorNumber().isBlank()) numbers.add(token.collectorNumber());
        }
        return numbers.stream().map(number -> ForgeConstants.URL_PIC_SCRYFALL_DOWNLOAD
                + ImageUtil.getScryfallTokenDownloadUrl(number, edition.getTokensCode(), language, face)
                        .replace("version=normal", crop ? "version=art_crop" : "version=normal")).toList();
    }

    private enum Fetch { SAVED, MISSING, RETRY }

    private static Fetch download(String url, File target) {
        if (ScryfallRateLimiter.shouldSkip(url)) return Fetch.RETRY;
        HttpURLConnection conn = null;
        java.nio.file.Path tmp = null;
        try {
            ScryfallRateLimiter.acquire(url);
            conn = (HttpURLConnection) URI.create(url).toURL().openConnection();
            conn.setRequestProperty("Accept", "image/*");
            conn.setRequestProperty("User-Agent", "RE-Forge/" + Main.VERSION);
            conn.setConnectTimeout(10_000);
            conn.setReadTimeout(20_000);
            int code = conn.getResponseCode();
            if (code != HttpURLConnection.HTTP_OK) {
                ScryfallRateLimiter.noteIfRateLimited(code, url, conn.getHeaderField("Retry-After"));
                return code == 404 || code == 422 ? Fetch.MISSING : Fetch.RETRY;
            }
            String contentType = conn.getContentType();
            if (contentType == null || !contentType.toLowerCase(Locale.ROOT).startsWith("image/jpeg")) return Fetch.RETRY;
            // Write to a temp file first so a half-finished download is never served.
            tmp = Files.createTempFile(target.toPath().getParent(), "image-", ".tmp");
            try (InputStream in = conn.getInputStream()) {
                Files.copy(in, tmp, StandardCopyOption.REPLACE_EXISTING);
            }
            if (Files.size(tmp) == 0) return Fetch.RETRY;
            replace(tmp, target.toPath());
            return Fetch.SAVED;
        } catch (IOException | RuntimeException e) {
            System.err.println("Could not fetch " + url + ": " + e.getMessage());
            return Fetch.RETRY;
        } finally {
            if (conn != null) conn.disconnect();
            if (tmp != null) try { Files.deleteIfExists(tmp); } catch (IOException ignored) { }
        }
    }

    private static void replace(java.nio.file.Path source, java.nio.file.Path target) throws IOException {
        try {
            Files.move(source, target, StandardCopyOption.REPLACE_EXISTING, StandardCopyOption.ATOMIC_MOVE);
        } catch (AtomicMoveNotSupportedException e) {
            Files.move(source, target, StandardCopyOption.REPLACE_EXISTING);
        }
    }

    /** Image keys contain characters that aren't safe in file names, so name files by a hash of the key. */
    private static String fileName(String key, boolean crop, String language) {
        try {
            byte[] hash = MessageDigest.getInstance("SHA-1").digest(key.getBytes(StandardCharsets.UTF_8));
            return HexFormat.of().formatHex(hash) + (language.isEmpty() ? "" : "." + language) + (crop ? ".crop.jpg" : ".full.jpg");
        } catch (NoSuchAlgorithmException e) {
            throw new IllegalStateException(e);
        }
    }

    private static Map<String, String> query(URI uri) {
        Map<String, String> q = new ConcurrentHashMap<>();
        String raw = uri.getRawQuery();
        if (raw == null) return q;
        for (String pair : raw.split("&")) {
            int eq = pair.indexOf('=');
            if (eq > 0) {
                q.put(URLDecoder.decode(pair.substring(0, eq), StandardCharsets.UTF_8),
                        URLDecoder.decode(pair.substring(eq + 1), StandardCharsets.UTF_8));
            }
        }
        return q;
    }

    private static java.util.concurrent.ThreadFactory daemon(String name) {
        return r -> {
            Thread t = new Thread(r, name);
            t.setDaemon(true);
            return t;
        };
    }

    @Override public void close() {
        if (http != null) http.stop(0);
        requests.shutdownNow();
        downloads.shutdownNow();
    }
}
