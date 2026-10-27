import type { Deck, Suggestion } from "./types";
import { canonicalizeName, mergeQuantities } from "./parse-decklist";

/**
 * Diff a user deck against a pasted reference list (average deck / staples).
 * This is the primary Improve path. It is a name diff, not live community data.
 */
export function suggestionsFromReference(
  deck: Deck,
  referenceCards: { name: string; quantity: number }[],
): Suggestion[] {
  const deckSet = new Set(
    [...deck.commanders, ...deck.cards].map((c) => canonicalizeName(c.name)),
  );
  const ref = mergeQuantities(referenceCards);
  const refSet = new Set(ref.map((c) => canonicalizeName(c.name)));

  const adds: Suggestion[] = [];
  for (const card of ref) {
    const key = canonicalizeName(card.name);
    if (deckSet.has(key)) continue;
    // Skip obvious basics spam from reference unless deck has none — still suggest once
    adds.push({
      id: `ref-add-${key}`,
      type: "add",
      add: { name: card.name, quantity: 1 },
      reason: "In your pasted reference list but missing from this deck.",
      signals: ["high-inclusion"],
    });
  }

  const cuts: Suggestion[] = [];
  for (const card of deck.cards) {
    const key = canonicalizeName(card.name);
    if (refSet.has(key)) continue;
    // Don't suggest cutting every unique card — only a short list of non-land-looking names
    // Lands often differ; skip type-unknown cuts that look like basics
    if (/^(plains|island|swamp|mountain|forest|wastes|snow-covered)/i.test(card.name)) {
      continue;
    }
    cuts.push({
      id: `ref-cut-${key}`,
      type: "cut",
      cut: { name: card.name, quantity: 1 },
      reason: "In your deck but not in the pasted reference. A candidate cut if you want to align with that list.",
      signals: ["budget"],
    });
  }

  // Pair first N cuts with first N adds as swaps when both exist
  const swaps: Suggestion[] = [];
  const n = Math.min(adds.length, cuts.length, 8);
  for (let i = 0; i < n; i++) {
    const cut = cuts[i];
    const add = adds[i];
    swaps.push({
      id: `ref-swap-${i}`,
      type: "swap",
      cut: cut.cut,
      add: add.add,
      reason: "Swap toward your reference list: cut a card the reference does not play, add one it does.",
      signals: ["high-inclusion", "staple"],
    });
  }

  const leftoverAdds = adds.slice(n, n + 6);
  const leftoverCuts = cuts.slice(n, n + 4);

  return [...swaps, ...leftoverAdds, ...leftoverCuts];
}

export function suggestionCuts(suggestion: Suggestion): { name: string; quantity: number }[] {
  if (suggestion.cuts?.length) return suggestion.cuts;
  return suggestion.cut ? [suggestion.cut] : [];
}

export function suggestionAdds(suggestion: Suggestion): { name: string; quantity: number }[] {
  if (suggestion.adds?.length) return suggestion.adds;
  return suggestion.add ? [suggestion.add] : [];
}

/** Cards the idea depends on that are already in the deck. Applying the idea leaves them alone. */
export function suggestionKeeps(suggestion: Suggestion): { name: string; quantity: number }[] {
  return suggestion.keeps ?? [];
}

export function applySuggestionToDeck(deck: Deck, suggestion: Suggestion): Deck {
  let cards = deck.cards.map((c) => ({ ...c }));
  const commanders = deck.commanders.map((c) => ({ ...c }));

  for (const cut of suggestionCuts(suggestion)) {
    const key = canonicalizeName(cut.name);
    const qty = cut.quantity || 1;
    cards = cards
      .map((c) => {
        if (canonicalizeName(c.name) !== key) return c;
        return { ...c, quantity: c.quantity - qty };
      })
      .filter((c) => c.quantity > 0);
  }

  for (const add of suggestionAdds(suggestion)) {
    const key = canonicalizeName(add.name);
    const qty = add.quantity || 1;
    const existing = cards.find((c) => canonicalizeName(c.name) === key);
    if (existing) {
      existing.quantity += qty;
    } else {
      const isCmd = commanders.some((c) => canonicalizeName(c.name) === key);
      if (!isCmd) {
        cards.push({ name: add.name, quantity: qty });
      }
    }
  }

  cards.sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: "base" }));

  return {
    ...deck,
    cards,
    updatedAt: new Date().toISOString(),
  };
}

/** Apply checklist items in order. Each step copies the list, so the source deck is left as it was. */
export function applySuggestionsToDeck(deck: Deck, suggestions: Suggestion[]): Deck {
  return suggestions.reduce(
    (current, suggestion) => applySuggestionToDeck(current, suggestion),
    deck,
  );
}
