import { useEffect, useMemo, useRef, useState } from 'react';
import { deckFromLines } from './deckTools/cardVisual';
import { rankComboCuts } from './deckTools/combo-cuts';
import { canonicalizeName } from './deckTools/parse-decklist';
import { addAndCut, swapPrinting } from './deckText';
import type { CheaperOffer, DeckDetail, DeckPreview, EdhrecCombo } from './engine';
import { useT, type MessageKey } from './i18n';
import { cardImage } from './images';
import { InspectableCard } from './table/CardInspection';
import { cardForInspection } from './table/useCardInspection';
import type { Engine } from './useEngine';
import { nextRequestId, reply, useRequest } from './deckRequests';

type Line = DeckPreview['lines'][number];
type ComboFilter = 'near' | 'ready' | 'all';
type ComboFace = { nameEn: string; name: string; imageKey?: string; imageUrl?: string };

const euros = (n: number) => new Intl.NumberFormat(document.documentElement.lang || undefined, { style: 'currency', currency: 'EUR' }).format(n);
const key = (n: string) => n.toLowerCase();
/** EDHREC writes two-faced cards in full ("A // B"); Forge names them by the front face. */
const front = (n: string) => key(n.split(' // ')[0]);
const FILTERS: { id: ComboFilter; label: MessageKey }[] = [
  { id: 'near', label: 'comboFilterNear' },
  { id: 'ready', label: 'comboFilterReady' },
  { id: 'all', label: 'comboFilterAll' },
];
const matchesFilter = (missing: number, filter: ComboFilter) =>
  filter === 'all' || (filter === 'ready' ? missing === 0 : missing === 1);

export function Unavailable({ onRetry }: { onRetry: () => void }) {
  const t = useT();
  return <p className="deck-online__status" role="alert">
    <span className="deck-analysis__warn">{t('servicesUnavailable')}</span>
    <button type="button" className="btn btn--ghost" onClick={onRetry}>{t('servicesRetry')}</button>
  </p>;
}

/** Cardmarket EUR for the deck's exact printings, and cheaper printings Forge also has. */
export function DeckPrices({ detail, engine, source = 'mine' }: { detail: DeckDetail; engine: Engine; source?: 'mine' | 'precon' }) {
  const t = useT();
  const { send } = engine;
  const prices = useRequest((requestId) => send({ type: 'deckPrices', requestId, name: detail.name, source }), [detail, source, send]);
  const answer = reply(engine, 'deckPrices', prices.id.current);

  const rows = useMemo(() => {
    if (answer?.type !== 'deckPrices') return null;
    const byPrinting = new Map(answer.prices.map((p) => [`${p.set}/${p.number}`, p]));
    return detail.lines.filter((l) => l.nameEn && l.qty && l.set).map((l) => ({ line: l, price: byPrinting.get(`${l.set}/${l.number}`) }))
      .sort((a, b) => (b.price?.eur ?? -1) * (b.line.qty ?? 1) - (a.price?.eur ?? -1) * (a.line.qty ?? 1));
  }, [answer, detail]);
  const counted = rows?.filter((r) => !r.line.sideboard && !r.line.maybeboard) ?? [];
  const total = counted.reduce((sum, r) => sum + (r.price?.eur ?? 0) * (r.line.qty ?? 1), 0);
  const unpriced = counted.filter((r) => r.price?.eur == null).reduce((n, r) => n + (r.line.qty ?? 1), 0);
  const approximate = counted.filter((r) => r.price && !r.price.exact && r.price.eur != null).length;

  return (
    <div className="deck-analysis">
      <section className="deck-analysis__panel" aria-labelledby="deck-prices">
        <h2 id="deck-prices" title={t('pricesHint')}>{t('pricesTitle')}</h2>
        {answer?.type === 'servicesError' ? <Unavailable onRetry={prices.retry} />
          : !rows ? <p className="muted" role="status">{t('pricesLoading')}</p>
          : <>
            <p className="deck-analysis__bracket"><strong>{euros(total)}</strong></p>
            {unpriced > 0 && <p className="muted">{t('pricesUnpriced', { n: unpriced })}</p>}
            {approximate > 0 && <p className="muted">{t('pricesApprox', { n: approximate })}</p>}
          </>}
      </section>
      <CheaperPrintings detail={detail} engine={engine} source={source} />
      {rows && rows.length > 0 && (
        <section className="deck-analysis__panel deck-analysis__hand" aria-labelledby="deck-price-list">
          <h2 id="deck-price-list">{t('pricesByCard')}</h2>
          <div className="deck-online__scroll"><table className="deck-online__table">
            <thead><tr><th scope="col">{t('priceQty')}</th><th scope="col">{t('priceCard')}</th><th scope="col">{t('priceSet')}</th><th scope="col">{t('priceEach')}</th></tr></thead>
            <tbody>{rows.map(({ line, price }, i) => (
              <tr key={i}>
                <td>{line.qty}</td>
                <td><InspectableCard as="span" card={line.imageKey ? cardForInspection(line) : null}>{line.name}{line.maybeboard ? ` · ${t('groupMaybeboard')}` : line.sideboard ? ` · ${t('groupSideboard')}` : ''}</InspectableCard></td>
                <td>{line.set} {line.number}</td>
                <td title={price && !price.exact ? t('priceApproxHint') : undefined}>{price?.eur == null ? '—' : `${euros(price.eur)}${price.exact ? '' : ' *'}`}</td>
              </tr>
            ))}</tbody>
          </table></div>
        </section>
      )}
    </div>
  );
}

function CheaperPrintings({ detail, engine, source }: { detail: DeckDetail; engine: Engine; source: 'mine' | 'precon' }) {
  const t = useT();
  const [id, setId] = useState(0);
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const progress = reply(engine, 'cheaperProgress', id);
  const answer = reply(engine, 'cheaperPrintings', id);
  const found = answer?.type === 'cheaperPrintings' && answer.name === detail.name ? answer.offers : null;
  const busy = id > 0 && !answer;
  const offerKey = (o: CheaperOffer) => `${o.nameEn}|${o.from.set}|${o.from.number}`;
  const copies = (o: CheaperOffer) => detail.lines.filter((l) => l.nameEn === o.nameEn && l.set === o.from.set && l.number === o.from.number)
    .reduce((n, l) => n + (l.qty ?? 1), 0) || 1;
  const saving = (o: CheaperOffer) => (o.from.eur - o.to.eur) * copies(o);
  const offers = found && [...found].sort((a, b) => saving(b) - saving(a));
  const chosen = offers?.filter((o) => picked.has(offerKey(o))) ?? [];
  const find = () => {
    const requestId = nextRequestId();
    setId(requestId);
    setPicked(new Set());
    engine.send({ type: 'cheaperPrintings', requestId, name: detail.name, source });
  };
  const apply = () => {
    const text = chosen.reduce((text, o) => swapPrinting(text, o.nameEn, o.from, o.to), detail.text);
    setId(0);
    setPicked(new Set());
    engine.send({ type: 'saveDeck', text, name: detail.name, from: detail.name });
    engine.send({ type: 'getDeck', name: detail.name });
  };
  return (
    <section className="deck-analysis__panel" aria-labelledby="deck-cheaper">
      <header className="deck-analysis__head">
        <h2 id="deck-cheaper" title={t('cheaperHint')}>{t('cheaperTitle')}</h2>
        <button type="button" className="btn btn--ghost" disabled={busy} onClick={find}>{t('cheaperFind')}</button>
      </header>
      {busy && <p className="muted" role="status">{progress?.type === 'cheaperProgress' && progress.total > 0
        ? t('cheaperProgress', { done: progress.done, total: progress.total }) : t('pricesLoading')}</p>}
      {answer?.type === 'servicesError' && <Unavailable onRetry={find} />}
      {offers && offers.length === 0 && <p>{t('cheaperNone')}</p>}
      {offers && offers.length > 0 && <>
        <div className="deck-analysis__head">
          <button type="button" className="btn btn--ghost" onClick={() => setPicked(new Set(offers.map(offerKey)))}>{t('cheaperSelectAll')}</button>
          <button type="button" className="btn btn--ghost" onClick={() => setPicked(new Set())}>{t('cheaperSelectNone')}</button>
          {source === 'mine' && <button type="button" className="btn btn--primary" disabled={!chosen.length} onClick={apply}>{t('cheaperApply', { n: chosen.length })}</button>}
        </div>
        {chosen.length > 0 && <p>{t('cheaperSaving', { amount: euros(chosen.reduce((s, o) => s + saving(o), 0)) })}</p>}
        <ul className="deck-online__offers">{offers.map((o) => {
          const k = offerKey(o);
          const src = o.to.imageKey ? cardImage(o.to.imageKey, 'full') : null;
          return <li key={k}><label>
            <input type="checkbox" checked={picked.has(k)} onChange={() => setPicked((all) => {
              const next = new Set(all);
              if (!next.delete(k)) next.add(k);
              return next;
            })} />
            {src && <img src={src} alt="" loading="lazy" />}
            <span><strong>{copies(o) > 1 ? `${copies(o)} × ${o.name}` : o.name}</strong>
              <span className="muted">{`${o.from.set} ${o.from.number} · ${euros(o.from.eur)} → ${o.to.set} ${o.to.number} · ${euros(o.to.eur)}`}</span>
              <span>{t('cheaperSaves', { amount: euros(saving(o)) })}</span></span>
          </label></li>;
        })}</ul>
      </>}
    </section>
  );
}

/** The commanders' combos from EDHREC, which of their cards the deck has, how they play, and adding one. */
export function DeckCombos({ detail, engine, source = 'mine' }: { detail: DeckDetail; engine: Engine; source?: 'mine' | 'precon' }) {
  const t = useT();
  const { send } = engine;
  const hasCommander = detail.lines.some((l) => l.group === 'commander');
  const combos = useRequest((requestId) => { if (hasCommander) send({ type: 'deckCombos', requestId, name: detail.name, source }); }, [detail.name, source, hasCommander, send]);
  const answer = reply(engine, 'deckCombos', combos.id.current);
  const lines = useMemo(() => {
    const map = new Map<string, Line>();
    for (const l of detail.lines) if (l.nameEn && !l.sideboard && !l.maybeboard) { map.set(key(l.nameEn), l); map.set(front(l.nameEn), l); }
    return map;
  }, [detail]);
  const has = (n: string) => lines.has(key(n)) || lines.has(front(n));
  const [filter, setFilter] = useState<ComboFilter>('near');
  const [shown, setShown] = useState<Record<string, number>>({});
  const [explained, setExplained] = useState<string | null>(null);
  const [adding, setAdding] = useState<EdhrecCombo | null>(null);

  const outside = useMemo(() => {
    if (answer?.type !== 'deckCombos') return [] as string[];
    const names = new Set<string>();
    for (const g of answer.groups) for (const combo of g.combos.slice(0, 48)) {
      for (const n of combo.cardNames) if (!has(n)) names.add(n.split(' // ')[0]);
    }
    return [...names].sort();
  }, [answer, lines]);
  const cardsRequest = useRequest((requestId) => { if (outside.length) send({ type: 'cardsByName', requestId, names: outside }); }, [outside.join('|'), send]);
  const cardsAnswer = reply(engine, 'cardsByName', cardsRequest.id.current);
  const faces = useMemo(() => {
    const map = new Map<string, ComboFace>();
    for (const l of detail.lines) {
      if (!l.nameEn || l.sideboard || l.maybeboard) continue;
      const face = { nameEn: l.nameEn, name: l.name ?? l.nameEn, imageKey: l.imageKey, imageUrl: l.imageUrl };
      map.set(canonicalizeName(l.nameEn), face);
      map.set(canonicalizeName(l.nameEn.split(' // ')[0]), face);
    }
    if (cardsAnswer?.type === 'cardsByName') for (const c of cardsAnswer.cards) {
      const face = { nameEn: c.nameEn, name: c.name, imageKey: c.imageKey, imageUrl: c.imageUrl };
      map.set(canonicalizeName(c.nameEn), face);
      map.set(canonicalizeName(c.nameEn.split(' // ')[0]), face);
    }
    return map;
  }, [detail, cardsAnswer]);
  const faceOf = (n: string) => faces.get(canonicalizeName(n)) ?? faces.get(canonicalizeName(n.split(' // ')[0]));

  if (!hasCommander) return <p className="muted">{t('comboNoCommander')}</p>;
  return (
    <div className="deck-online">
      {answer?.type === 'servicesError' ? <Unavailable onRetry={combos.retry} />
        : answer?.type !== 'deckCombos' ? <p className="muted" role="status">{t('combosLoading')}</p>
        : <>
          {answer.missing.map((c) => <p key={c} className="muted">{t('combosNone', { commander: lines.get(key(c))?.name ?? c })}</p>)}
          {answer.groups.map((g) => {
            const commanderLine = lines.get(key(g.commander)) ?? lines.get(front(g.commander));
            const commanderName = commanderLine?.name ?? g.commander;
            const commanderArt = commanderLine?.imageKey ? cardImage(commanderLine.imageKey, 'crop') : null;
            const counted = { near: 0, ready: 0, all: g.combos.length };
            for (const combo of g.combos) {
              const missing = combo.cardNames.filter((n) => !has(n)).length;
              if (missing === 0) counted.ready += 1;
              if (missing === 1) counted.near += 1;
            }
            const filtered = g.combos.filter((combo) => matchesFilter(combo.cardNames.filter((n) => !has(n)).length, filter));
            const limit = shown[g.commander] ?? 12;
            return <section key={g.commander} className="deck-analysis__panel deck-combos" aria-label={commanderName}>
              <header className="deck-combos__head">
                {commanderArt && <img className="deck-combos__commander" src={commanderArt} alt="" />}
                <div className="deck-combos__title">
                  <h2 title={t('combosHint')}>{t('combosCount', { total: g.total.toLocaleString(document.documentElement.lang || undefined), commander: commanderName })}</h2>
                  <p className="muted">{t('combosLead')}</p>
                </div>
                <a className="btn btn--ghost" href={g.url} target="_blank" rel="noreferrer">{t('combosOpen')}</a>
              </header>
              {g.combos.length > 0 && <div className="deck-combos__filters" role="group" aria-label={t('comboFilters')}>
                {FILTERS.map((f) => (
                  <button key={f.id} type="button" className="btn btn--ghost" aria-pressed={filter === f.id}
                    onClick={() => { setFilter(f.id); setShown((s) => ({ ...s, [g.commander]: 12 })); }}>
                    {t(f.label)} <span className="muted">{counted[f.id]}</span>
                  </button>
                ))}
              </div>}
              {g.combos.length === 0 && <p className="muted">{t('combosNone', { commander: commanderName })}</p>}
              {g.combos.length > 0 && filtered.length === 0 && <p className="muted">{t('comboFilterEmpty')}</p>}
              <ul className="deck-online__combos">{filtered.slice(0, limit).map((combo) => {
                const missing = combo.cardNames.filter((n) => !has(n));
                const have = combo.cardNames.length - missing.length;
                const open = explained === combo.href;
                const results = combo.results.length ? combo.results : [combo.cardNames.join(' + ')];
                return <li key={combo.id} className={`deck-combo${missing.length ? '' : ' is-complete'}`}>
                  <ul className="deck-combo__faces" aria-label={t('comboCards')}>
                    {combo.cardNames.map((n) => {
                      const owned = has(n);
                      const face = faceOf(n);
                      const src = face?.imageKey ? cardImage(face.imageKey, 'full') : face?.imageUrl ?? null;
                      const label = face?.name ?? n;
                      return <InspectableCard as="li" key={n} card={face?.imageKey ? cardForInspection({ name: face.name, imageKey: face.imageKey }) : null}
                        className={`deck-combo__face${owned ? ' is-owned' : ' is-needed'}`}
                        title={owned ? t('comboInDeck') : t('comboNeeded')}>
                        {src ? <img src={src} alt={label} loading="lazy" decoding="async" /> : <span className="deck-combo__fallback">{label}</span>}
                        <span className="deck-combo__mark">{owned ? t('comboMarkHave') : t('comboMarkNeed')}</span>
                      </InspectableCard>;
                    })}
                    {combo.pieces.map((p) => (
                      <li key={p} className="deck-combo__face deck-combo__face--piece" lang="en" title={t('comboPieceHint')}>
                        <span className="deck-combo__fallback">{t('comboPiece', { name: p })}</span>
                      </li>
                    ))}
                  </ul>
                  <div className="deck-combo__body">
                    <ul className="deck-combo__results" lang="en">
                      {results.map((r) => <li key={r}>{r}</li>)}
                    </ul>
                    <div className="deck-combo__meta">
                      <span className={`deck-combo__progress${missing.length ? '' : ' is-ready'}`}>
                        {missing.length ? t('comboHave', { have, total: combo.cardNames.length }) : t('comboComplete')}
                        {combo.decks > 0 && <span className="muted"> · {t('comboDecks', { n: combo.decks.toLocaleString(document.documentElement.lang || undefined) })}</span>}
                      </span>
                      <button type="button" className="btn btn--ghost" aria-expanded={open} onClick={() => setExplained(open ? null : combo.href)}>{t('comboExplain')}</button>
                      {source === 'mine' && missing.length > 0 && <button type="button" className="btn btn--primary" onClick={() => setAdding(combo)}>{t('comboAdd')}</button>}
                    </div>
                    {open && <ComboExplanation href={combo.href} engine={engine} />}
                  </div>
                </li>;
              })}</ul>
              {limit < filtered.length && <button type="button" className="btn btn--ghost" onClick={() => setShown((s) => ({ ...s, [g.commander]: limit + 12 }))}>{t('combosMore')}</button>}
            </section>;
          })}
        </>}
      {adding && <AddCombo combo={adding} detail={detail} has={has} onClose={() => setAdding(null)} onApply={(add, cut) => {
        setAdding(null);
        send({ type: 'saveDeck', text: addAndCut(detail.text, add, cut), name: detail.name, from: detail.name });
        send({ type: 'getDeck', name: detail.name });
      }} />}
    </div>
  );
}

function ComboExplanation({ href, engine }: { href: string; engine: Engine }) {
  const t = useT();
  const { send } = engine;
  const request = useRequest((requestId) => send({ type: 'comboDetail', requestId, href }), [href, send]);
  const answer = reply(engine, 'comboDetail', request.id.current);
  if (answer?.type === 'servicesError') return <Unavailable onRetry={request.retry} />;
  if (answer?.type !== 'comboDetail') return <p className="muted" role="status">{t('combosLoading')}</p>;
  return <div className="deck-online__explanation" lang="en" title={t('comboExplainHint')}>
    {answer.prerequisites.length > 0 && <><h3>{t('comboPrerequisites')}</h3><ul>{answer.prerequisites.map((p, i) => <li key={i}>{p}</li>)}</ul></>}
    {answer.steps.length > 0 && <><h3>{t('comboSteps')}</h3><ol>{answer.steps.map((s, i) => <li key={i}>{s}</li>)}</ol></>}
  </div>;
}

function AddCombo({ combo, detail, has, onClose, onApply }: {
  combo: EdhrecCombo; detail: DeckDetail; has: (name: string) => boolean;
  onClose: () => void; onApply: (add: string[], cut: string[]) => void;
}) {
  const t = useT();
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const dialog = ref.current;
    dialog?.showModal();
    return () => dialog?.close();
  }, []);
  const missing = combo.cardNames.filter((n) => !has(n));
  const { deck, visuals } = useMemo(() => deckFromLines(detail.name, detail.lines, detail.identity), [detail]);
  const ranked = useMemo(() => rankComboCuts(deck, (n) => visuals.get(n), combo.cardNames), [deck, visuals, combo]);
  const names = new Map(detail.lines.filter((l) => l.nameEn).map((l) => [l.nameEn!, l]));
  const [cuts, setCuts] = useState<string[]>(() => ranked.slice(0, missing.length).map((c) => c.name));
  return (
    <dialog ref={ref} className="choice game-menu zone deck-online__dialog" aria-labelledby="add-combo-title" onCancel={(e) => { e.preventDefault(); onClose(); }}>
      <header className="game-menu__head">
        <h2 id="add-combo-title" className="choice__title">{t('comboAdd')}</h2>
        <button type="button" className="btn btn--ghost" onClick={onClose}>{t('close')}</button>
      </header>
      <div className="game-menu__body deck-online__dialog-body">
        <h3>{t('comboAddCards')}</h3>
        <ul className="deck-analysis__names" lang="en">{missing.map((n) => <li key={n} className="deck-analysis__name">{n}</li>)}</ul>
        {combo.pieces.length > 0 && <p className="muted">{t('comboAddPieces', { pieces: combo.pieces.join(', ') })}</p>}
        <h3>{t('comboCutCards', { n: missing.length, picked: cuts.length })}</h3>
        <ul className="deck-online__cuts">{ranked.slice(0, Math.max(12, missing.length * 4)).map((c) => {
          const on = cuts.includes(c.name);
          return <li key={c.name}><label>
            <input type="checkbox" checked={on} disabled={!on && cuts.length >= missing.length}
              onChange={() => setCuts((all) => on ? all.filter((n) => n !== c.name) : [...all, c.name])} />
            {names.get(c.name)?.name ?? c.name}
          </label></li>;
        })}</ul>
        <div className="deck-analysis__head">
          <button type="button" className="btn btn--ghost" onClick={() => onApply(missing, [])}>{t('comboAddOnly')}</button>
          <button type="button" className="btn btn--primary" disabled={cuts.length !== missing.length} onClick={() => onApply(missing, cuts)}>{t('comboAddAndCut')}</button>
        </div>
      </div>
    </dialog>
  );
}
