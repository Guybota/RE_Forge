import type { Deck, ImproveResult, ImproveUnsupported, Suggestion } from "./types";
import { canonicalizeName } from "./parse-decklist";
import { deckCardCount } from "./compare";

const DISCLAIMER =
  "Angel demo pack only. These cut/add pairings are hand-written examples for Giada and Bruna, not live community data. Cardmarket EUR comes from Scryfall prices.eur (missing prices stay empty).";

function hasCommander(deck: Deck, names: string[]): boolean {
  const set = new Set(names.map(canonicalizeName));
  return deck.commanders.some((c) => set.has(canonicalizeName(c.name)));
}

function listHas(deck: Deck, name: string): boolean {
  const key = canonicalizeName(name);
  return (
    deck.cards.some((c) => canonicalizeName(c.name) === key) ||
    deck.commanders.some((c) => canonicalizeName(c.name) === key)
  );
}

function filterRelevant(suggestions: Suggestion[], deck: Deck): Suggestion[] {
  return suggestions.filter((s) => {
    if (s.cut && !listHas(deck, s.cut.name)) return false;
    if (s.add && listHas(deck, s.add.name)) return false;
    return true;
  });
}

const GIADA_PRICE_SWAPS: Suggestion[] = [
  {
    id: "giada-price-1",
    type: "swap",
    cut: { name: "Nykthos, Shrine to Nyx", quantity: 1 },
    add: { name: "Castle Ardenvale", quantity: 1 },
    cutPriceEur: 28.5,
    addPriceEur: 2.1,
    priceDeltaEur: -26.4,
    reason:
      "Same land-slot utility at a fraction of Cardmarket EUR - keeps white mana density for Angel tribal.",
    signals: ["budget", "staple"],
  },
  {
    id: "giada-price-2",
    type: "swap",
    cut: { name: "Smothering Tithe", quantity: 1 },
    add: { name: "Mentor of the Meek", quantity: 1 },
    cutPriceEur: 22.0,
    addPriceEur: 0.45,
    priceDeltaEur: -21.55,
    reason:
      "Tithe is a staple rock-tax, but Mentor keeps draw on creature ETBs at Bracket 2 budget.",
    signals: ["budget", "lower-salt"],
  },
];

const GIADA_REPLACEMENTS: Suggestion[] = [
  {
    id: "giada-rep-1",
    type: "swap",
    cut: { name: "Serra Angel", quantity: 1 },
    add: { name: "Angel of Destiny", quantity: 1 },
    cutPriceEur: 0.15,
    addPriceEur: 4.8,
    priceDeltaEur: 4.65,
    reason:
      "High synergy with life-gain Angels under Giada; Serra Angel has low modern inclusion.",
    signals: ["high-synergy", "high-inclusion"],
  },
  {
    id: "giada-rep-2",
    type: "swap",
    cut: { name: "Angelic Page", quantity: 1 },
    add: { name: "Esper Sentinel", quantity: 1 },
    cutPriceEur: 0.1,
    addPriceEur: 18.0,
    priceDeltaEur: 17.9,
    reason:
      "Color staple for card advantage - high inclusion across white commanders, not Giada-specific synergy.",
    signals: ["staple", "high-inclusion"],
  },
  {
    id: "giada-rep-3",
    type: "add",
    add: { name: "Archangel of Thune", quantity: 1 },
    addPriceEur: 32.0,
    reason:
      "Missing popular Angel finisher vs average Giada decks - high inclusion and strong tribal synergy.",
    signals: ["high-inclusion", "high-synergy"],
  },
];

const GIADA_BRACKET: Suggestion[] = [
  {
    id: "giada-br-1",
    type: "bracket-note",
    reason:
      "Deck reads Bracket 2 (Core / precon-like): 0 Game Changers detected in fixture scan. Aim higher (Bracket 3) by adding efficient interaction and at most 3 Game Changers - e.g. Teferi's Protection - or stay casual by keeping theme-first Angels.",
    signals: ["bracket-up"],
  },
  {
    id: "giada-br-2",
    type: "add",
    add: { name: "Teferi's Protection", quantity: 1 },
    addPriceEur: 35.0,
    reason:
      "Game Changer - raises intended experience toward Bracket 3 (Upgraded, ≤3 GCs). Warn the table.",
    signals: ["game-changer", "bracket-up"],
  },
];

const GIADA_STAPLES: Suggestion[] = [
  {
    id: "giada-st-1",
    type: "add",
    add: { name: "Land Tax", quantity: 1 },
    addPriceEur: 19.5,
    reason: "White mana staple - average Giada lists run denser land-fix than this precon shell.",
    signals: ["staple", "high-inclusion"],
  },
  {
    id: "giada-st-2",
    type: "add",
    add: { name: "Mother of Runes", quantity: 1 },
    addPriceEur: 4.2,
    reason: "Cheap protection staple for wide Angel boards; high inclusion, lower salt than stax pieces.",
    signals: ["staple", "lower-salt"],
  },
];

const BRUNA_PRICE_SWAPS: Suggestion[] = [
  {
    id: "bruna-price-1",
    type: "swap",
    cut: { name: "Portal to Phyrexia", quantity: 1 },
    add: { name: "Sun Titan", quantity: 1 },
    cutPriceEur: 24.0,
    addPriceEur: 1.8,
    priceDeltaEur: -22.2,
    reason:
      "Cheaper reanimation-adjacent value engine - similar board pressure without the GC-adjacent price tag.",
    signals: ["budget", "high-synergy"],
  },
  {
    id: "bruna-price-2",
    type: "swap",
    cut: { name: "The Immortal Sun", quantity: 1 },
    add: { name: "Herald's Horn", quantity: 1 },
    cutPriceEur: 9.5,
    addPriceEur: 3.2,
    priceDeltaEur: -6.3,
    reason: "Horn is the tribal cost-reducer staple; Immortal Sun is flexible but pricier and saltier.",
    signals: ["budget", "staple", "lower-salt"],
  },
];

const BRUNA_REPLACEMENTS: Suggestion[] = [
  {
    id: "bruna-rep-1",
    type: "swap",
    cut: { name: "Champion of the Parish", quantity: 1 },
    add: { name: "Adeline, Resplendent Cathar", quantity: 1 },
    cutPriceEur: 0.8,
    addPriceEur: 6.5,
    priceDeltaEur: 5.7,
    reason:
      "Higher synergy go-wide payoff with Angel tokens / wide boards than Parish in Bruna shells.",
    signals: ["high-synergy", "high-inclusion"],
  },
  {
    id: "bruna-rep-2",
    type: "add",
    add: { name: "Angel of Serenity", quantity: 1 },
    addPriceEur: 1.2,
    reason: "High-synergy exile Angel often missing vs average Bruna / Angel meld lists.",
    signals: ["high-synergy"],
  },
  {
    id: "bruna-rep-3",
    type: "cut",
    cut: { name: "Basalt Monolith", quantity: 1 },
    cutPriceEur: 2.5,
    reason:
      "Mana rock with combo vibes - if you want lower salt / Bracket 3 intent, prefer Pearl Medallion density.",
    signals: ["lower-salt", "bracket-down"],
  },
];

const BRUNA_BRACKET: Suggestion[] = [
  {
    id: "bruna-br-1",
    type: "bracket-note",
    reason:
      "Fixture scan: ~1–2 Game Changer-adjacent pieces and strong tutors → lands near Bracket 3 (Upgraded). Brackets describe intended experience, not an auto power score. Aim lower: cut Tutors + Teferi's Protection. Aim higher: add more GCs / faster closers toward Bracket 4.",
    signals: ["bracket-up", "bracket-down"],
  },
  {
    id: "bruna-br-2",
    type: "cut",
    cut: { name: "Drannith Magistrate", quantity: 1 },
    cutPriceEur: 12.0,
    reason:
      "High salt denial piece - cutting it softens social pressure if you want to stay Bracket 3 casual-upgraded.",
    signals: ["lower-salt", "bracket-down"],
  },
];

const BRUNA_STAPLES: Suggestion[] = [
  {
    id: "bruna-st-1",
    type: "add",
    add: { name: "Deep Gnome Terramancer", quantity: 1 },
    addPriceEur: 2.8,
    reason: "White ramp staple filling average-deck land-search density.",
    signals: ["staple"],
  },
];

function giadaResult(deck: Deck): ImproveResult {
  return {
    supported: true,
    snapshot: {
      commanderName: deck.commanders[0]?.name ?? "Giada, Font of Hope",
      colorIdentity: deck.colorIdentity ?? ["W"],
      estimatedPriceEur: 0,
      estimatedBracket: deck.bracketIntent ?? 2,
      gameChangerCount: 0,
      saltSum: 12,
      cardCount: deckCardCount(deck),
    },
    priceSwaps: filterRelevant(GIADA_PRICE_SWAPS, deck),
    replacements: filterRelevant(GIADA_REPLACEMENTS, deck),
    bracketNotes: GIADA_BRACKET,
    missingStaples: filterRelevant(GIADA_STAPLES, deck),
    disclaimer: DISCLAIMER,
  };
}

function brunaResult(deck: Deck): ImproveResult {
  return {
    supported: true,
    snapshot: {
      commanderName: deck.commanders[0]?.name ?? "Bruna, the Fading Light",
      colorIdentity: deck.colorIdentity ?? ["W"],
      estimatedPriceEur: 0,
      estimatedBracket: deck.bracketIntent ?? 3,
      gameChangerCount: 2,
      saltSum: 28,
      cardCount: deckCardCount(deck),
    },
    priceSwaps: filterRelevant(BRUNA_PRICE_SWAPS, deck),
    replacements: filterRelevant(BRUNA_REPLACEMENTS, deck),
    bracketNotes: BRUNA_BRACKET,
    missingStaples: filterRelevant(BRUNA_STAPLES, deck),
    disclaimer: DISCLAIMER,
  };
}

export function evaluateDeck(deck: Deck): ImproveResult | ImproveUnsupported {
  if (!deck.commanders.length) {
    return {
      supported: false,
      commanderName: "",
      message: "Set a commander on this deck before evaluating.",
    };
  }

  if (hasCommander(deck, ["Giada, Font of Hope"])) {
    return giadaResult(deck);
  }
  if (hasCommander(deck, ["Bruna, the Fading Light"])) {
    return brunaResult(deck);
  }

  const name = deck.commanders.map((c) => c.name).join(" / ");
  return {
    supported: false,
    commanderName: name,
    message: `No Angel demo pack for ${name}. Paste a reference list to diff cuts and adds.`,
  };
}

export const BRACKET_LABELS: Record<number, string> = {
  1: "Exhibition",
  2: "Core",
  3: "Upgraded",
  4: "Optimized",
  5: "cEDH",
};

export const SIGNAL_LABELS: Record<string, string> = {
  "high-synergy": "High synergy",
  "high-inclusion": "High inclusion",
  staple: "Staple",
  budget: "Budget",
  "lower-salt": "Lower salt",
  "game-changer": "Game Changer",
  "bracket-up": "Aim higher",
  "bracket-down": "Aim lower",
  infinite: "Infinite",
  "infinite-resource": "Infinite - Resource dependent",
};

/** All fixture suggestion card names - prefetch for Improve art. */
export const FIXTURE_ART_NAMES: string[] = Array.from(
  new Set(
    [
      ...GIADA_PRICE_SWAPS,
      ...GIADA_REPLACEMENTS,
      ...GIADA_BRACKET,
      ...GIADA_STAPLES,
      ...BRUNA_PRICE_SWAPS,
      ...BRUNA_REPLACEMENTS,
      ...BRUNA_BRACKET,
      ...BRUNA_STAPLES,
    ].flatMap((s) => [s.cut?.name, s.add?.name].filter(Boolean) as string[]),
  ),
);

