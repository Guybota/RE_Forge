import { lazy, Suspense, useEffect, useMemo, useState } from 'react';
import { DeckCards } from './DeckCards';
import { reply, useRequest } from './deckRequests';
import { deckKey } from './deckSelection';
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
  const [library, setLibrary] = useState<'mine' | 'precon'>(initialDeck && decks.precons.includes(initialDeck) ? 'precon' : 'mine');
  const names = library === 'mine' ? decks.mine : decks.precons;
  const [selected, setSelected] = useState(initialDeck && names.includes(initialDeck) ? initialDeck : names[0]);
  const [name, setName] = useState(selected ?? '');
  const [renaming, setRenaming] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [view, setView] = useState<(typeof VIEWS)[number]['id']>('list');
  const owned = library === 'mine';
  const linesRequest = useRequest((requestId) => {
    if (!owned && selected) send({ type: 'deckLines', requestId, name: selected, source: 'precon' });
  }, [owned, selected, send]);
  const linesReply = reply(engine, 'deckLines', linesRequest.id.current);
  const preconDetail: DeckDetail | null = !owned && linesReply?.type === 'deckLines' && linesReply.name === selected
    ? { ...linesReply, type: 'deckDetail' } : null;
  const detail = owned ? (engine.deckDetail?.name === selected ? engine.deckDetail : null) : preconDetail;
  const priceRequest = useRequest((requestId) => {
    if (detail && view === 'list') send({ type: 'deckPrices', requestId, name: detail.name, source: library });
  }, [detail?.name, library, view, send]);
  const priceReply = reply(engine, 'deckPrices', priceRequest.id.current);
  const prices = useMemo(() => {
    const map = new Map<string, number>();
    if (priceReply?.type === 'deckPrices') for (const p of priceReply.prices) if (p.eur != null) map.set(`${p.set}/${p.number}`, p.eur);
    return map;
  }, [priceReply]);

  useEffect(() => {
    setName(selected ?? '');
    setCopied(false);
    if (owned && selected) send({ type: 'getDeck', name: selected });
  }, [selected, owned, send]);

  // Follow the list: a renamed deck stays selected, a deleted one hands over to the first remaining.
  useEffect(() => {
    if (renaming && decks.mine.includes(renaming)) {
      setSelected(renaming);
      setRenaming(null);
    } else if (!selected || !names.includes(selected)) {
      setSelected(names[0]);
    }
  }, [decks, names, renaming, selected]);
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
      <div className="decks__sources" role="group" aria-label={t('deckSource')}>
        <button type="button" className="btn btn--ghost" aria-pressed={owned} onClick={() => { setLibrary('mine'); setSelected(decks.mine[0]); setView('list'); }}>{t('myDecks')}</button>
        <button type="button" className="btn btn--ghost" aria-pressed={!owned} onClick={() => { setLibrary('precon'); setSelected(decks.precons[0]); setView('list'); }}>{t('precons')}</button>
      </div>
      {owned && decks.mine.length === 0 ? (
        <div className="decks__empty">
          <button type="button" className="btn btn--primary btn--big" onClick={() => onBuild()}>{t('newDeck')}</button>
          <button type="button" className="btn btn--ghost btn--big" onClick={onImport}>{t('importDeck')}</button>
        </div>
      ) : (
        <div className="decks__body">
          <ul className="decks__list" aria-label={t(owned ? 'myDecks' : 'precons')}>
            {names.map((d) => (
              <li key={d}>
                <button type="button" className={`decks__item ${d === selected ? 'is-on' : ''}`} aria-pressed={d === selected} onClick={() => setSelected(d)}>{d}</button>
              </li>
            ))}
          </ul>
          {selected && (
            <section className="decks__detail" aria-label={selected}>
              <div className="decks__head">
                {owned ? <input className="input decks__name" aria-label={t('deckName')} value={name} onChange={(e) => setName(e.target.value)}
                  onBlur={rename} onKeyDown={(e) => { if (e.key === 'Enter') e.currentTarget.blur(); if (e.key === 'Escape') setName(selected); }} />
                  : <h2 className="decks__name">{selected}</h2>}
                {!owned && <p className="muted decks__readonly">{t('preconReadOnly')}</p>}
                <button type="button" className="btn btn--primary" onClick={() => onPlay(deckKey({ source: library, name: selected }))}>{t('playDeck')}</button>
                {owned && <button type="button" className="btn btn--ghost" disabled={!detail} onClick={() => detail && onBuild(detail)}>{t('editDeck')}</button>}
                <button type="button" className="btn btn--ghost" disabled={!detail} title={t('exportHint')} onClick={async () => {
                  if (!detail) return;
                  try { await navigator.clipboard.writeText(detail.text); setCopied(true); } catch { setCopied(false); }
                }}>{t(copied ? 'copied' : 'exportDeck')}</button>
                {owned && <button type="button" className="btn btn--ghost decks__delete" onClick={() => {
                  if (window.confirm(t('confirmDelete', { name: selected }))) send({ type: 'deleteDeck', name: selected });
                }}>{t('deleteDeck')}</button>}
              </div>
              {engine.error && <p className="error" role="alert">{engine.error}</p>}
              <nav className="builder__views" aria-label={t('deckViews')}>
                {VIEWS.filter((v) => owned || v.id !== 'notes').map((v) => <button key={v.id} type="button" className="btn btn--ghost" aria-pressed={view === v.id} onClick={() => setView(v.id)}>{t(v.label)}</button>)}
              </nav>
              {detail && view === 'list' && <DeckCards preview={detail} faces prices={prices} />}
              <Suspense fallback={<p className="muted" role="status">{t('connecting')}</p>}>
              {detail && view === 'analysis' && <DeckAnalysis detail={detail} />}
              {detail && view === 'prices' && <DeckPrices key={detail.name} detail={detail} engine={engine} source={library} />}
              {detail && view === 'combos' && <DeckCombos key={detail.name} detail={detail} engine={engine} source={library} />}
              {detail && view === 'improve' && <DeckImprove key={detail.name} detail={detail} engine={engine} source={library} onCreated={(created) => { setLibrary('mine'); setRenaming(created); setView('list'); }} />}
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
