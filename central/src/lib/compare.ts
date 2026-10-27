import type { CompareRow, CompareSummary, Deck, DeckCard } from "./types";
import { canonicalizeName } from "./parse-decklist";

function toMultiset(cards: DeckCard[]): Map<string, { name: string; quantity: number }> {
  const map = new Map<string, { name: string; quantity: number }>();
  for (const card of cards) {
    const key = canonicalizeName(card.name);
    const existing = map.get(key);
    if (existing) {
      existing.quantity += card.quantity;
    } else {
      map.set(key, { name: card.name, quantity: card.quantity });
    }
  }
  return map;
}

function mainboard(deck: Deck): DeckCard[] {
  return deck.cards.filter((c) => (c.zone ?? "main") === "main");
}

export function compareDecks(deckA: Deck, deckB: Deck): {
  rows: CompareRow[];
  summary: CompareSummary;
  commanderRows: CompareRow[];
} {
  const a = toMultiset(mainboard(deckA));
  const b = toMultiset(mainboard(deckB));
  const keys = new Set([...a.keys(), ...b.keys()]);

  const rows: CompareRow[] = [];
  let sharedCount = 0;
  let onlyACount = 0;
  let onlyBCount = 0;
  let qtyDiffCount = 0;
  let cardsCut = 0;
  let cardsAdded = 0;

  for (const key of keys) {
    const left = a.get(key);
    const right = b.get(key);

    if (left && right) {
      if (left.quantity === right.quantity) {
        rows.push({ kind: "shared", name: left.name, quantity: left.quantity });
        sharedCount += 1;
      } else {
        rows.push({
          kind: "qtyDiff",
          name: left.name,
          qtyA: left.quantity,
          qtyB: right.quantity,
          delta: right.quantity - left.quantity,
        });
        qtyDiffCount += 1;
        if (right.quantity < left.quantity) {
          cardsCut += left.quantity - right.quantity;
        } else {
          cardsAdded += right.quantity - left.quantity;
        }
      }
    } else if (left) {
      rows.push({ kind: "onlyA", name: left.name, quantity: left.quantity });
      onlyACount += 1;
      cardsCut += left.quantity;
    } else if (right) {
      rows.push({ kind: "onlyB", name: right.name, quantity: right.quantity });
      onlyBCount += 1;
      cardsAdded += right.quantity;
    }
  }

  const sortRows = (list: CompareRow[]) =>
    list.sort((x, y) => x.name.localeCompare(y.name, undefined, { sensitivity: "base" }));

  sortRows(rows);

  const commanderRows = compareCommanderZone(deckA.commanders, deckB.commanders);

  return {
    rows,
    commanderRows,
    summary: {
      sharedCount,
      onlyACount,
      onlyBCount,
      qtyDiffCount,
      cardsCut,
      cardsAdded,
    },
  };
}

function compareCommanderZone(
  commandersA: DeckCard[],
  commandersB: DeckCard[],
): CompareRow[] {
  const a = toMultiset(commandersA);
  const b = toMultiset(commandersB);
  const keys = new Set([...a.keys(), ...b.keys()]);
  const rows: CompareRow[] = [];

  for (const key of keys) {
    const left = a.get(key);
    const right = b.get(key);
    if (left && right) {
      rows.push({ kind: "shared", name: left.name, quantity: left.quantity });
    } else if (left) {
      rows.push({ kind: "onlyA", name: left.name, quantity: left.quantity });
    } else if (right) {
      rows.push({ kind: "onlyB", name: right.name, quantity: right.quantity });
    }
  }

  return rows.sort((x, y) =>
    x.name.localeCompare(y.name, undefined, { sensitivity: "base" }),
  );
}

export function deckCardCount(deck: Deck): number {
  const main = deck.cards.reduce((sum, c) => sum + c.quantity, 0);
  const cmd = deck.commanders.reduce((sum, c) => sum + c.quantity, 0);
  return main + cmd;
}
