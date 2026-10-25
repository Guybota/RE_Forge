package reforge.engine;

import java.io.IOException;
import java.nio.file.*;
import java.util.*;
import com.google.gson.*;

/** Forge's libGDX texture atlases read as plain text: an animation is every frame that shares a region name. */
final class AdventureSprites {
    private final Path root;
    private final Map<Path, Map<String, JsonObject>> atlases = new HashMap<>();

    AdventureSprites(Path root) throws IOException { this.root = root.toRealPath(); }

    /** Key into {@link #used} for the first of {@code names} the atlas has, or "" when there is none. */
    String key(String atlas, Map<String, JsonObject> used, String... names) {
        if (atlas == null || atlas.isBlank()) return "";
        try {
            Path path = root.resolve(atlas).normalize();
            if (!Files.isRegularFile(path) || !path.toRealPath().startsWith(root)) return "";
            Map<String, JsonObject> regions = atlases.get(path);
            if (regions == null) { regions = parse(path); atlases.put(path, regions); }
            for (String name : names) if (regions.containsKey(name)) {
                String key = root.relativize(path).toString().replace('\\', '/') + "#" + name;
                used.put(key, regions.get(name));
                return key;
            }
        } catch (IOException | RuntimeException e) { System.err.println("Unreadable Adventure atlas " + atlas + ": " + e); }
        return "";
    }

    private Map<String, JsonObject> parse(Path atlas) throws IOException {
        Map<String, JsonObject> out = new HashMap<>();
        String image = null;
        JsonArray frame = null;
        for (String raw : Files.readAllLines(atlas)) {
            String line = raw.strip();
            if (line.isEmpty()) continue;
            boolean indented = Character.isWhitespace(raw.charAt(0));
            if (!indented && line.endsWith(".png")) { image = root.relativize(atlas.getParent().resolve(line).normalize()).toString().replace('\\', '/'); frame = null; }
            else if (!indented && !line.contains(":") && image != null) {
                String page = image;
                JsonObject region = out.computeIfAbsent(line, k -> { JsonObject o = new JsonObject(); o.addProperty("image", page); o.add("frames", new JsonArray()); return o; });
                frame = new JsonArray(); for (int i = 0; i < 4; i++) frame.add(0);
                region.getAsJsonArray("frames").add(frame);
            } else if (indented && frame != null && line.contains(":")) {
                String key = line.substring(0, line.indexOf(':')).strip();
                String[] values = line.substring(line.indexOf(':') + 1).split(",");
                int offset = key.equals("xy") || key.equals("bounds") ? 0 : key.equals("size") ? 2 : -1;
                for (int i = 0; offset >= 0 && i < values.length && offset + i < 4; i++) frame.set(offset + i, new JsonPrimitive(Integer.parseInt(values[i].strip())));
            }
        }
        return out;
    }
}
