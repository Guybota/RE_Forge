export type ColorIdentity = "W" | "U" | "B" | "R" | "G";

export type DeckCard = {
  oracleId?: string;
  /** Preferred Scryfall printing id for art / set. */
  scryfallId?: string;
  setCode?: string;
  name: string;
  quantity: number;
  zone?: "command" | "main" | "sideboard";
};

export type Deck = {
  id: string;
  name: string;
  commanders: DeckCard[];
  cards: DeckCard[];
  /** Optional sideboard (not part of the 99). */
  sideboard?: DeckCard[];
  format: "commander";
  colorIdentity?: ColorIdentity[];
  bracketIntent?: 1 | 2 | 3 | 4 | 5;
  /** Bracket stamped by Calculate bracket. Stays with the deck. */
  calculatedBracket?: 1 | 2 | 3 | 4 | 5;
  notes?: string;
  tags?: string[];
  createdAt: string;
  updatedAt: string;
  source?: "manual" | "paste" | "import" | "seed";
};

export type DeckLibrary = {
  version: 1;
  decks: Deck[];
  lastOpenedDeckId?: string;
};

export type CompareRow =
  | { kind: "shared"; name: string; quantity: number; oracleId?: string }
  | { kind: "onlyA" | "onlyB"; name: string; quantity: number; oracleId?: string }
  | {
      kind: "qtyDiff";
      name: string;
      qtyA: number;
      qtyB: number;
      delta: number;
      oracleId?: string;
    };

export type CompareSummary = {
  sharedCount: number;
  onlyACount: number;
  onlyBCount: number;
  qtyDiffCount: number;
  cardsCut: number;
  cardsAdded: number;
};

export type SignalTag =
  | "high-synergy"
  | "high-inclusion"
  | "staple"
  | "budget"
  | "lower-salt"
  | "game-changer"
  | "bracket-up"
  | "bracket-down"
  | "infinite"
  | "infinite-resource";

export type Suggestion = {
  id: string;
  type: "swap" | "add" | "cut" | "bracket-note";
  cut?: DeckCard;
  add?: DeckCard;
  /** A set moves every card together. Used instead of cut/add when there is more than one. */
  cuts?: DeckCard[];
  adds?: DeckCard[];
  /** Cards this idea uses that are already in the deck. Shown with the idea. Not added or cut. */
  keeps?: DeckCard[];
  /** Name of a set, such as a small synergy or a loop. */
  title?: string;
  reason: string;
  signals: SignalTag[];
  priceDeltaEur?: number;
  cutPriceEur?: number;
  addPriceEur?: number;
};

export type ImproveSnapshot = {
  commanderName: string;
  colorIdentity: ColorIdentity[];
  estimatedPriceEur: number;
  estimatedBracket: 1 | 2 | 3 | 4 | 5;
  gameChangerCount: number;
  saltSum?: number;
  cardCount: number;
};

export type ImproveResult = {
  supported: true;
  snapshot: ImproveSnapshot;
  priceSwaps: Suggestion[];
  replacements: Suggestion[];
  bracketNotes: Suggestion[];
  missingStaples: Suggestion[];
  disclaimer: string;
};

export type ImproveUnsupported = {
  supported: false;
  commanderName: string;
  message: string;
};
