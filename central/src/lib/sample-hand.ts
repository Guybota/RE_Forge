import type { Deck } from "./types";

/** Expand the 99 into individual card names (commander stays out). */
export function expandMainboard(deck: Deck): string[] {
  const names: string[] = [];
  for (const c of deck.cards) {
    for (let i = 0; i < c.quantity; i++) names.push(c.name);
  }
  return names;
}

function shuffleInPlace<T>(arr: T[]): T[] {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

/** Draw 7 at random from the 99. Does not mutate the saved deck. */
export function drawSampleHand(deck: Deck, count = 7): string[] {
  const pool = expandMainboard(deck);
  if (pool.length === 0) return [];
  shuffleInPlace(pool);
  return pool.slice(0, Math.min(count, pool.length));
}
