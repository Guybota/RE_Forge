import { useState } from 'react';
import { useT } from './i18n';
import { SKINS } from './skins';
import type { Engine } from './useEngine';

const RANDOM = '';

type Props = {
  engine: Engine;
  onPick: (what: 'language' | 'skin' | 'import') => void;
  /** Deck to preselect, e.g. one just imported. */
  initialDeck?: string;
};

export function Home({ engine, onPick, initialDeck }: Props) {
  const t = useT();
  const [deck, setDeck] = useState(initialDeck ?? RANDOM);
  const [opponents, setOpponents] = useState(1);
  const [starting, setStarting] = useState(false);
  const info = engine.info;
  const languageName = info?.languages.find((l) => l.code === info.language)?.name;
  const { mine, precons } = engine.decks;
  const isMine = mine.includes(deck);

  const start = () => {
    setStarting(true);
    engine.send({ type: 'startMatch', deck: deck || null, opponents });
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
              {mine.length > 0 && (
                <optgroup label={t('myDecks')}>
                  {mine.map((d) => <option key={d} value={d}>{d}</option>)}
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
