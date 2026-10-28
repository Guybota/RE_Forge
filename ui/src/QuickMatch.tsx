import { useContext, useMemo, useState } from 'react';
import { useT } from './i18n';
import { SKINS } from './skins';
import type { Engine } from './useEngine';
import type { DeckSummary } from './engine';
import { DeckArtwork, DeckIdentity, DeckPicker } from './DeckPicker';
import { deckKey, selectionDecks } from './deckSelection';
import { CardZoom } from './table/CardZoom';
import { InspectableCard } from './table/CardInspection';
import { cardForInspection } from './table/useCardInspection';
import { ShuffleIcon } from './table/icons';
import './deck-picker.css';
import { DeckLanguageStatus } from './DeckLanguageStatus';

export const RANDOM = '';
export const KNOWN_AI = ['Default', 'Cautious', 'Reckless', 'Hard', 'Hardest', 'Experimental'] as const;
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
  initialDeck?: string; onBack: () => void;
};

export function QuickMatch({ engine, onPick, initialDeck, onBack }: Props) {
  const t = useT();
  const [selectedKey, setSelectedKey] = useState<string | null>(null);
  const [opponents, setOpponents] = useState(1);
  const [starting, setStarting] = useState(false);
  const [ai, setAi] = useState<string[]>(savedAi);
  const info = engine.info;
  const languageName = info?.languages.find((l) => l.code === info.language)?.name;
  const decks = useMemo(() => selectionDecks(engine.decks), [engine.decks]);
  const selected = selectedKey === null
    ? decks.find(d => deckKey(d) === initialDeck) ?? decks.find(d => d.name === initialDeck)
    : decks.find(d => deckKey(d) === selectedKey);
  const busy = starting && !engine.error;
  const loading = engine.decks.loaded === false || !engine.decks.loaded && !decks.length;

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
    if (busy || loading) return;
    setStarting(true);
    engine.send({ type: 'startMatch', deck: selected?.name ?? null, deckSource: selected?.source, opponents, aiProfiles: [0, 1, 2].slice(0, opponents).map(aiFor) });
  };

  return (
    <main className="quick-match">
      <header className="quick-match__head"><button type="button" className="btn btn--ghost" disabled={busy} onClick={onBack}>{t('mainMenu')}</button><span>RE:Forge</span>
        <button type="button" className="btn btn--ghost" disabled={busy} onClick={() => onPick('decks')}>{t('manageDecks')}</button></header>
      <div className="quick-match__heading"><h1>{t('chooseDeck')} <span>{t('commanderMode')}</span></h1>
        <button type="button" className="btn btn--ghost" aria-pressed={!selected} disabled={busy || loading} onClick={() => setSelectedKey(RANDOM)}><ShuffleIcon />{t('random')}</button></div>
      <div className="quick-match__body">
      <DeckPicker decks={decks} selected={selected ? deckKey(selected) : RANDOM} onSelect={setSelectedKey} loading={loading} disabled={busy} />
      <form className="quick-match__preview" onSubmit={(e) => { e.preventDefault(); start(); }} aria-label={t('selectedDeck')}>
        <DeckPreview key={selected ? deckKey(selected) : RANDOM} deck={selected} />
        {selected && <DeckLanguageStatus engine={engine} deck={selected} language={info?.language ?? 'en-US'} languageName={languageName ?? ''} />}
        <div className="quick-match__options">
        <fieldset className="segmented" disabled={busy}>
          <legend className="field-label">{t('opponents')}</legend>
          {[1, 2, 3].map((n) => (
            <label key={n} className={opponents === n ? 'is-on' : ''}>
              <input type="radio" name="opponents" value={n} checked={opponents === n} onChange={() => setOpponents(n)} />
              {n}
            </label>
          ))}
        </fieldset>
        <fieldset className="home__ai" disabled={busy}>
          <legend className="field-label">{t('ai')}</legend>
          {[0, 1, 2].slice(0, opponents).map((i) => (
            <select key={i} className="input" aria-label={t('aiFor', { n: i + 1 })} value={aiFor(i)} onChange={(e) => chooseAi(i, e.target.value)}>
              {profiles.map((p) => <option key={p} value={p}>{aiName(p)}</option>)}
              <option value={RANDOM}>{t('random')}</option>
            </select>
          ))}
        </fieldset>
        <button type="submit" className="btn btn--primary" disabled={busy || loading}>
          {busy ? t('shuffling') : t('play')}
        </button>
        {engine.error && <p className="error" role="alert">{engine.error}</p>}
        </div>
      </form>
      </div>
      <footer className="quick-match__footer">
        <button type="button" className="btn btn--ghost" disabled={busy} onClick={() => onPick('online')}>{t('online')}</button>
        <button type="button" className="btn btn--ghost" disabled={busy} onClick={() => onPick('skin')} title={t('skin')}>
          {t(SKINS.find((s) => s.id === info?.skin)?.name ?? 'skinMesa')}
        </button>
        <button type="button" className="btn btn--ghost" disabled={busy} onClick={() => onPick('language')} title={t('language')}>
          {languageName}
        </button>
      </footer>
    </main>
  );
}

function DeckPreview({ deck }: { deck?: DeckSummary }) {
  const t = useT();
  const zoom = useContext(CardZoom);
  const [commander, setCommander] = useState(0);
  const card = deck?.commanders?.[commander];
  return <>
    {deck ? <>
      <InspectableCard as="button" className="quick-match__art" card={card ? cardForInspection(card) : null}
        aria-label={card ? t('inspectCommander', { name: card.name }) : t('selectedDeck')}
        disabled={!card} onClick={() => card && zoom(cardForInspection(card))}><DeckArtwork card={card} eager /></InspectableCard>
      <div className="quick-match__summary">
        <h2>{deck.name}</h2>
        <div className="quick-match__commanders">{deck.commanders?.map((c, i) => deck.commanders!.length > 1 ? <button key={`${c.nameEn}:${i}`} type="button" aria-pressed={commander === i}
          onClick={() => setCommander(i)}>{c.name}</button> : <span key={c.nameEn}>{c.name}</span>)}</div>
        <DeckIdentity identity={deck.identity} />
        <p>{t(deck.source === 'mine' ? 'myDecks' : 'precons')}{deck.cards !== undefined && <> · {t('cardsCount', { n: deck.cards })}</>}</p>
      </div>
    </> : <div className="quick-match__summary quick-match__random"><ShuffleIcon /><h2>{t('randomDeck')}</h2><p>{t('randomDeckHint')}</p></div>}
  </>;
}

