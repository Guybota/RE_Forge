package reforge.engine;

import java.util.ArrayList;
import java.util.List;

import com.google.gson.JsonArray;
import com.google.gson.JsonObject;

import forge.deck.Deck;
import forge.deck.DeckFormat;
import forge.deck.DeckImportController;
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
        DeckImportController controller = controller();
        List<Token> tokens = controller.parseInput(text == null ? "" : text);

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

    private static DeckImportController controller() {
        // The controller was written for the desktop editor; its date filter widgets stay unused here.
        DeckImportController c = new DeckImportController(new Unchecked(), new NoCombo<>(), new NoCombo<>(), false);
        c.setGameFormat(GameType.Commander);
        c.setAllowedSections(new ArrayList<>(List.of(DeckSection.Main, DeckSection.Commander, DeckSection.Sideboard)));
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
