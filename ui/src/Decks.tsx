import { lazy, Suspense, useEffect, useMemo, useRef, useState } from 'react';
import { DeckCards, type BestPrice, type FacePrice } from './DeckCards';
import { reply, useRequest } from './deckRequests';
import { deckKey } from './deckSelection';
import { demoteCommander, moveCopy, removeCopy, swapPrinting } from './deckText';
import type { DeckDetail, DeckLists, DeckPreview, DeckSummary } from './engine';
import { PrintingsDialog } from './PrintingsDialog';
import { useT, type MessageKey } from './i18n';
import { cardImage } from './images';
import { InspectableCard } from './table/CardInspection';
import { cardForInspection } from './table/useCardInspection';
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

/** The player's own decks and the precons: a shelf of commanders, and the deck itself after a click. */
export function Decks({ engine, initialDeck, onBack, onPlay, onImport, onBuild }: Props) {
  const t = useT();
  const { send, decks } = engine;
  const start = openedFrom(initialDeck, decks);
  const [library, setLibrary] = useState<'mine' | 'precon'>(start.library);
  const names = library === 'mine' ? decks.mine : decks.precons;
  const [opened, setOpened] = useState<string | null>(start.opened);
  const appliedInitial = useRef(start.opened != null);
  const [name, setName] = useState(opened ?? '');
  const [renaming, setRenaming] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [view, setView] = useState<(typeof VIEWS)[number]['id']>('list');
  const [query, setQuery] = useState('');
  const [year, setYear] = useState(0);
  const [colors, setColors] = useState(0);
  const owned = library === 'mine';
  const shelf = useMemo(() => listed(decks, library).filter((deck) => matchesShelf(deck, query, owned ? 0 : year, owned ? 0 : colors)), [decks, library, query, year, colors, owned]);
  const groups = useMemo(() => owned ? [{ year: 0, sets: [{ key: 'mine', name: '', code: '', decks: shelf }] }] : preconShelf(shelf), [owned, shelf]);
  const years = useMemo(() => [...new Set(listed(decks, 'precon').map((deck) => deck.year ?? yearOf(deck.name)).filter((value) => value > 0))].sort((a, b) => b - a), [decks]);
  const linesRequest = useRequest((requestId) => {
    if (!owned && opened) send({ type: 'deckLines', requestId, name: opened, source: 'precon' });
  }, [owned, opened, send]);
  const linesReply = reply(engine, 'deckLines', linesRequest.id.current);
  const preconDetail: DeckDetail | null = !owned && linesReply?.type === 'deckLines' && linesReply.name === opened
    ? { ...linesReply, type: 'deckDetail' } : null;
  const detail = owned ? (engine.deckDetail?.name === opened ? engine.deckDetail : null) : preconDetail;
  const priceRequest = useRequest((requestId) => {
    if (detail && view === 'list') send({ type: 'deckPrices', requestId, name: detail.name, source: library });
  }, [detail?.name, library, view, send]);
  const priceReply = reply(engine, 'deckPrices', priceRequest.id.current);
  const prices = useMemo(() => {
    const map = new Map<string, FacePrice>();
    if (priceReply?.type === 'deckPrices') for (const p of priceReply.prices) if (p.eur != null) map.set(`${p.set}/${p.number}`, { eur: p.eur, exact: p.exact });
    return map;
  }, [priceReply]);
  const cheaperRequest = useRequest((requestId) => {
    if (detail && view === 'list') send({ type: 'cheaperPrintings', requestId, name: detail.name, source: library });
  }, [detail?.name, library, view, send]);
  const cheaperReply = reply(engine, 'cheaperPrintings', cheaperRequest.id.current);
  const best = useMemo(() => {
    const map = new Map<string, BestPrice>();
    if (cheaperReply?.type === 'cheaperPrintings') for (const offer of cheaperReply.offers) map.set(`${offer.from.set}/${offer.from.number}`, { set: offer.to.set, eur: offer.to.eur });
    return map;
  }, [cheaperReply]);
  const [printingOf, setPrintingOf] = useState<DeckPreview['lines'][number] | null>(null);
  useEffect(() => { if (printingOf?.nameEn) send({ type: 'getPrintings', name: printingOf.nameEn }); }, [printingOf, send]);
  const saveList = (text: string) => {
    if (!detail || !owned) return;
    send({ type: 'saveDeck', text, name: detail.name, from: detail.name });
    send({ type: 'getDeck', name: detail.name });
  };
  const sectionOf = (line: DeckPreview['lines'][number]) => line.maybeboard ? 'maybeboard' : line.sideboard ? 'sideboard' : line.group === 'commander' ? 'commander' : 'deck';

  useEffect(() => {
    if (appliedInitial.current || !initialDeck) return;
    const next = openedFrom(initialDeck, decks);
    if (next.opened) { appliedInitial.current = true; setLibrary(next.library); setOpened(next.opened); }
    else if (decks.loaded) appliedInitial.current = true;
  }, [decks, initialDeck]);

  useEffect(() => {
    setName(opened ?? '');
    setCopied(false);
    if (owned && opened) send({ type: 'getDeck', name: opened });
  }, [opened, owned, send]);

  // A renamed deck stays open. A deleted one returns to the shelf.
  useEffect(() => {
    if (renaming && decks.mine.includes(renaming)) {
      setLibrary('mine');
      setOpened(renaming);
      setRenaming(null);
    } else if (opened && !names.includes(opened)) {
      setOpened(null);
    }
  }, [decks, names, renaming, opened]);
  useEffect(() => {
    if (engine.error) { setRenaming(null); setName(opened ?? ''); }
  }, [engine.error, opened]);

  const rename = () => {
    const to = name.trim();
    if (!opened || !to || to === opened) { setName(opened ?? ''); return; }
    setRenaming(to);
    send({ type: 'renameDeck', name: opened, to });
  };
  const showShelf = (source: 'mine' | 'precon') => { setLibrary(source); setOpened(null); setView('list'); setQuery(''); setYear(0); setColors(0); };

  return (
    <main className="import decks">
      <header className="import__head">
        <button type="button" className="btn btn--ghost" onClick={() => opened ? setOpened(null) : onBack()}>{t('back')}</button>
        <h1>{t('decks')}</h1>
        {decks.mine.length > 0 && <span className="decks__new">
          <button type="button" className="btn btn--ghost" onClick={onImport}>{t('import')}</button>
          <button type="button" className="btn btn--primary" onClick={() => onBuild()}>{t('newDeck')}</button>
        </span>}
      </header>
      <div className="decks__sources" role="group" aria-label={t('deckSource')}>
        <button type="button" className="btn btn--ghost" aria-pressed={owned} onClick={() => showShelf('mine')}>{t('myDecks')}</button>
        <button type="button" className="btn btn--ghost" aria-pressed={!owned} onClick={() => showShelf('precon')}>{t('precons')}</button>
      </div>
      {owned && decks.mine.length === 0 ? (
        <div className="decks__empty">
          <button type="button" className="btn btn--primary btn--big" onClick={() => onBuild()}>{t('newDeck')}</button>
          <button type="button" className="btn btn--ghost btn--big" onClick={onImport}>{t('importDeck')}</button>
        </div>
      ) : opened ? (
            <section className="decks__detail" aria-label={opened}>
              <div className="decks__head">
                {owned ? <input className="input decks__name" aria-label={t('deckName')} value={name} onChange={(e) => setName(e.target.value)}
                  onBlur={rename} onKeyDown={(e) => { if (e.key === 'Enter') e.currentTarget.blur(); if (e.key === 'Escape') setName(opened); }} />
                  : <h2 className="decks__name">{deckTitle(opened)}</h2>}
                {!owned && <p className="muted decks__readonly">{t('preconReadOnly')}</p>}
                <button type="button" className="btn btn--primary" onClick={() => onPlay(deckKey({ source: library, name: opened }))}>{t('playDeck')}</button>
                {owned && <button type="button" className="btn btn--ghost" disabled={!detail} onClick={() => detail && onBuild(detail)}>{t('editDeck')}</button>}
                <button type="button" className="btn btn--ghost" disabled={!detail} title={t('exportHint')} onClick={async () => {
                  if (!detail) return;
                  try { await navigator.clipboard.writeText(detail.text); setCopied(true); } catch { setCopied(false); }
                }}>{t(copied ? 'copied' : 'exportDeck')}</button>
                {owned && <button type="button" className="btn btn--ghost decks__delete" onClick={() => {
                  if (window.confirm(t('confirmDelete', { name: opened }))) send({ type: 'deleteDeck', name: opened });
                }}>{t('deleteDeck')}</button>}
              </div>
              {engine.error && <p className="error" role="alert">{engine.error}</p>}
              <nav className="builder__views" aria-label={t('deckViews')}>
                {VIEWS.filter((v) => owned || v.id !== 'notes').map((v) => <button key={v.id} type="button" className="btn btn--ghost" aria-pressed={view === v.id} onClick={() => setView(v.id)}>{t(v.label)}</button>)}
              </nav>
              {detail && view === 'list' && <DeckCards preview={detail} faces prices={prices} best={best} editable={owned}
                onChangePrinting={owned ? setPrintingOf : undefined}
                onRemove={owned ? (line) => line.nameEn && saveList(removeCopy(detail.text, line.nameEn, line, sectionOf(line))) : undefined}
                onDemote={owned ? (line) => line.nameEn && saveList(demoteCommander(detail.text, line.nameEn, line)) : undefined}
                onMove={owned ? (line, to) => line.nameEn && saveList(moveCopy(detail.text, line.nameEn, line, sectionOf(line), to)) : undefined} />}
              {printingOf?.nameEn && <PrintingsDialog title={printingOf.name ?? printingOf.nameEn} printings={engine.printings?.name === printingOf.nameEn ? engine.printings.printings : null}
                current={printingOf.imageKey ?? ''} onClose={() => setPrintingOf(null)} onRetry={() => send({ type: 'getPrintings', name: printingOf.nameEn! })}
                onPick={(p) => {
                  if (detail && printingOf.set && printingOf.number) saveList(swapPrinting(detail.text, printingOf.nameEn!, { set: printingOf.set, number: printingOf.number }, p));
                  setPrintingOf(null);
                }} />}
              <Suspense fallback={<p className="muted" role="status">{t('connecting')}</p>}>
              {detail && view === 'analysis' && <DeckAnalysis detail={detail} />}
              {detail && view === 'prices' && <DeckPrices key={detail.name} detail={detail} engine={engine} source={library} />}
              {detail && view === 'combos' && <DeckCombos key={detail.name} detail={detail} engine={engine} source={library} />}
              {detail && view === 'improve' && <DeckImprove key={detail.name} detail={detail} engine={engine} source={library} onCreated={(created) => { setLibrary('mine'); setRenaming(created); setView('list'); }} />}
              {detail && view === 'compare' && <DeckCompare key={detail.name} detail={detail} engine={engine} />}
              {detail && view === 'notes' && <DeckNotes key={[detail.name, detail.tags.join(','), detail.bracketIntent, detail.notes].join('\n')} detail={detail} engine={engine} />}
              </Suspense>
            </section>
      ) : (
        <div className="deck-shelf">
          <div className="deck-shelf__filters">
            <input className="input" type="search" aria-label={t('deckShelfSearch')} placeholder={t('deckShelfSearch')} value={query} onChange={(e) => setQuery(e.target.value)} />
            {!owned && <>
              <label className="muted">{t('shelfYear')}
                <select className="input" aria-label={t('shelfYear')} value={year} onChange={(e) => setYear(Number(e.target.value))}>
                  <option value={0}>{t('allYears')}</option>
                  {years.map((value) => <option key={value} value={value}>{value}</option>)}
                </select>
              </label>
              <span className="deck-shelf__colors">
                {SHELF_COLORS.map((color) => (
                  <button key={color.key} type="button" className="btn btn--ghost" aria-pressed={(colors & color.bit) !== 0} onClick={() => setColors(colors ^ color.bit)}>{t(color.label)}</button>
                ))}
              </span>
            </>}
          </div>
          {!owned && <p className="muted">{t('preconTotal', { n: shelf.length })}</p>}
          {shelf.length === 0 && <p className="muted">{t('shelfEmpty')}</p>}
          {groups.map((group) => (
            <section key={group.year || 'mine'} aria-label={group.year ? String(group.year) : t('myDecks')}>
              {group.year > 0 && <h2 className="deck-shelf__year">{group.year}</h2>}
              {group.sets.map((set) => (
                <div className="deck-shelf__set" key={set.key}>
                  {set.name && <header className="deck-shelf__edition"><h3>{set.name}</h3>{set.code && <span>{set.code}</span>}</header>}
                  <ul className="deck-exhibits">
                    {set.decks.map((deck) => <Poster key={deck.name} deck={deck} onOpen={() => { setOpened(deck.name); setView('list'); }} />)}
                  </ul>
                </div>
              ))}
            </section>
          ))}
        </div>
      )}
    </main>
  );
}

const STAMP = /\[([A-Za-z0-9]+)\]\s*\[(\d{4})\]\s*$/;

function deckTitle(name: string) {
  const match = name.match(STAMP);
  return match?.index ? name.slice(0, match.index).trim() : name;
}

function listed(decks: DeckLists, source: 'mine' | 'precon'): DeckSummary[] {
  const names = source === 'mine' ? decks.mine : decks.precons;
  const known = new Map((decks.summaries ?? []).filter((deck) => deck.source === source).map((deck) => [deck.name, deck]));
  return names.map((name) => known.get(name) ?? { source, name });
}

const SHELF_COLORS: { bit: number; key: string; label: MessageKey }[] = [
  { bit: 1, key: 'W', label: 'colorW' }, { bit: 2, key: 'U', label: 'colorU' }, { bit: 4, key: 'B', label: 'colorB' },
  { bit: 8, key: 'R', label: 'colorR' }, { bit: 16, key: 'G', label: 'colorG' }, { bit: 32, key: 'C', label: 'colorC' },
];

function matchesShelf(deck: DeckSummary, query: string, year: number, colors: number) {
  const deckYear = deck.year ?? yearOf(deck.name);
  if (year && deckYear !== year) return false;
  if (colors) {
    const identity = deck.identity ?? 0;
    const wantColorless = (colors & 32) !== 0 && identity === 0;
    const wantColor = (colors & ~32) !== 0 && (identity & (colors & ~32)) !== 0;
    if (!wantColorless && !wantColor) return false;
  }
  const text = query.trim().toLocaleLowerCase();
  if (!text) return true;
  const commanders = (deck.commanders ?? []).flatMap((card) => [card.name, card.nameEn]).join(' ');
  return `${deckTitle(deck.name)} ${deck.name} ${commanders} ${deck.set ?? ''} ${deck.setName ?? ''}`.toLocaleLowerCase().includes(text);
}

/** Newest year first, and inside it each expansion by release date. */
function preconShelf(decks: DeckSummary[]) {
  const sorted = [...decks].sort((a, b) => (b.year ?? yearOf(b.name)) - (a.year ?? yearOf(a.name))
    || (b.released ?? 0) - (a.released ?? 0)
    || (a.setName ?? a.set ?? '').localeCompare(b.setName ?? b.set ?? '')
    || deckTitle(a.name).localeCompare(deckTitle(b.name)));
  const groups: { year: number; sets: { key: string; name: string; code: string; decks: DeckSummary[] }[] }[] = [];
  for (const deck of sorted) {
    const year = deck.year ?? yearOf(deck.name);
    const code = deck.set ?? codeOf(deck.name);
    const key = `${code}:${year}`;
    let group = groups.at(-1);
    if (group?.year !== year) { group = { year, sets: [] }; groups.push(group); }
    let set = group.sets.at(-1);
    if (set?.key !== key) { set = { key, name: deck.setName || code, code, decks: [] }; group.sets.push(set); }
    set.decks.push(deck);
  }
  return groups;
}

function yearOf(name: string) { return Number(name.match(STAMP)?.[2] ?? 0); }
function codeOf(name: string) { return name.match(STAMP)?.[1]?.toUpperCase() ?? ''; }

function openedFrom(initial: string | undefined, decks: DeckLists): { library: 'mine' | 'precon'; opened: string | null } {
  if (!initial) return { library: 'mine', opened: null };
  const named = (source: 'mine' | 'precon', name: string) =>
    (source === 'mine' ? decks.mine : decks.precons).includes(name) ? { library: source, opened: name } : null;
  if (initial.startsWith('[')) {
    try {
      const key = JSON.parse(initial) as [string, string];
      if (key[0] === 'precon' || key[0] === 'mine') return named(key[0], key[1]) ?? { library: 'mine', opened: null };
    } catch { /* a plain deck name */ }
  }
  return named('mine', initial) ?? named('precon', initial) ?? { library: 'mine', opened: null };
}

function Poster({ deck, onOpen }: { deck: DeckSummary; onOpen: () => void }) {
  const t = useT();
  const main = deck.commanders?.[0];
  const src = main?.imageKey ? cardImage(main.imageKey, 'crop') : null;
  const identity = deck.identity ?? 0;
  const pips = SHELF_COLORS.filter((color) => identity === 0 ? color.bit === 32 : color.bit !== 32 && (identity & color.bit) !== 0);
  const commanders = (deck.commanders ?? []).map((card) => card.name).filter(Boolean).join(', ');
  const year = deck.year ?? yearOf(deck.name);
  const setName = deck.setName || deck.set || codeOf(deck.name);
  const footer = deck.source === 'precon' && (setName || year)
    ? [setName, year || '', t('officialPrecon')].filter(Boolean).join(' · ')
    : deck.cards != null ? t('cardsCount', { n: deck.cards }) : '';
  return (
    <li>
      <InspectableCard as="button" className="deck-poster" card={main ? cardForInspection(main) : null} onClick={onOpen}>
        {src ? <img src={src} alt="" loading="lazy" /> : <span className="deck-poster__blank" />}
        <span className="deck-poster__shade" />
        <span className="deck-poster__pips">
          {pips.map((color) => <span key={color.key} className={`pip pip--${color.key === 'C' ? 'n' : color.key}`} title={t(color.label)} />)}
        </span>
        <span className="deck-poster__copy">
          <strong>{deckTitle(deck.name)}</strong>
          {commanders && <span>{commanders}</span>}
          {footer && <span className="deck-poster__meta">{footer}</span>}
        </span>
      </InspectableCard>
    </li>
  );
}
