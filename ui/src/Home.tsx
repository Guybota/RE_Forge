import { useState } from 'react';
import { useT } from './i18n';
import { SKINS } from './skins';
import type { Engine } from './useEngine';

const RANDOM = '';
const KNOWN_AI = ['Default', 'Cautious', 'Reckless', 'Hard', 'Hardest', 'Experimental'] as const;
const AI_STORAGE = 'reforge.aiProfiles';

function savedAi(): string[] {
  try {
    const value = JSON.parse(localStorage.getItem(AI_STORAGE) ?? '[]');
    return Array.isArray(value) ? value.map(String) : [];
  } catch {
    return [];
  }
}

type Props = {
  engine: Engine;
  onPick: (what: 'language' | 'skin' | 'decks' | 'online') => void;
  /** Deck to preselect, e.g. one chosen to play from the decks screen. */
  initialDeck?: string;
};

export function Home({ engine, onPick, initialDeck }: Props) {
  const t = useT();
  const [deck, setDeck] = useState(initialDeck ?? RANDOM);
  const [opponents, setOpponents] = useState(1);
  const [starting, setStarting] = useState(false);
  const [ai, setAi] = useState<string[]>(savedAi);
  const info = engine.info;
  const languageName = info?.languages.find((l) => l.code === info.language)?.name;
  const { mine, precons } = engine.decks;

  const profiles = info?.aiProfiles ?? [];
  // A remembered profile the engine no longer has falls back to Forge's default.
  const aiFor = (i: number) => (ai[i] === RANDOM || profiles.includes(ai[i]) ? ai[i] : profiles.includes('Default') ? 'Default' : RANDOM);
  const aiName = (p: string) => ((KNOWN_AI as readonly string[]).includes(p) ? t(`ai${p as (typeof KNOWN_AI)[number]}`) : p);
  const chooseAi = (i: number, profile: string) => {
    const next = [0, 1, 2].map((n) => (n === i ? profile : aiFor(n)));
    setAi(next);
    try { localStorage.setItem(AI_STORAGE, JSON.stringify(next)); } catch { /* remembered for this session only */ }
  };

  const start = () => {
    setStarting(true);
    engine.send({ type: 'startMatch', deck: deck || null, opponents, aiProfiles: [0, 1, 2].slice(0, opponents).map(aiFor) });
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
<button type="button" className="btn btn--ghost" onClick={() => onPick('decks')}>{t('decks')}</button>
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
        <fieldset className="home__ai">
          <legend className="field-label">{t('ai')}</legend>
          {[0, 1, 2].slice(0, opponents).map((i) => (
            <select key={i} className="input" aria-label={t('aiFor', { n: i + 1 })} value={aiFor(i)} onChange={(e) => chooseAi(i, e.target.value)}>
              {profiles.map((p) => <option key={p} value={p}>{aiName(p)}</option>)}
              <option value={RANDOM}>{t('random')}</option>
            </select>
          ))}
        </fieldset>
        <button type="submit" className="btn btn--primary btn--big" disabled={starting && !engine.error}>
          {starting && !engine.error ? t('shuffling') : t('play')}
        </button>
        <button type="button" className="btn btn--ghost" onClick={() => onPick('online')}>{t('online')}</button>
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
