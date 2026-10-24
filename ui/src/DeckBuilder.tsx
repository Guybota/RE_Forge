import { useContext, useEffect, useMemo, useRef, useState } from 'react';
import { GROUPS } from './DeckCards';
import type { CatalogCard, DeckDetail } from './engine';
import { useT, type MessageKey } from './i18n';
import { cardImage } from './images';
import { CardZoom } from './table/CardZoom';
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

/** The decklist the engine reads back: commanders, then the deck, each with its exact printing. */
function decklist(entries: Entry[]) {
  const line = (e: Entry) => `${e.qty} ${e.nameEn} (${e.set}) ${e.number}`;
  const commanders = entries.filter((e) => e.commander).map(line);
  const deck = entries.filter((e) => !e.commander).map(line);
  return [commanders.length ? `Commander\n${commanders.join('\n')}` : '', deck.length ? `Deck\n${deck.join('\n')}` : ''].filter(Boolean).join('\n\n');
}

/** Build or change a Commander deck: catalog on the left, the deck on the right. */
export function DeckBuilder({ engine, initial, onDone }: { engine: Engine; initial?: DeckDetail; onDone: (saved: string | null) => void }) {
  const t = useT();
  const zoom = useContext(CardZoom);
  const { send } = engine;
  const [name, setName] = useState(initial?.name ?? '');
  const [entries, setEntries] = useState<Entry[]>(() => (initial?.lines ?? [])
    .filter((l) => l.nameEn && l.qty)
    .map((l) => ({ ...(l as CatalogCard), group: l.typeGroup ?? l.group ?? 'other', qty: l.qty ?? 1, commander: l.group === 'commander' })));
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
  const [results, setResults] = useState<CatalogCard[]>([]);
  const offset = useRef(0);
  const search = (from: number) => {
    offset.current = from;
    send({ type: 'searchCards', query, colors, cardType, cmc, offset: from, commanders: pickCommander,
      identity: commanders.length && !pickCommander ? identity : undefined });
  };
  useEffect(() => {
    const timer = setTimeout(() => search(0), 250);
    return () => clearTimeout(timer);
  }, [query, colors, cardType, cmc, pickCommander, identity]);
  useEffect(() => {
    const r = engine.cardResults;
    if (!r || r.offset !== offset.current) return;
    setResults((old) => (r.offset === 0 ? r.cards : [...old, ...r.cards]));
  }, [engine.cardResults]);

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
      change((old) => [...old.filter((e) => e.nameEn !== card.nameEn), { ...card, qty: 1, commander: true }]);
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
  const same = (a: Entry, b: Entry) => a.nameEn === b.nameEn && a.commander === b.commander;
  const setQty = (entry: Entry, delta: number) => change((old) => old.flatMap((e) => {
    if (!same(e, entry)) return [e];
    return e.qty + delta <= 0 ? [] : [{ ...e, qty: e.qty + delta }];
  }));
  const toggleCommander = (entry: Entry) => change((old) => old.map((e) => (same(e, entry) ? { ...e, commander: !e.commander, qty: 1 } : e)));

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

  const curve = CURVE.map((v) => entries.filter((e) => e.group !== 'land' && !e.commander && (v === 7 ? e.cmc >= 7 : e.cmc === v))
    .reduce((n, e) => n + e.qty, 0));
  const tallest = Math.max(1, ...curve);
  const picture = hovered ? cardImage(hovered.imageKey, 'full') : null;
  const zoomOn = (c: CatalogCard) => (e: React.MouseEvent) => { e.preventDefault(); zoom({ id: -1, name: c.name, imageKey: c.imageKey }); };

  return (
    <main className="builder">
      <header className="import__head">
        <button type="button" className="btn btn--ghost" onClick={() => { if (!dirty || window.confirm(t('discardChanges'))) onDone(null); }}>{t('back')}</button>
        <input className="input decks__name" aria-label={t('deckName')} placeholder={t('deckName')} value={name} onChange={(e) => { setName(e.target.value); setDirty(true); }} />
        <span className={`builder__count ${problem ? 'danger' : ''}`} title={problem}>{count}/100</span>
        <button type="button" className="btn btn--primary" disabled={!name.trim() || !count || saving} onClick={() => {
          decksAtSave.current = engine.decks;
          setSaving(true);
          send({ type: 'saveDeck', text, name: name.trim() });
        }}>{t('save')}</button>
      </header>
      {engine.error && <p className="error" role="alert">{engine.error}</p>}

      <div className="builder__body">
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
              <input type="checkbox" checked={pickCommander} onChange={(e) => setPickCommander(e.target.checked)} />{t('commandersOnly')}
            </label>
          </div>
          <ul className="builder__results">
            {results.map((c) => (
              <li key={c.nameEn}>
                <button type="button" className="builder__result" aria-label={t(pickCommander ? 'setCommander' : 'addCard', { name: c.name })}
                  onClick={() => add(c)} onContextMenu={zoomOn(c)} onMouseEnter={() => setHovered(c)} onMouseLeave={() => setHovered(null)}>
                  <img src={cardImage(c.imageKey, 'full') ?? undefined} alt="" loading="lazy" decoding="async" />
                  <span>{c.name}</span>
                </button>
              </li>
            ))}
          </ul>
          {engine.cardResults && results.length < engine.cardResults.total && (
            <button type="button" className="btn btn--ghost builder__more" onClick={() => search(results.length)}>
              {t('moreResults', { n: engine.cardResults.total - results.length })}
            </button>
          )}
        </section>

        <section className="builder__deck" aria-label={name || t('newDeck')}>
          <div className="builder__curve" title={t('manaCurve')} aria-label={t('manaCurve')}>
            {curve.map((n, v) => (
              <span key={v} className="builder__bar">
                <span style={{ height: `${(n / tallest) * 100}%` }} title={`${v === 7 ? '7+' : v}: ${n}`} />
                <small>{v === 7 ? '7+' : v}</small>
              </span>
            ))}
          </div>
          {GROUPS.map((g) => {
            const lines = entries.filter((e) => (g.id === 'commander' ? e.commander : !e.commander && e.group === g.id));
            if (!lines.length) return null;
            return (
              <section key={g.id} className="import__group">
                <h2>{t(g.label)} <span className="muted">{lines.reduce((n, e) => n + e.qty, 0)}</span></h2>
                <ul className="import__lines builder__lines">
                  {lines.map((e) => (
                    <li key={`${e.nameEn}${e.commander}`} className="builder__line" onMouseEnter={() => setHovered(e)} onMouseLeave={() => setHovered(null)} onContextMenu={zoomOn(e)}>
                      {!e.commander && <button type="button" className="builder__step" aria-label={t('removeCard', { name: e.name })} onClick={() => setQty(e, -1)}>−</button>}
                      <span className="import__qty">{e.qty}</span>
                      <span className="builder__name">{e.name}</span>
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
                        <ArtIcon />
                      </button>
                    </li>
                  ))}
                </ul>
              </section>
            );
          })}
        </section>
      </div>

      {picture && <img className="import__picture" src={picture} alt="" aria-hidden="true" />}
      {printingsOf && <PrintingsDialog title={printingsOf.name} printings={printings} current={printingsOf.set + printingsOf.number}
        onClose={() => setPrintingsOf(null)}
        onPick={(p) => { change((old) => old.map((e) => (same(e, printingsOf) ? { ...e, set: p.set, number: p.number, imageKey: p.imageKey } : e))); setPrintingsOf(null); }} />}
    </main>
  );
}

function PrintingsDialog({ title, printings, current, onClose, onPick }: {
  title: string;
  printings: { set: string; setName: string; number: string; imageKey: string }[] | null;
  current: string;
  onClose: () => void;
  onPick: (p: { set: string; number: string; imageKey: string }) => void;
}) {
  const t = useT();
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const dialog = ref.current;
    dialog?.showModal();
    return () => dialog?.close();
  }, []);
  return (
    <dialog ref={ref} className="choice game-menu zone" aria-labelledby="printings-title" onCancel={(e) => { e.preventDefault(); onClose(); }}>
      <header className="game-menu__head">
        <h2 id="printings-title" className="choice__title">{title}</h2>
        <button type="button" className="btn btn--ghost" onClick={onClose} autoFocus>{t('close')}</button>
      </header>
      <ul className="game-menu__body builder__printings">
        {printings === null ? <li className="muted">{t('connecting')}</li> : printings.map((p) => (
          <li key={p.set + p.number}>
            <button type="button" className={`builder__result ${p.set + p.number === current ? 'is-on' : ''}`} aria-pressed={p.set + p.number === current}
              title={`${p.setName} #${p.number}`} onClick={() => onPick(p)}>
              <img src={cardImage(p.imageKey, 'full') ?? undefined} alt="" loading="lazy" decoding="async" />
              <span>{p.setName}</span>
            </button>
          </li>
        ))}
      </ul>
    </dialog>
  );
}
