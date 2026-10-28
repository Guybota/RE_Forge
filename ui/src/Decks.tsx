import { lazy, Suspense, useEffect, useState } from 'react';
import { DeckCards } from './DeckCards';
import type { DeckDetail } from './engine';
import { useT, type MessageKey } from './i18n';
import type { Engine } from './useEngine';

// The deck tools (heuristics, card tags, translations) load only when one of their views opens.
const DeckAnalysis = lazy(() => import('./DeckInsights').then((m) => ({ default: m.DeckAnalysis })));
const DeckNotes = lazy(() => import('./DeckInsights').then((m) => ({ default: m.DeckNotes })));
const DeckPrices = lazy(() => import('./DeckOnline').then((m) => ({ default: m.DeckPrices })));
const DeckCombos = lazy(() => import('./DeckOnline').then((m) => ({ default: m.DeckCombos })));
const DeckImprove = lazy(() => import('./DeckImprove').then((m) => ({ default: m.DeckImprove })));
const DeckCompare = lazy(() => import('./DeckCompare').then((m) => ({ default: m.DeckCompare })));

const VIEWS: { id: 'list' | 'analysis' | 'prices' | 'combos' | 'improve' | 'compare' | 'notes'; label: MessageKey }[] = [
  { id: 'list', label: 'deckViewList' }, { id: 'analysis', label: 'deckViewAnalysis' }, { id: 'prices', label: 'deckViewPrices' },
  { id: 'combos', label: 'deckViewCombos' }, { id: 'improve', label: 'deckViewImprove' }, { id: 'compare', label: 'deckViewCompare' },
  { id: 'notes', label: 'deckViewNotes' },
];

type Props = {
  engine: Engine;
  /** Deck to show first, e.g. one just imported or edited. */
  initialDeck?: string;
  onBack: () => void;
  onPlay: (deck: string) => void;
  onImport: () => void;
  /** Opens the builder: with a deck to change it, without one for a new deck. */
  onBuild: (deck?: DeckDetail) => void;
};

/** The player's own decks (imported or edited here): look through, rename, edit, export, delete or play one. */
export function Decks({ engine, initialDeck, onBack, onPlay, onImport, onBuild }: Props) {
  const t = useT();
  const { send, decks } = engine;
  const [selected, setSelected] = useState(initialDeck && decks.mine.includes(initialDeck) ? initialDeck : decks.mine[0]);
  const [name, setName] = useState(selected ?? '');
  const [renaming, setRenaming] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [view, setView] = useState<(typeof VIEWS)[number]['id']>('list');
  const detail = engine.deckDetail?.name === selected ? engine.deckDetail : null;

  useEffect(() => {
    setName(selected ?? '');
    setCopied(false);
    if (selected) send({ type: 'getDeck', name: selected });
  }, [selected, send]);

  // Follow the list: a renamed deck stays selected, a deleted one hands over to the first remaining.
  useEffect(() => {
    if (renaming && decks.mine.includes(renaming)) {
      setSelected(renaming);
      setRenaming(null);
    } else if (!selected || !decks.mine.includes(selected)) {
      setSelected(decks.mine[0]);
    }
  }, [decks, renaming, selected]);
  useEffect(() => {
    if (engine.error) { setRenaming(null); setName(selected ?? ''); }
  }, [engine.error, selected]);

  const rename = () => {
    const to = name.trim();
    if (!selected || !to || to === selected) { setName(selected ?? ''); return; }
    setRenaming(to);
    send({ type: 'renameDeck', name: selected, to });
  };

  return (
    <main className="import decks">
      <header className="import__head">
        <button type="button" className="btn btn--ghost" onClick={onBack}>{t('back')}</button>
        <h1>{t('decks')}</h1>
        {decks.mine.length > 0 && <span className="decks__new">
          <button type="button" className="btn btn--ghost" onClick={onImport}>{t('import')}</button>
          <button type="button" className="btn btn--primary" onClick={() => onBuild()}>{t('newDeck')}</button>
        </span>}
      </header>
      {decks.mine.length === 0 ? (
        <div className="decks__empty">
          <button type="button" className="btn btn--primary btn--big" onClick={() => onBuild()}>{t('newDeck')}</button>
          <button type="button" className="btn btn--ghost btn--big" onClick={onImport}>{t('importDeck')}</button>
        </div>
      ) : (
        <div className="decks__body">
          <ul className="decks__list" aria-label={t('myDecks')}>
            {decks.mine.map((d) => (
              <li key={d}>
                <button type="button" className={`decks__item ${d === selected ? 'is-on' : ''}`} aria-pressed={d === selected} onClick={() => setSelected(d)}>{d}</button>
              </li>
            ))}
          </ul>
          {selected && (
            <section className="decks__detail" aria-label={selected}>
              <div className="decks__head">
                <input className="input decks__name" aria-label={t('deckName')} value={name} onChange={(e) => setName(e.target.value)}
                  onBlur={rename} onKeyDown={(e) => { if (e.key === 'Enter') e.currentTarget.blur(); if (e.key === 'Escape') setName(selected); }} />
                <button type="button" className="btn btn--primary" onClick={() => onPlay(selected)}>{t('playDeck')}</button>
                <button type="button" className="btn btn--ghost" disabled={!detail} onClick={() => detail && onBuild(detail)}>{t('editDeck')}</button>
                <button type="button" className="btn btn--ghost" disabled={!detail} title={t('exportHint')} onClick={async () => {
                  if (!detail) return;
                  try { await navigator.clipboard.writeText(detail.text); setCopied(true); } catch { setCopied(false); }
                }}>{t(copied ? 'copied' : 'exportDeck')}</button>
                <button type="button" className="btn btn--ghost decks__delete" onClick={() => {
                  if (window.confirm(t('confirmDelete', { name: selected }))) send({ type: 'deleteDeck', name: selected });
                }}>{t('deleteDeck')}</button>
              </div>
              {engine.error && <p className="error" role="alert">{engine.error}</p>}
              <nav className="builder__views" aria-label={t('deckViews')}>
                {VIEWS.map((v) => <button key={v.id} type="button" className="btn btn--ghost" aria-pressed={view === v.id} onClick={() => setView(v.id)}>{t(v.label)}</button>)}
              </nav>
              {detail && view === 'list' && <DeckCards preview={detail} />}
              <Suspense fallback={<p className="muted" role="status">{t('connecting')}</p>}>
              {detail && view === 'analysis' && <DeckAnalysis detail={detail} />}
              {detail && view === 'prices' && <DeckPrices key={detail.name} detail={detail} engine={engine} />}
              {detail && view === 'combos' && <DeckCombos key={detail.name} detail={detail} engine={engine} />}
              {detail && view === 'improve' && <DeckImprove key={detail.name} detail={detail} engine={engine} onCreated={(name) => { setRenaming(name); setView('list'); }} />}
              {detail && view === 'compare' && <DeckCompare key={detail.name} detail={detail} engine={engine} />}
              {detail && view === 'notes' && <DeckNotes key={[detail.name, detail.tags.join(','), detail.bracketIntent, detail.notes].join('\n')} detail={detail} engine={engine} />}
              </Suspense>
            </section>
          )}
        </div>
      )}
    </main>
  );
}
