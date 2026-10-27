import { useState } from 'react';
import { useT } from './i18n';
import { SKINS } from './skins';
import type { Engine } from './useEngine';

const RANDOM = '';

export type LibraryDeckOption = { id: string; name: string };

const LIBRARY = 'library:';
const FORGE_NAME_UNSAFE = /[\\/:*?"<>|]/g;

/** Same cleanup the table applies when it saves a deck, so copies line up. */
function deckKey(name: string): string {
  return name.replace(FORGE_NAME_UNSAFE, ' ').replace(/\s+/g, ' ').trim().toLocaleLowerCase();
}

type Props = {
  engine: Engine;
  onPick: (what: 'language' | 'skin' | 'import' | 'online') => void;
  /** Deck to preselect, e.g. one just imported. */
  initialDeck?: string;
  /** Decks saved in MTG Central, listed apart from the engine's own decks. */
  libraryDecks?: LibraryDeckOption[];
  onPlayLibrary?: (deckId: string, opponents: number) => void;
  statusNote?: string | null;
};

export function Home({ engine, onPick, initialDeck, libraryDecks = [], onPlayLibrary, statusNote }: Props) {
  const t = useT();
  const [deck, setDeck] = useState(initialDeck ?? RANDOM);
  const [opponents, setOpponents] = useState(1);
  const [starting, setStarting] = useState(false);
  const info = engine.info;
  const languageName = info?.languages.find((l) => l.code === info.language)?.name;
  const { mine, precons } = engine.decks;
  const savedNames = new Set(libraryDecks.map((d) => deckKey(d.name)));
  const otherMine = mine.filter((name) => !savedNames.has(deckKey(name)));
  const isLibrary = deck.startsWith(LIBRARY);
  const isMine = !isLibrary && otherMine.includes(deck);

  const start = () => {
    setStarting(true);
    if (isLibrary) {
      onPlayLibrary?.(deck.slice(LIBRARY.length), opponents);
      return;
    }
    engine.send({
      type: 'startMatch',
      deck: deck || null,
      deckSource: precons.includes(deck) ? 'precon' : deck ? 'mine' : undefined,
      opponents,
      aiProfiles: [],
    });
  };

  return (
    <main className="home">
      <h1 title={info ? t('cardCount', { cards: info.cards.toLocaleString(info.language), editions: info.editions }) : undefined}>RE:Forge</h1>
      <form className="home__form" onSubmit={(e) => { e.preventDefault(); start(); }}>
        <div className="field-label">
          <label htmlFor="deck">{t('deck')}</label>
          <div className="home__deck">
            <select id="deck" className="input" value={deck} onChange={(e) => setDeck(e.target.value)}>
              <option value={RANDOM}>{t('random')}</option>
              {libraryDecks.length > 0 && (
                <optgroup label={t('savedDecks')}>
                  {libraryDecks.map((d) => <option key={d.id} value={`${LIBRARY}${d.id}`}>{d.name}</option>)}
                </optgroup>
              )}
              {otherMine.length > 0 && (
                <optgroup label={t('myDecks')}>
                  {otherMine.map((d) => <option key={d} value={d}>{d}</option>)}
                </optgroup>
              )}
              <optgroup label={t('precons')}>
                {precons.map((d) => <option key={d} value={d}>{d}</option>)}
              </optgroup>
            </select>
            {isMine && (
              <button
                type="button"
                className="btn btn--ghost"
                aria-label={t('deleteDeck')}
                title={t('deleteDeck')}
                onClick={() => {
                  if (!window.confirm(t('confirmDelete', { name: deck }))) return;
                  engine.send({ type: 'deleteDeck', name: deck });
                  setDeck(RANDOM);
                }}
              >
                ✕
              </button>
            )}
            <button type="button" className="btn btn--ghost" onClick={() => onPick('import')}>{t('import')}</button>
          </div>
        </div>
        <fieldset className="segmented">
          <legend className="field-label">{t('opponents')}</legend>
          {[1, 2, 3].map((n) => (
            <label key={n} className={opponents === n ? 'is-on' : ''}>
              <input type="radio" name="opponents" value={n} checked={opponents === n} onChange={() => setOpponents(n)} />
              {n}
            </label>
          ))}
        </fieldset>
        <button type="submit" className="btn btn--primary btn--big" disabled={starting && !engine.error}>
          {starting && !engine.error ? t('shuffling') : t('play')}
        </button>
        <button type="button" className="btn btn--ghost" onClick={() => onPick('online')}>{t('online')}</button>
        {statusNote && <p className="muted">{statusNote}</p>}
        {engine.error && <p className="error">{engine.error}</p>}
      </form>
      <div className="home__corner">
        <button type="button" onClick={() => onPick('skin')} title={t('skin')}>
          {t(SKINS.find((s) => s.id === info?.skin)?.name ?? 'skinMesa')}
        </button>
        <button type="button" onClick={() => onPick('language')} title={t('language')}>
          {languageName}
        </button>
      </div>
    </main>
  );
}
