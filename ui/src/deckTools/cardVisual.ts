import type { CatalogCard, DeckPreview } from '../engine';
import type { ColorIdentity, Deck, DeckCard } from './types.ts';

/** The card fields the deck tools read (Central's Scryfall shape), filled from Forge's catalog. */
export type CardVisual = {
  name: string;
  manaCost?: string;
  typeLine?: string;
  oracleText?: string;
  setCode?: string;
  cmc?: number | null;
  colorIdentity?: string[];
  /** legal | banned, as Scryfall's `legalities.commander`. */
  commanderLegality?: string | null;
  /** Cardmarket EUR; filled by the engine's price service (later phase). */
  eur?: number | null;
  failed?: boolean;
};

const LETTERS: ColorIdentity[] = ['W', 'U', 'B', 'R', 'G'];

export function identityLetters(bits: number): ColorIdentity[] {
  return LETTERS.filter((_, i) => bits & (1 << i));
}

export function visualFromCatalog(card: CatalogCard): CardVisual {
  // Forge writes "2 W W" or "{2}{W}{W}"; the tools parse Scryfall's braced form.
  const cost = card.cost && card.cost !== 'no cost'
    ? (/\{/.test(card.cost) ? card.cost : card.cost.split(/\s+/).filter(Boolean).map((s) => `{${s}}`).join(''))
    : '';
  return {
    name: card.nameEn,
    manaCost: cost,
    typeLine: card.typeEn,
    oracleText: card.textEn,
    setCode: card.set,
    cmc: card.cmc,
    colorIdentity: identityLetters(card.identity),
    commanderLegality: card.commanderLegal ? 'legal' : 'banned',
  };
}

type Line = DeckPreview['lines'][number];

/** A Forge deck (its `deckDetail`/`deckPreview` lines) as the tools' Deck plus a lookup of its cards by English name. */
export function deckFromLines(name: string, lines: Line[], identity?: number): { deck: Deck; visuals: Map<string, CardVisual> } {
  const commanders: DeckCard[] = [];
  const cards: DeckCard[] = [];
  const sideboard: DeckCard[] = [];
  const visuals = new Map<string, CardVisual>();
  for (const line of lines) {
    if (!line.nameEn || line.status === 'error') continue;
    const card = line as Line & CatalogCard;
    visuals.set(card.nameEn, visualFromCatalog(card));
    const entry: DeckCard = { name: card.nameEn, quantity: line.qty ?? 1, setCode: card.set };
    if (line.maybeboard) continue;
    if (line.group === 'commander') commanders.push({ ...entry, zone: 'command' });
    else if (line.sideboard) sideboard.push({ ...entry, zone: 'sideboard' });
    else cards.push({ ...entry, zone: 'main' });
  }
  const bits = identity ?? commanders.reduce((all, c) => all | (lines.find((l) => l.nameEn === c.name)?.identity ?? 0), 0);
  const now = new Date(0).toISOString();
  return {
    deck: {
      id: name, name, commanders, cards, sideboard, format: 'commander',
      colorIdentity: identityLetters(bits), createdAt: now, updatedAt: now,
    },
    visuals,
  };
}
