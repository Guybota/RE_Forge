import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { GROUPS } from './DeckCards';
import { DeckStatistics } from './DeckStatistics';
import { PrintingsDialog } from './PrintingsDialog';
import { decklist, replacePrinting, matchesDeckFilter, type DeckFilter } from './deckAnalysis';
import type { CatalogCard, DeckDetail } from './engine';
import { useT, type MessageKey } from './i18n';
import { cardImage } from './images';
import { InspectableCard } from './table/CardInspection';
import { cardForInspection } from './table/useCardInspection';
import { manaSymbols } from './table/cards';
import { ArtIcon, CrownIcon } from './table/icons';
import type { Engine } from './useEngine';

type Entry = CatalogCard & { qty: number; commander: boolean };

const COLORS: { bit: number; key: string; label: MessageKey }[] = [
  { bit: 1, key: 'W', label: 'colorW' }, { bit: 2, key: 'U', label: 'colorU' }, { bit: 4, key: 'B', label: 'colorB' },
  { bit: 8, key: 'R', label: 'colorR' }, { bit: 16, key: 'G', label: 'colorG' }, { bit: 32, key: 'C', label: 'colorC' },
];
const BASICS = new Set(['Plains', 'Island', 'Swamp', 'Mountain', 'Forest', 'Wastes']);
const CURVE = [0, 1, 2, 3, 4, 5, 6, 7];
type Stat = 'mv' | 'pow' | 'tou' | 'loy';
type StatOp = '=' | '<' | '<=' | '>' | '>=' | '!=';
const STATS: { id: Stat; label: MessageKey }[] = [
  { id: 'mv', label: 'manaValue' }, { id: 'pow', label: 'statPower' }, { id: 'tou', label: 'statToughness' }, { id: 'loy', label: 'statLoyalty' },
];
const STAT_OPS: StatOp[] = ['=', '<', '<=', '>', '>=', '!='];
let nextCatalogRequest = 0;

/** Build or change a Commander deck: catalog on the left, the deck on the right. */
export function DeckBuilder({ engine, initial, onDone }: { engine: Engine; initial?: DeckDetail; onDone: (saved: string | null) => void }) {
  const t = useT();
  const { send } = engine;
  const [name, setName] = useState(initial?.name ?? '');
  const [entries, setEntries] = useState<Entry[]>(() => (initial?.lines ?? [])
    .filter((l) => l.nameEn && l.qty)
    .map((l) => ({ ...(l as CatalogCard), group: l.typeGroup ?? l.group ?? 'other', qty: l.qty ?? 1, commander: l.group === 'commander' })));
  const [view, setView] = useState<'cards' | 'stats'>('cards');
  const [includeCommanders, setIncludeCommanders] = useState(false);
  const [statsFilter, setStatsFilter] = useState<DeckFilter>(null);
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  const [hovered, setHovered] = useState<Entry | CatalogCard | null>(null);
  const [printingsOf, setPrintingsOf] = useState<Entry | null>(null);

  const commanders = entries.filter((e) => e.commander);
  const identity = commanders.reduce((mask, e) => mask | e.identity, 0);
  const count = entries.reduce((n, e) => n + e.qty, 0);

  // Catalog filters. Without a commander yet, the catalog starts by offering commanders.
  const [query, setQuery] = useState('');
  const [colors, setColors] = useState(0);
  const [cardType, setCardType] = useState('');
  const [cmc, setCmc] = useState(-1);
  const [pickCommander, setPickCommander] = useState(commanders.length === 0);
  const [partnerOf, setPartnerOf] = useState<string | null>(null);
  const partnerName = partnerOf && commanders.length === 1 && commanders[0].nameEn === partnerOf ? partnerOf : undefined;
  // Advanced (from Central's search): rules text, type line, and one number compared.
  const [rules, setRules] = useState('');
  const [typeText, setTypeText] = useState('');
  const [stat, setStat] = useState<Stat>('pow');
  const [statOp, setStatOp] = useState<StatOp>('>=');
  const [statValue, setStatValue] = useState('');
  const statNumber = statValue.trim() === '' || !Number.isFinite(Number(statValue)) ? undefined : Math.trunc(Number(statValue));
  const advanced = [rules.trim(), typeText.trim(), statNumber !== undefined].filter(Boolean).length;
  const [results, setResults] = useState<CatalogCard[]>([]);
  const [resultScope, setResultScope] = useState('');
  const searchScope = JSON.stringify([query, colors, cardType, cmc, pickCommander, identity, partnerName, rules, typeText, stat, statOp, statNumber]);
  const shownResults = resultScope === searchScope ? results : [];
  const offset = useRef(0);
  const requestId = useRef(0);
  const search = useCallback((from: number, id = ++nextCatalogRequest) => {
    offset.current = from;
    requestId.current = id;
    send({ type: 'searchCards', requestId: id, query, colors, cardType, cmc, offset: from, commanders: pickCommander, partnerOf: partnerName,
      identity: commanders.length && !pickCommander ? identity : undefined,
      rules, typeText, ...(statNumber === undefined ? {} : { stat, statOp, statValue: statNumber }) });
  }, [send, query, colors, cardType, cmc, pickCommander, identity, partnerName, commanders.length, rules, typeText, stat, statOp, statNumber]);
  useEffect(() => {
    const id = ++nextCatalogRequest;
    requestId.current = id;
    const timer = setTimeout(() => search(0, id), 250);
    return () => clearTimeout(timer);
  }, [search]);
  useEffect(() => {
    const r = engine.cardResults;
    if (!r || r.offset !== offset.current || r.requestId !== requestId.current) return;
    setResultScope(searchScope);
    setResults((old) => (r.offset === 0 ? r.cards : [...old, ...r.cards]));
  }, [engine.cardResults, searchScope]);

  // The engine checks the list (count, singleton, identity, banned cards) after each change.
  const text = useMemo(() => decklist(entries), [entries]);
  useEffect(() => {
    if (!text) return;
    const timer = setTimeout(() => send({ type: 'previewDeck', text, name }), 300);
    return () => clearTimeout(timer);
  }, [text, name, send]);
  const problem = text ? engine.deckPreview?.problem : undefined;

  // Functional updates: quick repeated clicks must each count.
  const change = (update: (old: Entry[]) => Entry[]) => { setEntries(update); setDirty(true); };
  const add = (card: CatalogCard) => {
    if (pickCommander) {
      change((old) => {
        if (partnerName && (old.filter(e => e.commander).length !== 1 || !old.some(e => e.commander && e.nameEn === partnerName))) return old;
        return [...old.filter(e => e.nameEn !== card.nameEn).map(e => !partnerName && e.commander ? { ...e, commander: false } : e), { ...card, qty: 1, commander: true }];
      });
      setPartnerOf(null);
      setPickCommander(false);
      return;
    }
    change((old) => {
      const existing = old.find((e) => e.nameEn === card.nameEn);
      // Commander is singleton: only basic lands go above one copy.
      if (existing && (existing.commander || !BASICS.has(card.nameEn))) return old;
      return existing ? old.map((e) => (e === existing ? { ...e, qty: e.qty + 1 } : e)) : [...old, { ...card, qty: 1, commander: false }];
    });
  };
  const same = (a: Entry, b: Entry) => a.imageKey === b.imageKey && a.commander === b.commander;
  const setQty = (entry: Entry, delta: number) => change((old) => old.flatMap((e) => {
    if (!same(e, entry)) return [e];
    return e.qty + delta <= 0 ? [] : [{ ...e, qty: e.qty + delta }];
  }));
  const toggleCommander = (entry: Entry) => change((old) => old.map((e) => (same(e, entry) ? { ...e, commander: !e.commander, qty: 1 } : !entry.commander && e.commander ? { ...e, commander: false } : e)));
  const choosePartner = () => {
    setView('cards'); setStatsFilter(null); setQuery(''); setColors(0); setCardType(''); setCmc(-1); setRules(''); setTypeText(''); setStatValue('');
    setPartnerOf(commanders[0].nameEn); setPickCommander(true);
  };

  // Printings: asked when the dialog opens; picking one swaps set, number and picture.
  useEffect(() => { if (printingsOf) send({ type: 'getPrintings', name: printingsOf.nameEn }); }, [printingsOf, send]);
  const printings = printingsOf && engine.printings?.name === printingsOf.nameEn ? engine.printings.printings : null;

  // Saving answers with a new deck list; a new name replaces the deck that was opened.
  const decksAtSave = useRef(engine.decks);
  useEffect(() => {
    if (!saving || engine.decks === decksAtSave.current || !engine.decks.mine.includes(name.trim())) return;
    if (initial && initial.name !== name.trim()) send({ type: 'deleteDeck', name: initial.name });
    onDone(name.trim());
  }, [saving, engine.decks, name, onDone, initial, send]);
  useEffect(() => { if (engine.error) setSaving(false); }, [engine.error]);

  const filteredEntries = entries.filter(e => !statsFilter || ((includeCommanders || !e.commander) && matchesDeckFilter(e, statsFilter)));
  const curve = CURVE.map((v) => entries.filter((e) => e.group !== 'land' && !e.commander && (v === 7 ? e.cmc >= 7 : e.cmc === v))
    .reduce((n, e) => n + e.qty, 0));
  const tallest = Math.max(1, ...curve);
  const picture = hovered ? cardImage(hovered.imageKey, 'full') : null;

  return (
    <main className="builder">
      <header className="import__head">
        <button type="button" className="btn btn--ghost" onClick={() => { if (!dirty || window.confirm(t('discardChanges'))) onDone(null); }}>{t('back')}</button>
        <input className="input decks__name" aria-label={t('deckName')} placeholder={t('deckName')} value={name} onChange={(e) => { setName(e.target.value); setDirty(true); }} />
        <span className={`builder__count ${problem ? 'danger' : ''}`} title={problem}>{count}/100</span>
        <button type="button" className="btn btn--primary" disabled={!name.trim() || !count || saving} onClick={() => {
          decksAtSave.current = engine.decks;
          setSaving(true);
          send({ type: 'saveDeck', text, name: name.trim(), from: initial?.name });
        }}>{t('save')}</button>
      </header>
      {engine.error && <p className="error" role="alert">{engine.error}</p>}

      <nav className="builder__views" aria-label={t('deck')}>
        <button type="button" className="btn btn--ghost" aria-pressed={view === 'cards'} onClick={() => { setView('cards'); setStatsFilter(null); }}>{t('catalogTab')}</button>
        <button type="button" className="btn btn--ghost" aria-pressed={view === 'stats'} onClick={() => setView('stats')}>{t('deckStatistics')}</button>
      </nav>
      <div className="builder__body">
        {view === 'stats' ? <DeckStatistics entries={entries} filter={statsFilter} onFilter={setStatsFilter} includeCommanders={includeCommanders} onIncludeCommanders={setIncludeCommanders} /> :
        <section className="builder__catalog" aria-label={t('searchCards')}>
          <div className="builder__filters">
            <input className="input builder__query" type="search" aria-label={t('searchCards')} placeholder={t('searchCards')} value={query} onChange={(e) => setQuery(e.target.value)} />
            <span className="builder__colors">
              {COLORS.map((c) => (
                <button key={c.key} type="button" className={`pip pip--${c.key === 'C' ? 'n' : c.key} builder__color`} aria-pressed={(colors & c.bit) !== 0}
                  aria-label={t(c.label)} title={t(c.label)} onClick={() => setColors(colors ^ c.bit)} />
              ))}
            </span>
            <select className="input" aria-label={t('cardTypeFilter')} value={cardType} onChange={(e) => setCardType(e.target.value)}>
              <option value="">{t('anyType')}</option>
              {GROUPS.filter((g) => g.id !== 'commander').map((g) => <option key={g.id} value={g.id}>{t(g.label)}</option>)}
            </select>
            <select className="input" aria-label={t('manaValue')} value={cmc} onChange={(e) => setCmc(Number(e.target.value))}>
              <option value={-1}>{t('anyCost')}</option>
              {CURVE.map((v) => <option key={v} value={v}>{v === 7 ? '7+' : v}</option>)}
            </select>
            <label className="online__check builder__toggle" title={t('commandersOnlyHint')}>
              <input type="checkbox" checked={pickCommander} onChange={(e) => { setPickCommander(e.target.checked); setPartnerOf(null); }} />{t('commandersOnly')}
            </label>
          </div>
          <details className="builder__more">
            <summary>{t('moreFilters')}{advanced > 0 && ` (${advanced})`}</summary>
            <div className="builder__filters">
              <input className="input" type="search" aria-label={t('rulesTextFilter')} placeholder={t('rulesTextFilter')} title={t('rulesTextHint')}
                value={rules} onChange={(e) => setRules(e.target.value)} />
              <input className="input" type="search" aria-label={t('typeLineFilter')} placeholder={t('typeLineFilter')} title={t('typeLineHint')}
                value={typeText} onChange={(e) => setTypeText(e.target.value)} />
              <span className="builder__stat">
                <select className="input" aria-label={t('statFilter')} value={stat} onChange={(e) => setStat(e.target.value as Stat)}>
                  {STATS.map((s) => <option key={s.id} value={s.id}>{t(s.label)}</option>)}
                </select>
                <select className="input" aria-label={t('statComparison')} value={statOp} onChange={(e) => setStatOp(e.target.value as StatOp)}>
                  {STAT_OPS.map((op) => <option key={op} value={op}>{op === '!=' ? '≠' : op === '<=' ? '≤' : op === '>=' ? '≥' : op}</option>)}
                </select>
                <input className="input" type="number" inputMode="numeric" aria-label={t('statValue')} value={statValue} onChange={(e) => setStatValue(e.target.value)} />
              </span>
            </div>
          </details>
          {partnerName && <div className="builder__partner-search" role="status">
            <span>{t('partnerFor', { name: commanders[0].name })}</span>
            <button type="button" className="btn btn--ghost" onClick={() => { setPartnerOf(null); setPickCommander(false); }}>{t('cancel')}</button>
          </div>}
          <ul className="builder__results">
            {shownResults.map((c) => (
              <li key={c.nameEn}>
                <InspectableCard as="button" card={cardForInspection(c)} className="builder__result" aria-label={t(partnerName ? 'addPartnerCard' : pickCommander ? 'setCommander' : 'addCard', { name: c.name })}
                  onClick={() => add(c)} onMouseEnter={() => setHovered(c)} onMouseLeave={() => setHovered(null)} onFocus={() => setHovered(c)}>
                  <img src={cardImage(c.imageKey, 'full') ?? undefined} alt="" loading="lazy" decoding="async" />
                  <span>{c.name}</span>
                </InspectableCard>
              </li>
            ))}
          </ul>
          {engine.cardResults && resultScope === searchScope && results.length < engine.cardResults.total && (
            <button type="button" className="btn btn--ghost builder__more" onClick={() => search(results.length)}>
              {t('moreResults', { n: engine.cardResults.total - results.length })}
            </button>
          )}
        </section>}

        <section className="builder__deck" aria-label={name || t('newDeck')}>
          {view === 'cards' && <div className="builder__curve" title={t('manaCurve')} aria-label={t('manaCurve')}>
            {curve.map((n, v) => (
              <span key={v} className="builder__bar">
                <span style={{ height: `${(n / tallest) * 100}%` }} title={`${v === 7 ? '7+' : v}: ${n}`} />
                <small>{v === 7 ? '7+' : v}</small>
              </span>
            ))}
          </div>}
          {statsFilter && <div className="builder__filter-status" role="status">
            <span>{t('filteredCards', { n: filteredEntries.reduce((n, e) => n + e.qty, 0) })}</span>
            <button type="button" className="btn btn--ghost" onClick={() => setStatsFilter(null)}>{t('clearStatsFilter')}</button>
          </div>}
          {statsFilter && !filteredEntries.length && <p className="muted">{t('noMatchingCards')}</p>}
          {GROUPS.map((g) => {
            const lines = filteredEntries.filter((e) => (g.id === 'commander' ? e.commander : !e.commander && e.group === g.id));
            if (!lines.length) return null;
            return (
              <section key={g.id} className="import__group">
                <div className="builder__group-head"><h2>{t(g.label)} <span className="muted">{lines.reduce((n, e) => n + e.qty, 0)}</span></h2>
                  {g.id === 'commander' && commanders.length === 1 && commanders[0].canPartner && <button type="button" className="btn btn--ghost" title={t('partnerHint')} onClick={choosePartner}>{t('addPartner')}</button>}
                </div>
                <ul className="import__lines builder__lines">
                  {lines.map((e) => (
                    <InspectableCard as="li" card={cardForInspection(e)} key={`${e.imageKey}:${e.commander}`} className="builder__line" onMouseEnter={() => setHovered(e)} onMouseLeave={() => setHovered(null)} onFocus={() => setHovered(e)}>
                      <button type="button" className="builder__step" aria-label={t('removeCard', { name: e.name })} onClick={() => setQty(e, -1)}>−</button>
                      <span className="import__qty">{e.qty}</span>
                      <span className="builder__name" title={`${e.name} · ${e.set} #${e.number}`}>{e.name}</span>
                      <span className="builder__cost" aria-hidden="true">
                        {manaSymbols(e.cost).map((s, i) => <span key={i} className={`pip pip--${/^\d+$/.test(s) ? 'n' : s.replace('/', '')}`}>{/^\d+$|^X$/.test(s) ? s : ''}</span>)}
                      </span>
                      {!e.commander && <button type="button" className="builder__step" aria-label={t('addCard', { name: e.name })}
                        disabled={e.qty >= 1 && !BASICS.has(e.nameEn)} title={e.qty >= 1 && !BASICS.has(e.nameEn) ? t('singleton') : undefined}
                        onClick={() => setQty(e, 1)}>+</button>}
                      {(e.canCommand || e.commander) && (
                        <button type="button" className="builder__step" aria-pressed={e.commander} title={t(e.commander ? 'unsetCommander' : 'setCommander', { name: e.name })}
                          aria-label={t(e.commander ? 'unsetCommander' : 'setCommander', { name: e.name })} onClick={() => toggleCommander(e)}><CrownIcon /></button>
                      )}
                      <button type="button" className="builder__step" title={t('changePrinting')} aria-label={t('changePrinting')} onClick={() => setPrintingsOf(e)}>
                        <ArtIcon /><span className="builder__edition">{e.set}</span>
                      </button>
                    </InspectableCard>
                  ))}
                </ul>
              </section>
            );
          })}
        </section>
      </div>

      {picture && <img className="import__picture" src={picture} alt="" aria-hidden="true" />}
      {printingsOf && <PrintingsDialog title={printingsOf.name} printings={printings} current={printingsOf.imageKey} onRetry={() => send({ type: 'getPrintings', name: printingsOf.nameEn })}
        onClose={() => setPrintingsOf(null)}
        onPick={(p) => { change((old) => replacePrinting(old, printingsOf, p)); setPrintingsOf(null); }} />}
    </main>
  );
}
