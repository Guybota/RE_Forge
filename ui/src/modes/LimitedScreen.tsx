import { useEffect, useMemo, useState } from 'react';
import type { CatalogCard, LimitedEvent, LimitedMode, PoolCard } from '../engine';
import { useT } from '../i18n';
import { cardImage } from '../images';
import { manaSymbols } from '../table/cards';
import { InspectableCard } from '../table/CardInspection';
import { cardForInspection } from '../table/useCardInspection';
import type { Engine } from '../useEngine';
import './modes.css';

const COLOR_ORDER = [1, 2, 4, 8, 16];
const PIPS = ['W', 'U', 'B', 'R', 'G'];
const key = (c: { nameEn: string; set: string; number: string }) => `${c.nameEn}|${c.set}|${c.number}`;
/** White, blue, black, red, green, then multicolour, then colourless; cheaper first. */
const colorRank = (c: CatalogCard) => {
  const single = COLOR_ORDER.indexOf(c.colors);
  return single >= 0 ? single : c.colors ? 5 : 6;
};
const byColor = (a: CatalogCard, b: CatalogCard) => colorRank(a) - colorRank(b) || (a.group === 'land' ? 1 : 0) - (b.group === 'land' ? 1 : 0) || a.cmc - b.cmc || a.name.localeCompare(b.name);

/** Draft and Sealed: saved events, the draft itself, deck building from the pool and games against the AI decks. */
export function LimitedScreen({ mode, engine, onBack }: { mode: LimitedMode; engine: Engine; onBack: () => void }) {
  const t = useT();
  const { send, modes } = engine;
  // 'event' shows the open event (also after a game, when the result arrives); 'list' the saved events.
  const [view, setView] = useState<'event' | 'list'>('event');
  const [set, setSet] = useState('');
  useEffect(() => {
    send({ type: 'limited', action: 'sets' });
    send({ type: 'limited', action: 'events' });
    if (mode === 'draft') send({ type: 'limited', action: 'draft' });
  }, [send, mode]);
  const sets = modes.sets ?? [];
  useEffect(() => { if (!set && sets.length) setSet(sets[0].code); }, [set, sets]);
  const draft = mode === 'draft' ? modes.draft : null;
  const event = view === 'event' && modes.event?.mode === mode ? modes.event : null;
  const events = (modes.events ?? []).filter((e) => e.mode === mode);
  const toList = () => { setView('list'); send({ type: 'limited', action: 'events' }); };

  return (
    <main className="campaign">
      <header className="campaign__head">
        <button className="btn btn--ghost" type="button" onClick={onBack}>{t('mainMenu')}</button>
        <div><span className="campaign__mode">{t(mode === 'draft' ? 'draftMode' : 'sealedMode')}</span><h1>{event?.name ?? (draft && view === 'event' ? sets.find((s) => s.code === draft.set)?.name ?? draft.set : t('limitedEvents'))}</h1></div>
        {(event || draft) && <button type="button" className="btn btn--ghost" onClick={toList}>{t('limitedEvents')}</button>}
      </header>
      {engine.error && <p className="error" role="alert">{engine.error}</p>}
      {draft && view === 'event' ? <DraftView engine={engine} />
        : event ? <EventView key={event.id} engine={engine} event={event} />
        : <div className="campaign__library">
          <section className="campaign__saves" aria-label={t('limitedEvents')}>
            {draft && <button type="button" className="btn btn--primary" onClick={() => setView('event')}>{t('continueDraft')}</button>}
            {events.length === 0 && <p className="muted">{t('limitedEmpty')}</p>}
            {events.map((e) => <div className="campaign__save-row" key={e.id}>
              <button type="button" className="campaign__save" onClick={() => { setView('event'); send({ type: 'limited', action: 'open', id: e.id }); }}>
                <strong>{e.name}</strong>
                <span>{e.built ? t('eventRecord', { wins: e.wins, losses: e.losses }) : t('notBuilt')}</span>
              </button>
              <button type="button" className="btn btn--ghost" aria-label={t('deleteEventNamed', { name: e.name })}
                onClick={() => { if (window.confirm(t('confirmDelete', { name: e.name }))) send({ type: 'limited', action: 'delete', id: e.id }); }}>{t('deleteEvent')}</button>
            </div>)}
          </section>
          <form className="modes__new" onSubmit={(e) => {
            e.preventDefault();
            setView('event');
            send({ type: 'limited', action: mode === 'draft' ? 'newDraft' : 'newSealed', set });
          }}>
            <h2>{t('newEvent')}</h2>
            <label className="field-label">{t('chooseSet')}
              <select className="input" value={set} onChange={(e) => setSet(e.target.value)}>
                {sets.map((s) => <option key={s.code} value={s.code}>{s.name} ({s.year})</option>)}
              </select>
            </label>
            <button type="submit" className="btn btn--primary" disabled={!set}>{t('startEvent')}</button>
          </form>
        </div>}
    </main>
  );
}

function CardTile({ card, label, onClick, onDoubleClick, selected, count }: {
  card: CatalogCard; label: string; onClick: () => void; onDoubleClick?: () => void; selected?: boolean; count?: number;
}) {
  return (
    <InspectableCard as="button" card={cardForInspection(card)} className={`builder__result ${selected ? 'is-on' : ''}`} aria-label={label} aria-pressed={selected}
      onClick={onClick} onDoubleClick={onDoubleClick} title={card.name}>
      <img src={cardImage(card.imageKey, 'full') ?? undefined} alt="" loading="lazy" decoding="async" />
      {count !== undefined && count > 1 && <span className="modes__count">×{count}</span>}
    </InspectableCard>
  );
}

function DraftView({ engine }: { engine: Engine }) {
  const t = useT();
  const draft = engine.modes.draft!;
  const [chosen, setChosen] = useState<number | null>(null);
  // A new pack clears the selection.
  useEffect(() => setChosen(null), [draft.picks]);
  const pick = (index: number) => engine.send({ type: 'limited', action: 'pick', index });
  const picked = [...draft.picked].sort(byColor);
  const count = picked.reduce((n, c) => n + c.qty, 0);
  return (
    <div className="modes__split">
      <section aria-label={t('draftPack', { round: draft.round, rounds: draft.rounds, pick: draft.picks + 1 })}>
        <div className="modes__toolbar">
          <h2 title={t('pickHint')}>{t('draftPack', { round: draft.round, rounds: draft.rounds, pick: draft.picks + 1 })}</h2>
          <button type="button" className="btn btn--primary" disabled={chosen === null} onClick={() => chosen !== null && pick(chosen)}>{t('pickCard')}</button>
        </div>
        <div className="builder__results modes__grid">
          {draft.pack.map((c) => <CardTile key={c.index} card={c} label={t('pickCardNamed', { name: c.name })}
            selected={chosen === c.index} onClick={() => setChosen(c.index!)} onDoubleClick={() => pick(c.index!)} />)}
        </div>
      </section>
      <aside className="modes__side">
        <h2>{t('pickedCards', { n: count })}</h2>
        <ul className="modes__lines">{picked.map((c) => <DeckLine key={key(c)} card={c} />)}</ul>
      </aside>
    </div>
  );
}

function DeckLine({ card, onClick, label }: { card: PoolCard; onClick?: () => void; label?: string }) {
  const content = <>
    <span className="import__qty">{card.qty}</span>
    <span className="modes__line-name">{card.name}</span>
    <span className="builder__cost">{manaSymbols(card.cost).map((s, i) => <span key={i} className={`pip pip--${/^\d+$/.test(s) ? 'n' : s.replace('/', '')}`}>{/^\d+$|^X$/.test(s) ? s : ''}</span>)}</span>
  </>;
  return <li className="modes__line"><InspectableCard as={onClick ? 'button' : 'div'} card={cardForInspection(card)} aria-label={label} onClick={onClick}>{content}</InspectableCard></li>;
}

function EventView({ engine, event }: { engine: Engine; event: LimitedEvent }) {
  const t = useT();
  // The deck being edited, by exact printing; the saved one comes back with every save.
  const [deck, setDeck] = useState(() => new Map(event.main.map((c) => [key(c), c])));
  const [dirty, setDirty] = useState(false);
  useEffect(() => { setDeck(new Map(event.main.map((c) => [key(c), c]))); setDirty(false); }, [event]);
  const change = (card: CatalogCard, delta: number) => {
    setDeck((current) => {
      const next = new Map(current);
      const k = key(card), qty = (next.get(k)?.qty ?? 0) + delta;
      if (qty <= 0) next.delete(k); else next.set(k, { ...card, qty });
      return next;
    });
    setDirty(true);
  };
  const inDeck = (c: CatalogCard) => deck.get(key(c))?.qty ?? 0;
  const basics = new Set(event.lands.map(key));
  // Pool cards not yet in the deck (basic lands are free and never leave the pool).
  const pool = useMemo(() => event.pool.map((c) => ({ ...c, qty: basics.has(key(c)) ? c.qty : c.qty - inDeck(c) }))
    .filter((c) => c.qty > 0).sort(byColor), [event.pool, deck]); // eslint-disable-line react-hooks/exhaustive-deps
  const main = [...deck.values()].sort(byColor);
  const total = main.reduce((n, c) => n + c.qty, 0);
  const poolCount = pool.reduce((n, c) => n + c.qty, 0);
  const save = () => engine.send({ type: 'limited', action: 'saveDeck', id: event.id,
    main: main.map((c) => ({ nameEn: c.nameEn, set: c.set, number: c.number, qty: c.qty })) });
  const playable = !dirty && total >= 40 && !event.problem;

  return (
    <div className="modes__split">
      <section aria-label={t('poolCards', { n: poolCount })}>
        <h2>{t('poolCards', { n: poolCount })}</h2>
        <div className="builder__results modes__grid">
          {pool.map((c) => <CardTile key={key(c)} card={c} count={c.qty} label={t('addToDeck', { name: c.name })} onClick={() => change(c, 1)} />)}
        </div>
      </section>
      <aside className="modes__side">
        <div className="modes__toolbar">
          <h2>{t('limitedDeck', { n: total })}</h2>
          <button type="button" className="btn btn--primary" disabled={!dirty} onClick={save}>{t('save')}</button>
        </div>
        {dirty && <p className="muted" role="status">{t('unsavedDeck')}</p>}
        {!dirty && event.problem && total > 0 && <p className="import__problem" title={event.problem}>{t('notLegal')}</p>}
        <ul className="modes__lines">
          {main.filter((c) => !basics.has(key(c))).map((c) => <DeckLine key={key(c)} card={c} label={t('removeFromDeck', { name: c.name })} onClick={() => change(c, -1)} />)}
        </ul>
        <h3>{t('basicLands')}</h3>
        <ul className="modes__lands">
          {event.lands.map((land) => <li key={key(land)}>
            <span>{land.name}</span>
            <button type="button" className="builder__step" aria-label={t('lessLand', { name: land.name })} disabled={!inDeck(land)} onClick={() => change(land, -1)}>−</button>
            <span className="import__qty">{inDeck(land)}</span>
            <button type="button" className="builder__step" aria-label={t('moreLand', { name: land.name })} onClick={() => change(land, 1)}>+</button>
          </li>)}
        </ul>
        <h3 title={t('opponentsHint')}>{t('opponents')}</h3>
        {!playable && <p className="muted">{t('buildFirst')}</p>}
        <ul className="modes__opponents">
          {event.opponents.map((o) => <li key={o.index}>
            <span>{t('opponentN', { n: o.index + 1 })}</span>
            <span className="builder__cost" aria-hidden="true">{COLOR_ORDER.map((bit, i) => o.colors & bit ? <span key={bit} className={`pip pip--${PIPS[i]}`} /> : null)}</span>
            {o.result && <span className={o.result === 'won' ? 'modes__won' : 'modes__lost'}>{t(o.result === 'won' ? 'resultWon' : 'resultLost')}</span>}
            <button type="button" className="btn btn--ghost" disabled={!playable} aria-label={t('playOpponentNamed', { n: o.index + 1 })}
              onClick={() => engine.send({ type: 'limited', action: 'play', id: event.id, opponent: o.index })}>{t('playOpponent')}</button>
          </li>)}
        </ul>
      </aside>
    </div>
  );
}
