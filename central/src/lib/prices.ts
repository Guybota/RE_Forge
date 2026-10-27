import type { Deck } from "./types";
import { getCachedVisual, type CardVisual } from "./scryfall";

export type EurAmount = number | null | undefined;

/** Format a Cardmarket EUR amount; null/undefined → unavailable copy. */
export function formatEur(amount: EurAmount, opts?: { unavailable?: string }): string {
  if (amount == null || Number.isNaN(amount)) {
    return opts?.unavailable ?? "price unavailable";
  }
  return `€${amount.toFixed(2)}`;
}

export function formatEurDelta(delta: number | null | undefined): string | null {
  if (delta == null || Number.isNaN(delta)) return null;
  const sign = delta > 0 ? "+" : "";
  return `Δ €${sign}${delta.toFixed(2)}`;
}

export type DeckPriceSummary = {
  /** Sum of quantity × eur for cards with a known price. */
  totalEur: number | null;
  pricedCards: number;
  unpricedCards: number;
  loading: boolean;
};

/**
 * Sum Cardmarket EUR for a deck. Cards without `eur` are counted as unpriced
 * and excluded from the total (never invent 0).
 */
export function summarizeDeckEur(
  deck: Deck,
  get: (name: string) => CardVisual | undefined,
  loading: boolean,
): DeckPriceSummary {
  const lines = [...deck.commanders, ...deck.cards];
  let total = 0;
  let priced = 0;
  let unpriced = 0;

  for (const line of lines) {
    const visual = get(line.name);
    const eur = visual?.eur;
    if (eur == null) {
      unpriced += line.quantity;
      continue;
    }
    total += eur * line.quantity;
    priced += line.quantity;
  }

  if (loading && priced === 0 && unpriced === lines.reduce((s, c) => s + c.quantity, 0)) {
    return { totalEur: null, pricedCards: 0, unpricedCards: unpriced, loading: true };
  }

  if (priced === 0) {
    return { totalEur: null, pricedCards: 0, unpricedCards: unpriced, loading };
  }

  return { totalEur: total, pricedCards: priced, unpricedCards: unpriced, loading };
}

/**
 * Deck total from the local Scryfall cache only.
 * Returns null until every card has been resolved, so the deck list does not
 * fetch an entire library just to paint a badge.
 */
export function cachedDeckTotalEur(deck: Deck): number | null {
  const lines = [...deck.commanders, ...deck.cards];
  if (!lines.length) return null;
  let total = 0;
  let priced = 0;
  for (const line of lines) {
    const visual = getCachedVisual(line.name);
    if (!visual || visual.eur === undefined) return null;
    if (visual.eur == null) continue;
    total += visual.eur * line.quantity;
    priced += line.quantity;
  }
  if (priced === 0) return null;
  return total;
}
