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
import java.nio.file.StandardCopyOption;
import java.security.MessageDigest;
import java.security.NoSuchAlgorithmException;
import java.util.HexFormat;
import java.util.Map;
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
final class ImageServer {
    private static final long WAIT_FOR_DOWNLOAD_SECONDS = 20;

    private final File dir = new File(ForgeConstants.CACHE_DIR, "reforge-art");
    private final ExecutorService downloads = Executors.newFixedThreadPool(4, daemon("image-download"));
    private final Map<String, CompletableFuture<File>> inFlight = new ConcurrentHashMap<>();
    /** Pictures Scryfall doesn't have; not asked for again this session. */
    private final Set<String> missing = ConcurrentHashMap.newKeySet();
    private HttpServer http;

    int start() throws IOException {
        dir.mkdirs();
        http = HttpServer.create(new InetSocketAddress("127.0.0.1", 0), 0);
        http.createContext("/card", this::handle);
        http.setExecutor(Executors.newFixedThreadPool(8, daemon("image-http")));
        http.start();
        return http.getAddress().getPort();
    }

    private void handle(HttpExchange ex) throws IOException {
        try (ex) {
            Map<String, String> q = query(ex.getRequestURI());
            String key = q.get("key");
            boolean crop = !"full".equals(q.get("format"));
            File file = key == null ? null : picture(key, crop);
            if (file == null) {
                ex.sendResponseHeaders(404, -1);
                return;
            }
            ex.getResponseHeaders().set("Content-Type", "image/jpeg");
            // A key always names the same printing, so the browser may keep it forever.
            ex.getResponseHeaders().set("Cache-Control", "max-age=31536000, immutable");
            ex.sendResponseHeaders(200, file.length());
            try (OutputStream out = ex.getResponseBody()) {
                Files.copy(file.toPath(), out);
            }
        }
    }

    /** The cached file, downloading it first if needed. Null if there is no picture. */
    private File picture(String key, boolean crop) {
        String name = fileName(key, crop);
        File file = new File(dir, name);
        if (file.isFile()) return file;
        if (missing.contains(name)) return null;
        CompletableFuture<File> f = inFlight.computeIfAbsent(name, n ->
                CompletableFuture.supplyAsync(() -> download(key, crop, file), downloads)
                        .whenComplete((result, err) -> inFlight.remove(n)));
        try {
            File result = f.get(WAIT_FOR_DOWNLOAD_SECONDS, TimeUnit.SECONDS);
            if (result == null) missing.add(name);
            return result;
        } catch (Exception e) {
            return null; // slow or failed; the UI keeps its colour block and may ask again later
        }
    }

    private static File download(String key, boolean crop, File target) {
        // shortcut: card printings only; tokens ("t:" keys) keep the colour block until their Scryfall lookup is added.
        if (!key.startsWith(ImageKeys.CARD_PREFIX)) return null;
        PaperCard card = ImageUtil.getPaperCardFromImageKey(key);
        if (card == null || card.getRules().isCustom()) return null;
        CardEdition edition = StaticData.instance().getEditions().get(card.getEdition());
        String face = key.endsWith(ImageKeys.BACKFACE_POSTFIX) ? "back" : "";
        String url = ForgeConstants.URL_PIC_SCRYFALL_DOWNLOAD
                + ImageUtil.getScryfallDownloadUrl(card, face, edition == null ? "" : edition.getScryfallCode(), "", crop);
        if (ScryfallRateLimiter.shouldSkip(url)) return null;
        try {
            ScryfallRateLimiter.acquire(url);
            HttpURLConnection conn = (HttpURLConnection) URI.create(url).toURL().openConnection();
            conn.setRequestProperty("Accept", "image/*");
            conn.setRequestProperty("User-Agent", "RE-Forge/" + Main.VERSION);
            conn.setConnectTimeout(10_000);
            conn.setReadTimeout(20_000);
            int code = conn.getResponseCode();
            if (code != HttpURLConnection.HTTP_OK) {
                ScryfallRateLimiter.noteIfRateLimited(code, url, conn.getHeaderField("Retry-After"));
                conn.disconnect();
                return null;
            }
            // Write to a temp file first so a half-finished download is never served.
            File tmp = new File(target.getPath() + ".tmp");
            try (InputStream in = conn.getInputStream()) {
                Files.copy(in, tmp.toPath(), StandardCopyOption.REPLACE_EXISTING);
            }
            Files.move(tmp.toPath(), target.toPath(), StandardCopyOption.REPLACE_EXISTING, StandardCopyOption.ATOMIC_MOVE);
            return target;
        } catch (IOException | RuntimeException e) {
            System.err.println("Could not fetch " + url + ": " + e.getMessage());
            return null;
        }
    }

    /** Image keys contain characters that aren't safe in file names, so name files by a hash of the key. */
    private static String fileName(String key, boolean crop) {
        try {
            byte[] hash = MessageDigest.getInstance("SHA-1").digest(key.getBytes(StandardCharsets.UTF_8));
            return HexFormat.of().formatHex(hash) + (crop ? ".crop.jpg" : ".full.jpg");
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
}
