import { useState } from 'react';
import { useT } from './i18n';
import type { Engine } from './useEngine';

const RANDOM = '';

export function Home({ engine, onChangeLanguage }: { engine: Engine; onChangeLanguage: () => void }) {
  const t = useT();
  const [deck, setDeck] = useState(RANDOM);
  const [opponents, setOpponents] = useState(1);
  const [starting, setStarting] = useState(false);
  const info = engine.info;
  const languageName = info?.languages.find((l) => l.code === info.language)?.name;

  const start = () => {
    setStarting(true);
    engine.send({ type: 'startMatch', deck: deck || null, opponents });
  };

  return (
    <main className="home">
      <h1 title={info ? t('cardCount', { cards: info.cards.toLocaleString(info.language), editions: info.editions }) : undefined}>RE:Forge</h1>
      <form className="home__form" onSubmit={(e) => { e.preventDefault(); start(); }}>
        <label className="field-label">
          {t('deck')}
          <select className="input" value={deck} onChange={(e) => setDeck(e.target.value)}>
            <option value={RANDOM}>{t('random')}</option>
            {engine.decks.map((d) => <option key={d} value={d}>{d}</option>)}
          </select>
        </label>
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
      <button type="button" className="home__language" onClick={onChangeLanguage} title={t('language')}>
        {languageName}
      </button>
    </main>
  );
}
