package reforge.engine;

import java.util.*;
import java.util.function.Predicate;
import java.util.regex.*;
import com.google.gson.*;
import forge.card.*;
import forge.item.PaperCard;
import forge.model.FModel;

/** Forge Adventure's RewardData card filters (CardUtil.CardPredicate) and generation, for rewards and shops. */
final class AdventureCards {
    private static List<PaperCard> all;
    private static final Map<String, Pattern> PATTERNS = new HashMap<>();

    private AdventureCards() { }

    private static synchronized List<PaperCard> all() {
        if (all == null) {
            List<PaperCard> cards = new ArrayList<>();
            for (PaperCard card : FModel.getMagicDb().getCommonCards().getUniqueCards())
                if (!card.getName().startsWith("A-") && !card.getRules().isCustom()) cards.add(card);
            all = cards;
        }
        return all;
    }

    /** Cards for one reward definition of type card or Union: count (+ up to addMaxCount), each passing the filters. */
    static List<PaperCard> generate(JsonObject reward, Random random, byte colorIdentity) {
        if (reward.has("probability") && random.nextFloat() >= reward.get("probability").getAsFloat()) return List.of();
        int count = Math.min(100, Math.max(0, CampaignStore.number(reward, "count", 1) + random.nextInt(Math.max(1, CampaignStore.number(reward, "addMaxCount", 0) + 1))));
        Predicate<PaperCard> test;
        if (CampaignStore.text(reward, "type").equals("Union") && reward.has("cardUnion")) {
            List<Predicate<PaperCard>> parts = new ArrayList<>();
            for (JsonElement e : reward.getAsJsonArray("cardUnion")) parts.add(filter(e.getAsJsonObject(), colorIdentity));
            test = card -> parts.stream().anyMatch(p -> p.test(card));
        } else test = filter(reward, colorIdentity);
        List<PaperCard> candidates = new ArrayList<>();
        for (PaperCard card : all()) if (test.test(card)) candidates.add(card);
        List<PaperCard> out = new ArrayList<>();
        for (int i = 0; i < count && !candidates.isEmpty(); i++) out.add(candidates.get(random.nextInt(candidates.size())));
        return out;
    }

    static Predicate<PaperCard> filter(JsonObject r, byte colorIdentity) {
        if (r.has("cardName")) { String name = CampaignStore.text(r, "cardName"); return card -> card.getName().equals(name); }
        Set<CardRarity> rarities = new HashSet<>();
        for (String s : strings(r, "rarity")) rarities.add(CardRarity.smartValueOf(s));
        Set<String> editions = new HashSet<>(strings(r, "editions"));
        Set<String> cardTypes = new HashSet<>(strings(r, "cardTypes")), superTypes = new HashSet<>(strings(r, "superTypes")), subTypes = new HashSet<>(strings(r, "subTypes"));
        Set<Integer> manaCosts = new HashSet<>();
        if (r.has("manaCosts")) for (JsonElement e : r.getAsJsonArray("manaCosts")) manaCosts.add(e.getAsInt());
        Pattern text = pattern(CampaignStore.text(r, "cardText"));
        byte colors = MagicColor.ALL_COLORS;
        List<String> colorNames = strings(r, "colors");
        if (!colorNames.isEmpty()) {
            colors = 0;
            for (String c : colorNames) colors |= c.equals("colorID") ? colorIdentity : MagicColor.fromName(c.toLowerCase(Locale.ROOT));
        }
        boolean allColors = r.has("matchAllColors") && r.get("matchAllColors").getAsBoolean();
        String colorType = CampaignStore.text(r, "colorType");
        byte wanted = colors;
        return card -> {
            CardRules rules = card.getRules();
            ColorSet color = rules.getColor();
            if (!rarities.isEmpty() && !rarities.contains(card.getRarity())) return false;
            if (!editions.isEmpty() && FModel.getMagicDb().getCommonCards().getAllCards(card.getName()).stream().noneMatch(p -> editions.contains(p.getEdition()))) return false;
            if (!manaCosts.isEmpty() && !manaCosts.contains(rules.getManaCost().getCMC())) return false;
            if (text != null && !text.matcher(rules.getOracleText()).find()) return false;
            if (allColors && !color.hasAllColors(wanted)) return false;
            if (wanted != MagicColor.ALL_COLORS && (!color.hasNoColorsExcept(wanted) || wanted != MagicColor.COLORLESS && color.isColorless())) return false;
            if (colorType.equals("Colorless") && !color.isColorless() || colorType.equals("MonoColor") && !color.isMonoColor()
                    || colorType.equals("MultiColor") && !color.isMulticolor()) return false;
            if (!cardTypes.isEmpty() && rules.getType().getCoreTypes().stream().noneMatch(t -> cardTypes.contains(t.name()))) return false;
            if (!superTypes.isEmpty() && rules.getType().getSupertypes().stream().noneMatch(t -> superTypes.contains(t.name()))) return false;
            if (!subTypes.isEmpty()) {
                boolean found = false;
                for (String s : rules.getType().getSubtypes()) found |= subTypes.contains(s);
                if (!found) return false;
            }
            return true;
        };
    }

    /** CardUtil.getCardPrice without Forge's optional price list: by rarity, non-basic "L" lands as commons. */
    static int price(PaperCard card) {
        CardRarity rarity = card.getRarity();
        if (rarity == CardRarity.BasicLand && !card.isVeryBasicLand() && !card.getName().equals("Wastes")) rarity = CardRarity.Common;
        return switch (rarity) {
            case BasicLand -> 5;
            case Common -> 50;
            case Uncommon -> 150;
            case Rare -> 300;
            case MythicRare -> 500;
            default -> 600;
        };
    }

    private static synchronized Pattern pattern(String regex) {
        if (regex.isEmpty()) return null;
        return PATTERNS.computeIfAbsent(regex, r -> {
            try { return Pattern.compile(r, Pattern.CASE_INSENSITIVE); }
            catch (PatternSyntaxException e) { return Pattern.compile(Pattern.quote(r), Pattern.CASE_INSENSITIVE); }
        });
    }
    private static List<String> strings(JsonObject o, String key) {
        List<String> out = new ArrayList<>();
        if (o.has(key) && o.get(key).isJsonArray()) for (JsonElement e : o.getAsJsonArray(key)) if (!e.isJsonNull()) out.add(e.getAsString());
        return out;
    }
}
