import type { CatalogCard } from './engine';

export type DeckEntry = CatalogCard & { qty: number; commander: boolean; board?: 'deck' | 'sideboard' | 'maybeboard' };
export const MANA_COLORS = ['W', 'U', 'B', 'R', 'G', 'C'] as const;
export type DeckFilter = { kind: 'cost'; value: number } | { kind: 'color'; value: number } | null;

export function matchesDeckFilter(card: DeckEntry, filter: DeckFilter): boolean {
  if (!filter) return true;
  if (filter.kind === 'cost') return card.group !== 'land' && (filter.value === 7 ? card.cmc >= 7 : card.cmc === filter.value);
  return card.group !== 'land' && (filter.value === 32 ? card.colors === 0 : (card.colors & filter.value) !== 0);
}

/** Quantities count; the command zone is excluded unless explicitly requested. */
export function deckStatistics(entries: DeckEntry[], includeCommanders = false) {
  const cards = entries.filter(c => (c.board ?? 'deck') === 'deck' && (includeCommanders || !c.commander));
  const spells = cards.filter(c => c.group !== 'land');
  const lands = cards.filter(c => c.group === 'land');
  const count = cards.reduce((n, c) => n + c.qty, 0);
  const spellCount = spells.reduce((n, c) => n + c.qty, 0);
  const landCount = count - spellCount;
  const totalMana = spells.reduce((n, c) => n + c.cmc * c.qty, 0);
  const values = spells.flatMap(c => Array.from({ length: c.qty }, () => c.cmc)).sort((a, b) => a - b);
  const median = values.length ? (values[Math.floor((values.length - 1) / 2)] + values[Math.floor(values.length / 2)]) / 2 : 0;
  const identity = entries.filter(c => c.commander).reduce((mask, c) => mask | c.identity, 0);
  const curve = Array.from({ length: 8 }, (_, value) => {
    const bucket = spells.filter(c => matchesDeckFilter(c, { kind: 'cost', value }));
    const permanents = bucket.filter(c => !['instant', 'sorcery'].includes(c.group)).reduce((n, c) => n + c.qty, 0);
    const total = bucket.reduce((n, c) => n + c.qty, 0);
    return { value, permanents, spells: total - permanents, total };
  });
  const symbols = MANA_COLORS.map((_, i) => spells.reduce((n, c) => n + (c.manaSymbols?.[i] ?? 0) * c.qty, 0));
  const symbolCount = symbols.reduce((a, b) => a + b, 0);
  const colors = MANA_COLORS.map((key, i) => ({
    key, bit: 1 << i, symbols: symbols[i],
    cards: spells.filter(c => matchesDeckFilter(c, { kind: 'color', value: 1 << i })).reduce((n, c) => n + c.qty, 0),
    sources: lands.filter(c => ((c.manaProduction | (c.commanderMana ? identity : 0)) & (1 << i)) !== 0).reduce((n, c) => n + c.qty, 0),
  }));
  return { count, spellCount, landCount, totalMana, median, average: spellCount ? totalMana / spellCount : 0,
    averageWithLands: count ? totalMana / count : 0, curve, colors, symbolCount };
}

/** P(X >= minimum) without replacement; summing probabilities avoids factorial overflow. */
export function drawProbability(population: number, successes: number, draws: number, minimum: number): number {
  if (population <= 0 || successes < 0 || successes > population || draws < 0 || draws > population || minimum < 0) return 0;
  const chooseLog = (n: number, k: number) => {
    if (k < 0 || k > n) return -Infinity;
    let result = 0;
    for (let i = 1; i <= Math.min(k, n - k); i++) result += Math.log(n - i + 1) - Math.log(i);
    return result;
  };
  let probability = 0;
  for (let k = Math.max(minimum, draws - (population - successes)); k <= Math.min(draws, successes); k++) {
    probability += Math.exp(chooseLog(successes, k) + chooseLog(population - successes, draws - k) - chooseLog(population, draws));
  }
  return Math.min(1, probability);
}

/** The decklist the engine reads back: commanders, the deck, then sideboard and maybeboard, each with its exact printing. */
export function decklist(entries: DeckEntry[]) {
  const line = (e: DeckEntry) => `${e.qty} ${e.nameEn} (${e.set}) ${e.number}`;
  const board = (e: DeckEntry) => e.board ?? 'deck';
  const commanders = entries.filter((e) => e.commander).map(line);
  const deck = entries.filter((e) => !e.commander && board(e) === 'deck').map(line);
  const sideboard = entries.filter((e) => board(e) === 'sideboard').map(line);
  const maybeboard = entries.filter((e) => board(e) === 'maybeboard').map(line);
  return [
    commanders.length ? `Commander\n${commanders.join('\n')}` : '',
    deck.length ? `Deck\n${deck.join('\n')}` : '',
    sideboard.length ? `Sideboard\n${sideboard.join('\n')}` : '',
    maybeboard.length ? `Maybeboard\n${maybeboard.join('\n')}` : '',
  ].filter(Boolean).join('\n\n');
}

/** Changing one printing keeps other arts and coalesces identical basic-land entries. */
export function replacePrinting<T extends DeckEntry>(entries: T[], target: T, printing: Pick<CatalogCard, 'set' | 'number' | 'imageKey'>): T[] {
  const merged = new Map<string, T>();
  for (const entry of entries) {
    const card = entry.imageKey === target.imageKey && entry.commander === target.commander && (entry.board ?? 'deck') === (target.board ?? 'deck')
      ? { ...entry, set: printing.set, number: printing.number, imageKey: printing.imageKey } : entry;
    const key = `${card.commander}:${card.board ?? 'deck'}:${card.imageKey}`;
    const previous = merged.get(key);
    merged.set(key, previous ? { ...previous, qty: previous.qty + card.qty } : card);
  }
  return [...merged.values()];
}
