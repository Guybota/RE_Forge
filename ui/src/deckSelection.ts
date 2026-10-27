import type { DeckLists, DeckSummary } from './engine';

export type DeckSourceFilter = 'all' | 'mine' | 'precon' | 'favorites';
const FAVORITES = 'reforge.favoriteDecks';
export const deckKey = (deck: Pick<DeckSummary, 'source' | 'name'>) => JSON.stringify([deck.source, deck.name]);
const normalize = (text: string) => text.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLocaleLowerCase();

/** The native names remain usable with an older engine that doesn't provide summaries. */
export function selectionDecks(lists: DeckLists): DeckSummary[] {
  const summaries = new Map(lists.summaries?.map(deck => [deckKey(deck), deck]));
  return (['mine', 'precon'] as const).flatMap(source => (source === 'mine' ? lists.mine : lists.precons).map(name =>
    summaries.get(deckKey({ source, name })) ?? { source, name }));
}

export function filterSelectionDecks(decks: DeckSummary[], query: string, source: DeckSourceFilter, color: number, favorites: ReadonlySet<string>) {
  const text = normalize(query.trim());
  return decks.filter(deck => (source === 'all' || source === 'favorites' && favorites.has(deckKey(deck)) || deck.source === source)
    && (color < 0 || deck.identity !== undefined && (color === 0 ? deck.identity === 0 : !!(deck.identity & color)))
    && normalize([deck.name, ...(deck.commanders ?? []).flatMap(card => [card.name, card.nameEn])].join(' ')).includes(text));
}

export function loadDeckFavorites(): Set<string> {
  try {
    const value: unknown = JSON.parse(localStorage.getItem(FAVORITES) ?? '[]');
    if (!Array.isArray(value)) return new Set();
    return new Set(value.slice(0, 2000).filter((id): id is string => {
      if (typeof id !== 'string' || id.length > 1024) return false;
      try { const key = JSON.parse(id); return Array.isArray(key) && key.length === 2 && ['mine', 'precon'].includes(key[0]) && typeof key[1] === 'string'; }
      catch { return false; }
    }));
  } catch { return new Set(); }
}

export function saveDeckFavorites(favorites: ReadonlySet<string>) {
  try { localStorage.setItem(FAVORITES, JSON.stringify([...favorites].slice(0, 2000))); } catch { /* Keep the session usable when storage is blocked. */ }
}
