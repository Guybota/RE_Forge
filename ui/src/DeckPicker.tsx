import { useState } from 'react';
import type { CatalogCard, DeckSummary } from './engine';
import { useT, type MessageKey } from './i18n';
import { cardImage } from './images';
import { ManaSymbol } from './ManaSymbol';
import { deckKey, filterSelectionDecks, loadDeckFavorites, saveDeckFavorites, type DeckSourceFilter } from './deckSelection';
import { InspectableCard } from './table/CardInspection';
import { cardForInspection } from './table/useCardInspection';
import { ArtIcon, CheckIcon, SearchIcon, StarIcon } from './table/icons';

const COLORS: { bit: number; symbol: string; label: MessageKey }[] = [
  { bit: 1, symbol: 'W', label: 'colorW' }, { bit: 2, symbol: 'U', label: 'colorU' },
  { bit: 4, symbol: 'B', label: 'colorB' }, { bit: 8, symbol: 'R', label: 'colorR' },
  { bit: 16, symbol: 'G', label: 'colorG' }, { bit: 0, symbol: 'C', label: 'colorC' },
];
const SOURCES: { id: DeckSourceFilter; label: MessageKey }[] = [
  { id: 'all', label: 'allDecks' }, { id: 'mine', label: 'myDecks' },
  { id: 'precon', label: 'precons' }, { id: 'favorites', label: 'favoriteDecks' },
];

export function DeckArtwork({ card, eager = false }: { card?: CatalogCard; eager?: boolean }) {
  const src = cardImage(card?.imageKey, 'crop');
  const [failed, setFailed] = useState<string | null>(null);
  return <span className="deck-artwork" aria-hidden="true">
    {src && failed !== src ? <img src={src} alt="" loading={eager ? 'eager' : 'lazy'} decoding="async" onError={() => setFailed(src)} /> : <ArtIcon />}
  </span>;
}

export function DeckIdentity({ identity }: { identity?: number }) {
  const t = useT();
  if (identity === undefined) return null;
  const colors = COLORS.filter(c => identity === 0 ? c.bit === 0 : c.bit > 0 && !!(identity & c.bit));
  return <span className="deck-identity" aria-label={`${t('colorIdentity')}: ${colors.map(c => t(c.label)).join(', ')}`}>
    {colors.map((c) => <ManaSymbol key={c.bit} symbol={c.symbol} cost className="deck-identity__mana" />)}
  </span>;
}

export function DeckPicker({ decks, selected, onSelect, loading, disabled }: {
  decks: DeckSummary[]; selected: string; onSelect: (id: string) => void; loading: boolean; disabled: boolean;
}) {
  const t = useT();
  const [query, setQuery] = useState('');
  const [source, setSource] = useState<DeckSourceFilter>('all');
  const [color, setColor] = useState(-1);
  const [favorites, setFavorites] = useState(loadDeckFavorites);
  const visible = filterSelectionDecks(decks, query, source, color, favorites);
  const toggleFavorite = (id: string) => {
    const next = new Set(favorites);
    if (next.has(id)) next.delete(id); else next.add(id);
    setFavorites(next); saveDeckFavorites(next);
  };
  return <section className="deck-picker" aria-label={t('chooseDeck')}>
    <div className="deck-picker__filters">
      <label className="deck-picker__search"><SearchIcon /><input type="search" value={query} disabled={disabled}
        aria-label={t('searchDecks')} placeholder={t('searchDecks')} onChange={e => setQuery(e.target.value)} /></label>
      <div className="deck-picker__sources" role="group" aria-label={t('deckSource')}>
        {SOURCES.map(s => <button key={s.id} type="button" disabled={disabled} aria-pressed={source === s.id} onClick={() => setSource(s.id)}>{t(s.label)}</button>)}
      </div>
      <div className="deck-picker__filter-line">
        <div className="deck-picker__colors" role="group" aria-label={t('colorIdentity')}>
          {COLORS.map((c) => (
            <button key={c.bit} type="button" className="mana-swatch" disabled={disabled} aria-label={t(c.label)}
              aria-pressed={color === c.bit} onClick={() => setColor(color === c.bit ? -1 : c.bit)}>
              <ManaSymbol symbol={c.symbol} cost />
            </button>
          ))}
        </div>
        <span className="deck-picker__count" role="status">{loading ? t('deckSelectionLoading') : t(visible.length === 1 ? 'oneDeck' : 'deckCount', { n: visible.length })}</span>
      </div>
    </div>
    <div className="deck-picker__results">
      {!loading && !visible.length && <div className="deck-picker__empty">
        <p>{t('noMatchingDecks')}</p><button type="button" className="btn btn--ghost" disabled={disabled}
          onClick={() => { setQuery(''); setSource('all'); setColor(-1); }}>{t('clearDeckFilters')}</button>
      </div>}
      <ul className="deck-picker__list">
        {visible.map(deck => {
          const id = deckKey(deck), active = selected === id, card = deck.commanders?.[0];
          return <li key={id} className={`deck-picker__row ${active ? 'is-selected' : ''}`}>
            <InspectableCard as="button" disabled={disabled} card={card ? cardForInspection(card) : null}
              className="deck-picker__pick" aria-pressed={active} onClick={() => onSelect(id)}>
              <DeckArtwork card={card} />
              <span className="deck-picker__names"><strong>{deck.name}</strong>
                {deck.commanders?.length ? <span>{deck.commanders.map(c => c.name).join(' / ')}</span> : null}
              </span>
              <span className="deck-picker__meta"><DeckIdentity identity={deck.identity} /><span>{t(deck.source === 'mine' ? 'myDecks' : 'precons')}</span></span>
              <span className="deck-picker__selected" aria-hidden="true">{active && <CheckIcon />}</span>
            </InspectableCard>
            <button type="button" className="deck-picker__favorite" disabled={disabled} aria-pressed={favorites.has(id)}
              aria-label={t(favorites.has(id) ? 'removeDeckFavorite' : 'addDeckFavorite', { name: deck.name })}
              onClick={() => toggleFavorite(id)}><StarIcon /></button>
          </li>;
        })}
      </ul>
    </div>
  </section>;
}
