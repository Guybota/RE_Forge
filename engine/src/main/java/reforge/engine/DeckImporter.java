package reforge.engine;

import java.io.File;
import java.util.ArrayList;
import java.util.Collection;
import java.util.HashSet;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.Set;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

import com.google.gson.JsonArray;
import com.google.gson.JsonElement;
import com.google.gson.JsonObject;

import forge.deck.Deck;
import forge.deck.DeckFormat;
import forge.deck.DeckImportController;
import forge.deck.DeckRecognizer;
import forge.deck.DeckRecognizer.Token;
import forge.deck.DeckRecognizer.TokenType;
import forge.deck.DeckSection;
import forge.deck.io.DeckStorage;
import forge.localinstance.properties.ForgeConstants;
import forge.util.FileSection;
import forge.util.FileUtil;
import forge.game.GameType;
import forge.gui.interfaces.ICheckBox;
import forge.gui.interfaces.IComboBox;
import forge.item.PaperCard;
import forge.model.FModel;
import forge.util.storage.IStorage;

/**
 * Turns a pasted decklist (Moxfield, Archidekt, MTG Arena, MTGO exports) into a Commander deck,
 * using Forge's own recogniser. Saved decks live in the user's Commander deck folder, inside our
 * data directory.
 */
final class DeckImporter {
    private DeckImporter() { }

    /** What the UI shows for each line, plus the resulting deck if it can be built. */
    record Preview(JsonObject json, Deck deck) { }

    static Preview preview(String text, String name) {
        if (text == null) text = "";
        // Forge has no maybeboard. Peel it off so those cards are not absorbed by the section above them.
        MaybeSplit split = splitMaybeboard(text);
        text = split.deck();
        DeckImportController controller = controller();
        List<Token> tokens = controller.parseInput(text);
        List<String> found = impliedCommanders(text, tokens);
        if (found != null) tokens = controller.parseInput(text = withCommanders(text, found));

        JsonArray lines = new JsonArray();
        int unknown = 0;
        for (Token t : tokens) unknown = addLine(lines, controller, t, false, unknown);
        if (!split.maybeboard().isEmpty()) {
            // A Commander import would promote a lone instant (an Oathbreaker signature spell) into the command zone.
            DeckRecognizer recognizer = new DeckRecognizer();
            recognizer.setAllowedDeckSections(new ArrayList<>(SECTIONS));
            DeckImportController messages = controller();
            for (String line : split.maybeboard()) {
                Token t = recognizer.recognizeLine(line, DeckSection.Main);
                if (t == null) continue;
                if (t.isCardToken() && t.getTokenSection() == null) t.resetTokenSection(DeckSection.Main);
                unknown = addLine(lines, messages, t, true, unknown);
            }
        }

        Deck deck = tokens.isEmpty() ? null : controller.accept(name == null ? "" : name);
        JsonObject o = new JsonObject();
        o.addProperty("type", "deckPreview");
        o.add("lines", lines);
        o.addProperty("unknown", unknown);
        if (deck != null) {
            if (name != null && !name.isBlank()) deck.setName(name.trim());
            o.addProperty("name", deck.getName());
            o.addProperty("cards", deck.getMain().countAll() + (deck.has(DeckSection.Commander) ? deck.get(DeckSection.Commander).countAll() : 0));
            JsonArray commanders = new JsonArray();
            if (deck.has(DeckSection.Commander)) {
                for (PaperCard c : deck.get(DeckSection.Commander).toFlatList()) commanders.add(c.getName());
            }
            o.add("commanders", commanders);
            // The commanders' combined colour identity (Forge's W U B R G bits), for the builder's card filter.
            int identity = 0;
            if (deck.has(DeckSection.Commander)) {
                for (PaperCard c : deck.get(DeckSection.Commander).toFlatList()) identity |= c.getRules().getColorIdentity().getColor();
            }
            o.addProperty("identity", identity);
            String problem = DeckFormat.Commander.getDeckConformanceProblem(deck);
            if (problem != null) o.addProperty("problem", problem);
        }
        return new Preview(o, deck);
    }

    /** Unknown lines that get suggestions; each one scans the whole catalog. */
    private static final int MAX_SUGGESTED = 10;

    /** One recognised line. A maybeboard card is flagged and kept out of Forge's deck. */
    private static int addLine(JsonArray lines, DeckImportController controller, Token t, boolean maybeboard, int unknown) {
        String status = status(t.getType());
        if (status == null) return unknown; // comments, section headers and other non-card text
        if ("error".equals(status)) unknown++;
        JsonObject l = new JsonObject();
        l.addProperty("text", controller.getTokenMessage(t));
        l.addProperty("status", status);
        String message = controller.getTokenStatusMessage(t);
        if (message != null && !message.isEmpty()) l.addProperty("message", message);
        if (t.getType() == TokenType.UNKNOWN_CARD && unknown <= MAX_SUGGESTED) {
            // The name as typed (Forge keeps the whole line: count, set, number) and the closest real cards.
            String requested = t.getText().trim().replaceFirst("^\\d+x?\\s+", "")
                    .replaceFirst("\\s*[\\[(][^\\])]*[\\])](\\s+\\S+)?$", "");
            l.addProperty("requested", requested);
            JsonArray suggestions = new JsonArray();
            for (PaperCard s : CardCatalog.similar(requested, 3)) {
                JsonObject o = new JsonObject();
                o.addProperty("nameEn", s.getName());
                o.addProperty("name", forge.util.CardTranslation.getTranslatedName(s.getName()));
                suggestions.add(o);
            }
            l.add("suggestions", suggestions);
        }
        PaperCard card = t.getCard();
        if (card != null) {
            // For the grouped list and the builder: the card as the catalog describes it, its count and section.
            CardCatalog.card(card).entrySet().forEach(e -> l.add(e.getKey(), e.getValue()));
            l.addProperty("qty", t.getQuantity());
            // "commander" replaces the type group for display; typeGroup keeps it for the builder.
            l.addProperty("typeGroup", group(card));
            if (maybeboard) l.addProperty("maybeboard", true);
            else {
                if (t.getTokenSection() == DeckSection.Commander) l.addProperty("group", "commander");
                if (t.getTokenSection() == DeckSection.Sideboard) l.addProperty("sideboard", true);
            }
        } else if (maybeboard) l.addProperty("maybeboard", true);
        lines.add(l);
        return unknown;
    }

    /** The list Forge can store, and the maybeboard lines it would otherwise drop. */
    private record MaybeSplit(String deck, List<String> maybeboard) {}

    private static MaybeSplit splitMaybeboard(String text) {
        List<String> deck = new ArrayList<>(), maybe = new ArrayList<>();
        boolean inMaybe = false;
        for (String line : text.split("\\R", -1)) {
            if (maybeHeader(line)) { inMaybe = true; continue; }
            if (inMaybe && otherHeader(line)) inMaybe = false;
            (inMaybe ? maybe : deck).add(line);
        }
        List<String> cards = new ArrayList<>();
        for (String line : maybe) if (!line.isBlank()) cards.add(line.trim());
        return new MaybeSplit(String.join("\n", deck), cards);
    }

    private static String headerName(String line) {
        String t = line.trim();
        if (t.startsWith("[") && t.endsWith("]") && t.length() > 2) t = t.substring(1, t.length() - 1).trim();
        t = t.replaceFirst("^(?://|#)+\\s*", "").replaceAll("[:\\s]+$", "");
        return t;
    }

    private static boolean maybeHeader(String line) {
        String t = headerName(line);
        return t.equalsIgnoreCase("maybeboard") || t.equalsIgnoreCase("maybe board");
    }

    private static boolean otherHeader(String line) {
        return switch (headerName(line).toLowerCase(Locale.ROOT)) {
            case "commander", "commanders", "deck", "main", "mainboard", "sideboard", "side", "sb", "companion" -> true;
            default -> false;
        };
    }

    /**
     * Commanders a list implies without a Commander section, which Forge doesn't settle: two partners in the
     * sideboard, or (MTGO and Moxfield text exports) one or two commanders alone after the last blank line.
     * These beat Forge's own guess of the only legend in the deck. Null when the list names its commanders or
     * nothing fits.
     */
    private static List<String> impliedCommanders(String text, List<Token> tokens) {
        // The same markers Forge's DeckImportController looks for.
        for (String line : text.split("\\R")) {
            String t = line.trim();
            if (t.startsWith("CM:") || t.replaceAll("^[/#*]+\\s*", "").replaceAll("[:\\s]+$", "").equalsIgnoreCase("commander")) return null;
        }
        List<PaperCard> sideboard = new ArrayList<>();
        for (Token t : tokens) {
            if (t.isCardToken() && t.getCard() != null && t.getTokenSection() == DeckSection.Sideboard
                    && t.getCard().getRules().canBeCommander()) sideboard.add(t.getCard());
        }
        if (sideboard.size() == 2) return leaders(sideboard);
        List<String> lines = new ArrayList<>(List.of(text.split("\\R")));
        while (!lines.isEmpty() && lines.get(lines.size() - 1).isBlank()) lines.remove(lines.size() - 1);
        int blank = lines.size() - 1;
        while (blank >= 0 && !lines.get(blank).isBlank()) blank--;
        if (blank <= 0 || lines.size() - blank - 1 > 2) return null;
        DeckRecognizer recognizer = new DeckRecognizer();
        recognizer.setAllowedDeckSections(new ArrayList<>(SECTIONS));
        List<PaperCard> last = new ArrayList<>();
        for (String line : lines.subList(blank + 1, lines.size())) {
            Token t = recognizer.recognizeLine(line, null);
            if (t == null || !t.isCardToken() || t.getCard() == null || t.getQuantity() != 1) return null;
            last.add(t.getCard());
        }
        return leaders(last);
    }

    /** The cards' names when they can lead a deck together (one commander or a valid pair); otherwise null. */
    private static List<String> leaders(List<PaperCard> cards) {
        if (cards.isEmpty() || cards.size() > 2 || !cards.stream().allMatch(c -> c.getRules().canBeCommander())) return null;
        if (cards.size() == 2 && !cards.get(0).getRules().canBePartnerCommanders(cards.get(1).getRules())) return null;
        return cards.stream().map(PaperCard::getName).toList();
    }

    /**
     * The decklist with {@code name} as its commander: a partner joins a single compatible commander, anything
     * else replaces the current ones, which go back to the deck.
     */
    static String chooseCommander(String text, String name) {
        Deck deck = preview(text, "").deck();
        List<String> next = new ArrayList<>();
        if (deck != null && deck.has(DeckSection.Commander)) {
            List<PaperCard> current = deck.get(DeckSection.Commander).toFlatList();
            PaperCard card = FModel.getMagicDb().getCommonCards().getCard(name);
            if (current.size() == 1 && card != null && current.get(0).getRules().canBePartnerCommanders(card.getRules())) {
                next.add(current.get(0).getName());
            }
        }
        next.add(name);
        return withCommanders(text == null ? "" : text, next);
    }

    /**
     * Rewrites a decklist so exactly the named cards (English names) form a Commander section at the top. Cards
     * that were commanders go to the deck; every other line keeps its place and wording.
     */
    static String withCommanders(String text, Collection<String> names) {
        DeckRecognizer recognizer = new DeckRecognizer();
        recognizer.setAllowedDeckSections(new ArrayList<>(SECTIONS));
        List<String> commanders = new ArrayList<>(), demoted = new ArrayList<>(), rest = new ArrayList<>();
        Set<String> placed = new HashSet<>();
        DeckSection section = null;
        String mainHeader = null; // the list's own "Deck"/"Main" header when the rest starts with it
        for (String line : text.split("\\R", -1)) {
            Token t = recognizer.recognizeLine(line, section);
            if (t != null && t.isDeckSection()) {
                section = DeckSection.valueOf(t.getText());
                if (section == DeckSection.Main && rest.stream().allMatch(String::isBlank)) { rest.clear(); mainHeader = line; }
                else if (section != DeckSection.Commander) rest.add(line);
                continue;
            }
            PaperCard card = t == null || !t.isCardToken() ? null : t.getCard();
            // Only an explicit Commander section or "CM:" line; Forge's guess for unsectioned legends doesn't count.
            boolean wasCommander = card != null && (section == DeckSection.Commander || line.trim().regionMatches(true, 0, "CM:", 0, 3));
            if (card != null && names.contains(card.getName())) {
                if (placed.add(card.getName())) commanders.add(line(1, card, t));
                if (t.getQuantity() > 1) demoted.add(line(t.getQuantity() - 1, card, t));
            } else if (wasCommander) {
                demoted.add(line(t.getQuantity(), card, t));
            } else {
                rest.add(line);
            }
        }
        while (!rest.isEmpty() && rest.get(0).isBlank()) rest.remove(0);
        StringBuilder out = new StringBuilder();
        if (!commanders.isEmpty()) out.append("Commander\n").append(String.join("\n", commanders)).append("\n\n");
        out.append(mainHeader == null ? "Deck" : mainHeader).append('\n');
        for (String l : demoted) out.append(l).append('\n');
        return out.append(String.join("\n", rest)).toString();
    }

    /** A moved card's line; the printing only when the original line asked for one. */
    private static String line(int qty, PaperCard card, Token from) {
        String l = qty + " " + card.getName();
        return from.cardRequestHasNoCode() ? l : l + " (" + card.getEdition() + ") " + card.getCollectorNumber();
    }

    /** Resolve an external list without writing it into the user's Commander library. */
    /** Saves a decklist; tags and notes come from {@code from} (the deck being edited) or the deck it replaces. */
    static String save(String text, String name, String from) {
        String invalid = invalidName(name);
        if (invalid != null) return invalid;
        MaybeSplit split = splitMaybeboard(text == null ? "" : text);
        Preview p = preview(split.deck(), name);
        if (p.deck() == null || p.deck().getMain().isEmpty()) return "No cards recognised";
        Deck old = mine().get(from != null && !from.isBlank() ? from : name.trim());
        if (old != null) {
            p.deck().setComment(old.getComment());
            p.deck().getTags().addAll(old.getTags());
        }
        mine().add(p.deck());
        // Forge rewrites the file from its own sections, so the maybeboard is put back afterwards.
        writeMaybeboard(p.deck(), split.maybeboard());
        return null;
    }

    static final String BRACKET_TAG = "reforge-bracket-";
    /** Bracket stamped by "Analisar deck" on the Analysis tab (Central's calculatedBracket). */
    static final String CALC_BRACKET_TAG = "reforge-calc-bracket-";

    /**
     * The player's own tags, notes and intended bracket (1–5, 0 = none). Forge keeps the comment on one line, so
     * line breaks are stored as a backslash and "n" (backslashes doubled). Our internal "reforge-" tags (Limited results, bracket) are kept apart.
     * {@code calculated} null leaves a stamped calculated bracket alone; 0 clears it; 1–5 stamps it.
     * Returns an error message or null.
     */
    static String setMeta(String name, List<String> tags, String notes, int bracket, Integer calculated) {
        Deck deck = mine().get(name);
        if (deck == null) return "Unknown deck: " + name;
        if (tags.size() > 20) return "Too many tags";
        if (notes != null && notes.length() > 4000) return "Notes are too long";
        if (bracket < 0 || bracket > 5) return "Invalid bracket";
        if (calculated != null && (calculated < 0 || calculated > 5)) return "Invalid bracket";
        Set<String> clean = new LinkedHashSet<>();
        for (String tag : tags) {
            String t = tag == null ? "" : tag.trim();
            if (t.isEmpty()) continue;
            if (t.length() > 40 || t.contains(",") || t.toLowerCase(Locale.ROOT).startsWith("reforge-")) return "Invalid tag: " + t;
            clean.add(t);
        }
        deck.getTags().removeIf(t -> !t.startsWith("reforge-") || t.startsWith(BRACKET_TAG)
                || (calculated != null && t.startsWith(CALC_BRACKET_TAG)));
        deck.getTags().addAll(clean);
        if (bracket > 0) deck.getTags().add(BRACKET_TAG + bracket);
        if (calculated != null && calculated > 0) deck.getTags().add(CALC_BRACKET_TAG + calculated);
        String comment = notes == null ? "" : notes.strip().replace("\\", "\\\\").replace("\r", "").replace("\n", "\\n");
        deck.setComment(comment.isEmpty() ? null : comment);
        List<String> maybe = storedMaybeboard(deck);
        mine().add(deck);
        writeMaybeboard(deck, maybe);
        return null;
    }

    /**
     * Brings decks from the old Central library into the player's Forge decks: a library export
     * ({@code {version, decks}}), a list of decks or one deck. Names never replace a deck (a suffix is added),
     * tags/notes/intended bracket come along, printings are left to Forge (Central's set codes are Scryfall's).
     * Returns {@code imported: [{from, name, unknown}]} and {@code failed: [{name, reason}]}.
     */
    static JsonObject importCentral(String json) {
        JsonElement root;
        try { root = com.google.gson.JsonParser.parseString(json == null ? "" : json); }
        catch (com.google.gson.JsonParseException e) { throw new IllegalArgumentException("Not a Central library"); }
        JsonArray decks = root.isJsonArray() ? root.getAsJsonArray()
                : root.isJsonObject() && root.getAsJsonObject().has("decks") ? root.getAsJsonObject().getAsJsonArray("decks")
                : root.isJsonObject() && root.getAsJsonObject().has("cards") ? single(root) : null;
        if (decks == null) throw new IllegalArgumentException("Not a Central library");
        JsonArray imported = new JsonArray(), failed = new JsonArray();
        for (JsonElement e : decks) {
            JsonObject d = e.isJsonObject() ? e.getAsJsonObject() : new JsonObject();
            String from = text(d, "name").trim();
            try {
                StringBuilder list = new StringBuilder();
                section(list, "Commander", d, "commanders");
                section(list, "Deck", d, "cards");
                section(list, "Sideboard", d, "sideboard");
                section(list, "Maybeboard", d, "maybeboard");
                String name = freeName(from.isEmpty() ? "Central" : from.replaceAll("[\\\\/:*?\"<>|]", "-"));
                String problem = save(list.toString(), name, null);
                if (problem != null) throw new IllegalArgumentException(problem);
                List<String> tags = new ArrayList<>();
                if (d.has("tags") && d.get("tags").isJsonArray()) for (JsonElement t : d.getAsJsonArray("tags")) {
                    String tag = t.isJsonPrimitive() ? t.getAsString().replace(",", " ").trim() : "";
                    if (!tag.isEmpty() && tag.length() <= 40 && !tag.toLowerCase(Locale.ROOT).startsWith("reforge-") && tags.size() < 20) tags.add(tag);
                }
                int bracket = d.has("bracketIntent") && d.get("bracketIntent").isJsonPrimitive() ? d.get("bracketIntent").getAsInt() : 0;
                int calculated = d.has("calculatedBracket") && d.get("calculatedBracket").isJsonPrimitive() ? d.get("calculatedBracket").getAsInt() : 0;
                String notes = text(d, "notes");
                setMeta(name, tags, notes.length() > 4000 ? notes.substring(0, 4000) : notes,
                        bracket >= 1 && bracket <= 5 ? bracket : 0,
                        calculated >= 1 && calculated <= 5 ? calculated : 0);
                JsonObject done = new JsonObject();
                done.addProperty("from", from);
                done.addProperty("name", name);
                done.addProperty("unknown", preview(list.toString(), name).json().get("unknown").getAsInt());
                imported.add(done);
            } catch (RuntimeException ex) {
                JsonObject fail = new JsonObject();
                fail.addProperty("name", from);
                fail.addProperty("reason", String.valueOf(ex.getMessage()));
                failed.add(fail);
            }
        }
        JsonObject o = new JsonObject();
        o.add("imported", imported);
        o.add("failed", failed);
        return o;
    }

    private static JsonArray single(JsonElement deck) {
        JsonArray a = new JsonArray();
        a.add(deck);
        return a;
    }

    private static String text(JsonObject o, String key) {
        JsonElement e = o.get(key);
        return e == null || !e.isJsonPrimitive() ? "" : e.getAsString();
    }

    private static void section(StringBuilder list, String title, JsonObject deck, String key) {
        if (!deck.has(key) || !deck.get(key).isJsonArray() || deck.getAsJsonArray(key).isEmpty()) return;
        if (list.length() > 0) list.append('\n');
        list.append(title).append('\n');
        for (JsonElement c : deck.getAsJsonArray(key)) {
            JsonObject card = c.getAsJsonObject();
            String name = text(card, "name").replaceAll("[\\r\\n]", " ").trim();
            int qty = card.has("quantity") && card.get("quantity").isJsonPrimitive() ? Math.max(1, card.get("quantity").getAsInt()) : 1;
            if (!name.isEmpty()) list.append(qty).append(' ').append(name).append('\n');
        }
    }

    /** The name itself, or "name (Central)", "name (Central 2)"… when a deck already has it. */
    private static String freeName(String name) {
        if (!mine().contains(name)) return name;
        for (int i = 1; ; i++) {
            String candidate = name + (i == 1 ? " (Central)" : " (Central " + i + ")");
            if (!mine().contains(candidate)) return candidate;
        }
    }

    private static String invalidName(String name) {
        if (name == null || name.isBlank()) return "A deck needs a name";
        if (name.matches(".*[\\\\/:*?\"<>|].*")) return "The name can't contain \\ / : * ? \" < > |";
        return null;
    }

    /**
     * One of the player's decks as a decklist ("Commander" / "Deck" / "Sideboard" / "Maybeboard" sections, with set
     * and number so the exact printings survive an edit) plus the same grouped preview the import screen shows.
     */
    static JsonObject detail(String name) {
        return detail(mine().get(name), name);
    }

    /** {@link #detail(String)} for any deck, such as a precon (no tags or notes of the player's then). */
    static JsonObject detail(Deck deck, String name) {
        if (deck == null) return null;
        StringBuilder text = new StringBuilder();
        for (DeckSection section : List.of(DeckSection.Commander, DeckSection.Main, DeckSection.Sideboard)) {
            if (!deck.has(section) || deck.get(section).isEmpty()) continue;
            if (text.length() > 0) text.append('\n');
            text.append(section == DeckSection.Main ? "Deck" : section.name()).append('\n');
            for (var entry : deck.get(section)) {
                PaperCard card = entry.getKey();
                text.append(entry.getValue()).append(' ').append(card.getName())
                        .append(" (").append(card.getEdition()).append(") ").append(card.getCollectorNumber()).append('\n');
            }
        }
        List<String> maybe = storedMaybeboard(deck);
        if (!maybe.isEmpty()) {
            if (text.length() > 0) text.append('\n');
            text.append("Maybeboard\n");
            for (String line : maybe) text.append(line).append('\n');
        }
        JsonObject o = preview(text.toString(), name).json();
        o.addProperty("type", "deckDetail");
        o.addProperty("name", name);
        o.addProperty("text", text.toString());
        JsonArray tags = new JsonArray();
        int bracket = 0, calculated = 0;
        for (String tag : deck.getTags()) {
            if (tag.matches(BRACKET_TAG + "[1-5]")) bracket = tag.charAt(tag.length() - 1) - '0';
            else if (tag.matches(CALC_BRACKET_TAG + "[1-5]")) calculated = tag.charAt(tag.length() - 1) - '0';
            else if (!tag.startsWith("reforge-")) tags.add(tag);
        }
        o.add("tags", tags);
        o.addProperty("bracketIntent", bracket);
        o.addProperty("calculatedBracket", calculated);
        o.addProperty("notes", unescapeNotes(deck.getComment()));
        return o;
    }

    private static String unescapeNotes(String comment) {
        if (comment == null) return "";
        StringBuilder out = new StringBuilder();
        for (int i = 0; i < comment.length(); i++) {
            char ch = comment.charAt(i);
            if (ch == '\\' && i + 1 < comment.length()) {
                char next = comment.charAt(++i);
                out.append(next == 'n' ? '\n' : next);
            } else out.append(ch);
        }
        return out.toString();
    }

    /** Returns an error message or null. */
    static String rename(String from, String to) {
        String invalid = invalidName(to);
        if (invalid != null) return invalid;
        Deck deck = mine().get(from);
        if (deck == null) return "Unknown deck: " + from;
        String target = to.trim();
        if (target.equals(from)) return null;
        if (mine().contains(target)) return "A deck with that name already exists";
        List<String> maybe = storedMaybeboard(deck);
        Deck copy = (Deck) deck.copyTo(target);
        mine().add(copy);
        writeMaybeboard(copy, maybe);
        mine().delete(from);
        return null;
    }

    static void delete(String name) {
        if (mine().contains(name)) mine().delete(name);
    }

    static IStorage<Deck> mine() {
        return FModel.getDecks().getCommander();
    }

    /** A printing kept in the maybeboard, which Forge's deck file would otherwise discard. */
    record StoredPrinting(String name, String set, String number) {}

    private static final Pattern STORED_LINE = Pattern.compile("^\\d+\\s+(.+?)(?:\\s+\\(([^)]+)\\)\\s*(\\S+)?)?\\s*$");

    static List<StoredPrinting> maybeboardPrintings(Deck deck) {
        List<StoredPrinting> out = new ArrayList<>();
        for (String line : storedMaybeboard(deck)) {
            Matcher m = STORED_LINE.matcher(line.trim());
            if (!m.matches()) continue;
            out.add(new StoredPrinting(m.group(1), m.group(2) == null ? "" : m.group(2), m.group(3) == null ? "" : m.group(3)));
        }
        return out;
    }

    /** Maybeboard lines of this exact deck file. Empty for precons and for decks that have none. */
    private static List<String> storedMaybeboard(Deck deck) {
        if (deck == null || mine().get(deck.getName()) != deck) return List.of();
        File file = deckFile(deck);
        if (!file.isFile()) return List.of();
        Map<String, List<String>> sections = FileSection.parseSections(FileUtil.readFile(file));
        for (Map.Entry<String, List<String>> e : sections.entrySet()) {
            if (e.getKey().equalsIgnoreCase("Maybeboard")) return e.getValue();
        }
        return List.of();
    }

    /** Puts the maybeboard back onto the file Forge just wrote, or removes it when the list no longer has one. */
    private static void writeMaybeboard(Deck deck, List<String> lines) {
        File file = deckFile(deck);
        if (!file.isFile()) return;
        List<String> existing = new ArrayList<>(FileUtil.readFile(file));
        for (int i = 0; i < existing.size(); i++) {
            if (!existing.get(i).trim().equalsIgnoreCase("[Maybeboard]")) continue;
            int end = existing.size();
            for (int j = i + 1; j < existing.size(); j++) {
                String t = existing.get(j).trim();
                if (t.startsWith("[") && t.endsWith("]")) { end = j; break; }
            }
            existing.subList(i, end).clear();
            break;
        }
        while (!existing.isEmpty() && existing.get(existing.size() - 1).isBlank()) existing.remove(existing.size() - 1);
        List<String> cards = new ArrayList<>();
        for (String line : lines) if (line != null && !line.isBlank()) cards.add(line.trim());
        if (!cards.isEmpty()) {
            if (!existing.isEmpty()) existing.add("");
            existing.add("[Maybeboard]");
            existing.addAll(cards);
        }
        FileUtil.writeFile(file, existing);
    }

    private static File deckFile(Deck deck) {
        return new File(ForgeConstants.DECK_COMMANDER_DIR, deck.getBestFileName() + DeckStorage.FILE_EXTENSION);
    }

    static String group(PaperCard card) {
        var type = card.getRules().getType();
        if (type.isLand()) return "land";
        if (type.isCreature()) return "creature";
        if (type.isPlaneswalker()) return "planeswalker";
        if (type.isInstant()) return "instant";
        if (type.isSorcery()) return "sorcery";
        if (type.isArtifact()) return "artifact";
        if (type.isEnchantment()) return "enchantment";
        if (type.isBattle()) return "battle";
        return "other";
    }

    private static String status(TokenType type) {
        return switch (type) {
            case LEGAL_CARD, FREE_CARD_NOT_IN_INVENTORY, CARD_NOT_IN_INVENTORY -> "ok";
            case LIMITED_CARD, CARD_FROM_NOT_ALLOWED_SET, CARD_FROM_INVALID_SET, WARNING_MESSAGE, UNSUPPORTED_DECK_SECTION -> "warning";
            case UNKNOWN_CARD, UNSUPPORTED_CARD -> "error";
            default -> null;
        };
    }

    private static final List<DeckSection> SECTIONS = List.of(DeckSection.Main, DeckSection.Commander, DeckSection.Sideboard);

    private static DeckImportController controller() {
        // The controller was written for the desktop editor; its date filter widgets stay unused here.
        DeckImportController c = new DeckImportController(new Unchecked(), new NoCombo<>(), new NoCombo<>(), false);
        c.setGameFormat(GameType.Commander);
        c.setAllowedSections(new ArrayList<>(SECTIONS));
        return c;
    }

    private static final class Unchecked implements ICheckBox {
        @Override public boolean isSelected() { return false; }
        @Override public void setSelected(boolean b0) { }
        @Override public boolean isEnabled() { return false; }
        @Override public void setEnabled(boolean b0) { }
        @Override public boolean isVisible() { return false; }
        @Override public void setVisible(boolean b0) { }
        @Override public String getToolTipText() { return null; }
        @Override public void setToolTipText(String s0) { }
    }

    private static final class NoCombo<E> implements IComboBox<E> {
        @Override public void setSelectedItem(E item) { }
        @Override public void setSelectedIndex(int index) { }
        @Override public void addItem(E item) { }
        @Override public void removeAllItems() { }
        @Override public int getSelectedIndex() { return -1; }
        @Override public E getSelectedItem() { return null; }
        @Override public boolean isEnabled() { return false; }
        @Override public void setEnabled(boolean b0) { }
        @Override public boolean isVisible() { return false; }
        @Override public void setVisible(boolean b0) { }
        @Override public String getToolTipText() { return null; }
        @Override public void setToolTipText(String s0) { }
    }
}
