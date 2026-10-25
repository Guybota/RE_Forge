package reforge.engine;

import java.io.*;
import java.nio.*;
import java.nio.file.*;
import java.util.*;
import java.util.zip.*;
import javax.xml.XMLConstants;
import javax.xml.parsers.DocumentBuilderFactory;
import org.w3c.dom.*;
import com.google.gson.*;
import forge.localinstance.properties.ForgeConstants;

/** Read Forge's Tiled assets without loading libGDX or requiring an OpenGL context. */
final class AdventureMap {
    record Rect(double x, double y, double w, double h) {
        boolean touches(double px, double py) { return px + 5 > x && px - 5 < x + w && py + 5 > y && py - 5 < y + h; }
    }
    /** {@code gid}: the object's own tile in this map's tilesets (with Tiled flip bits), 0 when it has none. */
    record Item(String id, String type, double x, double y, double w, double h, long gid, Map<String, String> properties) { }
    /** Object types we act on; Forge's "exit" leaves like an entry and "Rotating" is a shop with a rotation list. */
    private static final Map<String, String> TYPES = Map.of("enemy", "enemy", "reward", "reward", "entry", "entry", "exit", "entry",
        "inn", "inn", "quest", "quest", "shop", "shop", "rotating", "shop");
    final JsonObject json = new JsonObject();
    final List<Item> items = new ArrayList<>();
    final List<Rect> walls = new ArrayList<>();
    final int width, height, tile;
    double startX, startY;
    private final Path root;
    private final List<Tileset> sets = new ArrayList<>();
    private record Tileset(int first, int columns, int size, Map<Integer, List<Rect>> collisions) { }

    AdventureMap(String relative) throws Exception {
        root = Path.of(ForgeConstants.ADVENTURE_DIR).toRealPath();
        Path path = safe(relative);
        Element map = xml(path).getDocumentElement();
        width = integer(map, "width", 0); height = integer(map, "height", 0); tile = integer(map, "tilewidth", 16);
        if (width < 1 || height < 1 || width * height > 100_000) throw new IOException("Unsupported Adventure map size");
        json.addProperty("width", width); json.addProperty("height", height); json.addProperty("tile", tile);
        JsonArray textures = new JsonArray();
        Map<Path, Integer> firstBySource = new HashMap<>();
        for (Element entry : children(map, "tileset")) {
            int first = integer(entry, "firstgid", 1);
            boolean embedded = !entry.hasAttribute("source");
            Path tsx = embedded ? path : path.getParent().resolve(entry.getAttribute("source")).normalize();
            if (!embedded) firstBySource.put(safe(tsx), first);
            Element set = embedded ? entry : xml(safe(tsx)).getDocumentElement();
            int size = integer(set, "tilewidth", tile), columns = integer(set, "columns", 1);
            Element image = children(set, "image").get(0);
            Path imagePath = safe(tsx.getParent().resolve(image.getAttribute("source")).normalize());
            JsonObject texture = new JsonObject();
            texture.addProperty("first", first); texture.addProperty("columns", columns); texture.addProperty("size", size);
            texture.addProperty("image", root.relativize(imagePath).toString().replace('\\', '/')); textures.add(texture);
            Map<Integer, List<Rect>> collisions = new HashMap<>();
            for (Element t : children(set, "tile")) for (Element group : children(t, "objectgroup")) {
                List<Rect> boxes = new ArrayList<>();
                for (Element object : children(group, "object")) boxes.add(rect(object));
                if (!boxes.isEmpty()) collisions.put(integer(t, "id", 0), boxes);
            }
            sets.add(new Tileset(first, columns, size, collisions));
        }
        sets.sort(Comparator.comparingInt(Tileset::first));
        json.add("tilesets", textures);
        JsonArray layers = new JsonArray();
        for (Element layer : children(map, "layer")) {
            if (layer.getAttribute("visible").equals("0")) continue;
            Element data = children(layer, "data").get(0);
            int[] gids = decode(data, width * height);
            JsonArray values = new JsonArray();
            for (int i = 0; i < gids.length; i++) {
                int gid = gids[i], clean = gid & 0x1fffffff;
                values.add(Integer.toUnsignedLong(gid));
                if (clean == 0) continue;
                Tileset s = null;
                for (Tileset candidate : sets) if (candidate.first <= clean) s = candidate;
                if (s == null) continue;
                for (Rect r : s.collisions.getOrDefault(clean - s.first, List.of())) {
                    // Tiled flips are applied to collision corners as well as to the image.
                    double minX = tile, minY = tile, maxX = 0, maxY = 0;
                    for (double xx : new double[]{r.x, r.x + r.w}) for (double yy : new double[]{r.y, r.y + r.h}) {
                        double x = xx, y = yy;
                        if ((gid & 0x20000000) != 0) { double temp = x; x = y; y = temp; }
                        if ((gid & 0x80000000) != 0) x = tile - x;
                        if ((gid & 0x40000000) != 0) y = tile - y;
                        minX = Math.min(minX, x); maxX = Math.max(maxX, x); minY = Math.min(minY, y); maxY = Math.max(maxY, y);
                    }
                    walls.add(new Rect(i % width * tile + minX, i / width * tile + minY, maxX - minX, maxY - minY));
                }
            }
            JsonObject out = new JsonObject(); out.add("gids", values); out.addProperty("opacity", decimal(layer, "opacity", 1)); layers.add(out);
        }
        json.add("layers", layers);
        startX = width * tile / 2.; startY = (height - 2) * tile;
        for (Element group : children(map, "objectgroup")) for (Element object : children(group, "object")) {
            Element template = null;
            long gid = object.hasAttribute("gid") ? Long.parseLong(object.getAttribute("gid")) : 0;
            if (object.hasAttribute("template")) {
                Path tx = safe(path.getParent().resolve(object.getAttribute("template")).normalize());
                Element doc = xml(tx).getDocumentElement();
                template = children(doc, "object").get(0);
                // A template's gid counts in its own tileset; move it into this map's numbering of the same .tsx.
                if (gid == 0 && template.hasAttribute("gid") && !children(doc, "tileset").isEmpty()) {
                    Element own = children(doc, "tileset").get(0);
                    Integer mapFirst = own.hasAttribute("source") ? firstBySource.get(safe(tx.getParent().resolve(own.getAttribute("source")).normalize())) : null;
                    long raw = Long.parseLong(template.getAttribute("gid"));
                    if (mapFirst != null) gid = (raw & 0xE0000000L) | ((raw & 0x1fffffff) - integer(own, "firstgid", 1) + mapFirst);
                }
            }
            Map<String, String> props = template == null ? new HashMap<>() : properties(template);
            props.putAll(properties(object));
            // Tiled 1.9+ writes "class" where older maps wrote "type"; Forge's templates also carry a type property.
            String type = object.getAttribute("type");
            if (type.isEmpty()) type = object.getAttribute("class");
            if (type.isEmpty() && template != null) type = template.getAttribute("type");
            if (type.isEmpty() && template != null) type = template.getAttribute("class");
            if (type.isEmpty()) type = props.getOrDefault("Type", props.getOrDefault("type", ""));
            double x = decimal(object, "x", 0), y = decimal(object, "y", 0);
            double w = decimal(object, "width", template == null ? 16 : decimal(template, "width", 16));
            double h = decimal(object, "height", template == null ? 16 : decimal(template, "height", 16));
            boolean bottom = object.hasAttribute("gid") || template != null && template.hasAttribute("gid");
            double cy = y + (bottom ? -h / 2 : h / 2);
            if (type.equalsIgnoreCase("collision")) walls.add(new Rect(x, y, w, h));
            else if (TYPES.containsKey(type.toLowerCase(Locale.ROOT))) {
                String kind = TYPES.get(type.toLowerCase(Locale.ROOT));
                items.add(new Item(object.getAttribute("id"), kind, x + w / 2, cy, w, h, gid, props));
                if (type.equals("entry")) { startX = x + w / 2; startY = Math.min(height * tile - 24, cy); }
            }
        }
        double[] spawn = spawn(startX, startY); startX = spawn[0]; startY = spawn[1];
    }
    boolean canStand(double x, double y) {
        return x >= 6 && y >= 6 && x < width * tile - 6 && y < height * tile - 6 && walls.stream().noneMatch(r -> r.touches(x, y));
    }
    double[] spawn(double x, double y) {
        if (canStand(x, y)) return new double[]{x, y};
        for (int radius = 1; radius < Math.max(width, height); radius++) for (int dx = -radius; dx <= radius; dx++) for (int dy : new int[]{-radius, radius}) {
            double xx = x + dx * tile, yy = y + dy * tile;
            if (canStand(xx, yy)) return new double[]{xx, yy};
        }
        throw new IllegalStateException("Adventure map has no safe entry");
    }
    private Path safe(String relative) throws IOException { return safe(root.resolve(relative).normalize()); }
    private Path safe(Path path) throws IOException {
        Path real = path.toRealPath();
        if (!real.startsWith(root)) throw new IOException("Adventure asset outside resource directory");
        return real;
    }
    private static Document xml(Path file) throws Exception {
        DocumentBuilderFactory factory = DocumentBuilderFactory.newInstance();
        factory.setFeature("http://apache.org/xml/features/disallow-doctype-decl", true);
        factory.setAttribute(XMLConstants.ACCESS_EXTERNAL_DTD, ""); factory.setAttribute(XMLConstants.ACCESS_EXTERNAL_SCHEMA, "");
        return factory.newDocumentBuilder().parse(file.toFile());
    }
    private static List<Element> children(Element parent, String tag) {
        List<Element> out = new ArrayList<>();
        for (Node n = parent.getFirstChild(); n != null; n = n.getNextSibling()) if (n instanceof Element e && e.getTagName().equals(tag)) out.add(e);
        return out;
    }
    private static Map<String, String> properties(Element element) {
        Map<String, String> result = new HashMap<>();
        for (Element group : children(element, "properties")) for (Element p : children(group, "property"))
            result.put(p.getAttribute("name"), p.hasAttribute("value") ? p.getAttribute("value") : p.getTextContent());
        return result;
    }
    private static Rect rect(Element e) { return new Rect(decimal(e, "x", 0), decimal(e, "y", 0), decimal(e, "width", 0), decimal(e, "height", 0)); }
    private static int integer(Element e, String key, int fallback) { return e.hasAttribute(key) ? Integer.parseInt(e.getAttribute(key)) : fallback; }
    private static double decimal(Element e, String key, double fallback) { return e.hasAttribute(key) ? Double.parseDouble(e.getAttribute(key)) : fallback; }
    private static int[] decode(Element data, int count) throws IOException {
        int[] out = new int[count];
        if (data.getAttribute("encoding").equals("csv")) {
            String[] parts = data.getTextContent().trim().split("\\s*,\\s*");
            if (parts.length != count) throw new IOException("Invalid tile count");
            for (int i = 0; i < count; i++) out[i] = Integer.parseUnsignedInt(parts[i]);
        } else {
            byte[] raw = Base64.getMimeDecoder().decode(data.getTextContent());
            InputStream input = new ByteArrayInputStream(raw);
            String compression = data.getAttribute("compression");
            if (compression.equals("zlib")) input = new InflaterInputStream(input);
            else if (compression.equals("gzip")) input = new GZIPInputStream(input);
            else if (!compression.isEmpty()) throw new IOException("Unsupported tile compression");
            try (InputStream stream = input) {
                byte[] bytes = stream.readNBytes(count * 4 + 1);
                if (bytes.length != count * 4) throw new IOException("Invalid tile data size");
                ByteBuffer buffer = ByteBuffer.wrap(bytes).order(ByteOrder.LITTLE_ENDIAN);
                for (int i = 0; i < count; i++) out[i] = buffer.getInt();
            }
        }
        return out;
    }
}
