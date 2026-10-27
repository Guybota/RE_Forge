package reforge.engine;

import java.util.ArrayList;
import java.util.Collection;
import java.util.HashSet;
import java.util.List;
import java.util.Set;

import com.google.gson.JsonArray;
import com.google.gson.JsonObject;

import forge.deck.Deck;
import forge.deck.DeckFormat;
import forge.deck.DeckImportController;
import forge.deck.DeckRecognizer;
import forge.deck.DeckRecognizer.Token;
import forge.deck.DeckRecognizer.TokenType;
import forge.deck.DeckSection;
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
        DeckImportController controller = controller();
        List<Token> tokens = controller.parseInput(text);
        List<String> found = impliedCommanders(text, tokens);
        if (found != null) tokens = controller.parseInput(text = withCommanders(text, found));

        JsonArray lines = new JsonArray();
        int unknown = 0;
        for (Token t : tokens) {
            String status = status(t.getType());
            if (status == null) continue; // comments, section headers and other non-card text
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
                if (t.getTokenSection() == DeckSection.Commander) l.addProperty("group", "commander");
            }
            lines.add(l);
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
    static Deck forPlay(String text, String name) {
        if (text == null || text.isBlank() || text.length() > 1_000_000) throw new IllegalArgumentException("Invalid external decklist");
        Preview p = preview(text, name);
        if (p.json().get("unknown").getAsInt() != 0) throw new IllegalArgumentException("Some cards were not recognised");
        if (p.deck() == null || p.deck().getMain().isEmpty()) throw new IllegalArgumentException("No cards recognised");
        if (!p.deck().has(DeckSection.Commander) || p.deck().get(DeckSection.Commander).isEmpty()) {
            throw new IllegalArgumentException("No commander recognised");
        }
        return p.deck();
    }

    /** Saves under the given name (replacing a deck of the same name). Returns an error message or null. */
    static String save(String text, String name) {
        String invalid = invalidName(name);
        if (invalid != null) return invalid;
        Preview p = preview(text, name);
        if (p.deck() == null || p.deck().getMain().isEmpty()) return "No cards recognised";
        mine().add(p.deck());
        return null;
    }

    private static String invalidName(String name) {
        if (name == null || name.isBlank()) return "A deck needs a name";
        if (name.matches(".*[\\\\/:*?\"<>|].*")) return "The name can't contain \\ / : * ? \" < > |";
        return null;
    }

    /**
     * One of the player's decks as a decklist ("Commander" / "Deck" / "Sideboard" sections, with set and number so
     * the exact printings survive an edit) plus the same grouped preview the import screen shows.
     */
    static JsonObject detail(String name) {
        Deck deck = mine().get(name);
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
        JsonObject o = preview(text.toString(), name).json();
        o.addProperty("type", "deckDetail");
        o.addProperty("name", name);
        o.addProperty("text", text.toString());
        return o;
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
        mine().add((Deck) deck.copyTo(target));
        mine().delete(from);
        return null;
    }

    static void delete(String name) {
        if (mine().contains(name)) mine().delete(name);
    }

    static IStorage<Deck> mine() {
        return FModel.getDecks().getCommander();
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
