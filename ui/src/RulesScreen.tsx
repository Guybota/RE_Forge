import { useEffect, useRef, useState, type ReactNode } from 'react';
import { CardBeside } from './DeckCards';
import { reply, useRequest } from './deckRequests';
import { Unavailable } from './DeckOnline';
import type { CatalogCard } from './engine';
import { useT, type MessageKey } from './i18n';
import { cardImage } from './images';
import { InspectableCard } from './table/CardInspection';
import { manaSymbols } from './table/cards';
import { cardForInspection } from './table/useCardInspection';
import type { Engine } from './useEngine';

const FAQ: { q: MessageKey; a: MessageKey }[] = [
  { q: 'faqStackQ', a: 'faqStackA' }, { q: 'faqInstantQ', a: 'faqInstantA' },
  { q: 'faqReplacementQ', a: 'faqReplacementA' }, { q: 'faqCommanderDamageQ', a: 'faqCommanderDamageA' },
  { q: 'faqCommanderTaxQ', a: 'faqCommanderTaxA' }, { q: 'faqIdentityQ', a: 'faqIdentityA' },
];
const COLORS: { bit: number; key: string; label: MessageKey }[] = [
  { bit: 1, key: 'W', label: 'colorW' }, { bit: 2, key: 'U', label: 'colorU' }, { bit: 4, key: 'B', label: 'colorB' },
  { bit: 8, key: 'R', label: 'colorR' }, { bit: 16, key: 'G', label: 'colorG' }, { bit: 32, key: 'C', label: 'colorC' },
];
const CURVE = [0, 1, 2, 3, 4, 5, 6, 7];
type Stat = 'mv' | 'pow' | 'tou' | 'loy';
type StatOp = '=' | '<' | '<=' | '>' | '>=' | '!=';
const STATS: { id: Stat; label: MessageKey }[] = [
  { id: 'mv', label: 'manaValue' }, { id: 'pow', label: 'statPower' }, { id: 'tou', label: 'statToughness' }, { id: 'loy', label: 'statLoyalty' },
];
const STAT_OPS: StatOp[] = ['=', '<', '<=', '>', '>=', '!='];
let nextSearch = 0;

/** Card lookup: a face for every result, and one card at a time with the previous and next result. */
export function RulesScreen({ engine, onBack }: { engine: Engine; onBack: () => void }) {
  const t = useT();
  const { send } = engine;
  const [query, setQuery] = useState('');
  const [rules, setRules] = useState('');
  const [typeText, setTypeText] = useState('');
  const [colors, setColors] = useState(0);
  const [cmc, setCmc] = useState(-1);
  const [stat, setStat] = useState<Stat>('mv');
  const [statOp, setStatOp] = useState<StatOp>('=');
  const [statValue, setStatValue] = useState('');
  const [searchId, setSearchId] = useState(0);
  const [cards, setCards] = useState<CatalogCard[]>([]);
  const [total, setTotal] = useState(0);
  const [open, setOpen] = useState<number | null>(null);
  const [hover, setHover] = useState<{ src: string; anchor: DOMRect } | null>(null);
  const append = useRef(false);
  const statNumber = statValue.trim() === '' || !Number.isFinite(Number(statValue)) ? undefined : Math.trunc(Number(statValue));
  const ready = query.trim().length >= 2 || rules.trim() !== '' || typeText.trim() !== '' || colors !== 0 || cmc >= 0 || statNumber !== undefined;

  useEffect(() => {
    if (!ready) { setCards([]); setTotal(0); setOpen(null); return; }
    const timer = setTimeout(() => {
      append.current = false;
      const requestId = 1_000_000 + ++nextSearch;
      setSearchId(requestId);
      setCards([]);
      setTotal(0);
      setOpen(null);
      send({ type: 'searchCards', requestId, query, rules, typeText, colors, cmc, allCards: true, stat, statOp, statValue: statNumber });
    }, 250);
    return () => clearTimeout(timer);
  }, [query, rules, typeText, colors, cmc, stat, statOp, statNumber, ready, send]);

  useEffect(() => {
    const results = engine.cardResults;
    if (!results || results.requestId !== searchId) return;
    setTotal(results.total);
    setCards((current) => append.current ? [...current, ...results.cards.filter((c) => !current.some((have) => have.nameEn === c.nameEn))] : results.cards);
    append.current = false;
  }, [engine.cardResults, searchId]);

  const picked = open != null ? cards[open] : null;
  const rulings = useRequest((requestId) => { if (picked) send({ type: 'cardRulings', requestId, name: picked.nameEn }); }, [picked?.nameEn, send]);
  const answer = picked ? reply(engine, 'cardRulings', rulings.id.current) : null;
  const shown = answer?.type === 'cardRulings' && answer.name === picked?.nameEn ? answer : null;

  useEffect(() => {
    if (open == null) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') { setOpen(null); return; }
      if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return;
      const target = event.target;
      if (target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement || target instanceof HTMLSelectElement) return;
      event.preventDefault();
      setOpen((index) => {
        if (index == null) return index;
        const next = index + (event.key === 'ArrowLeft' ? -1 : 1);
        return next < 0 || next >= cards.length ? index : next;
      });
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, cards.length]);

  const more = () => {
    append.current = true;
    const requestId = 1_000_000 + ++nextSearch;
    setSearchId(requestId);
    send({ type: 'searchCards', requestId, query, rules, typeText, colors, cmc, allCards: true, offset: cards.length, stat, statOp, statValue: statNumber });
  };
  const date = (iso: string) => {
    const d = new Date(`${iso}T00:00:00`);
    return Number.isNaN(d.getTime()) ? iso : d.toLocaleDateString(document.documentElement.lang || undefined, { dateStyle: 'medium' });
  };

  return (
    <main className="import decks rules">
      <header className="import__head">
        <button type="button" className="btn btn--ghost" onClick={onBack}>{t('back')}</button>
        <h1>{t('rulesTitle')}</h1>
      </header>
      <div className="rules__layout">
        <section className="rules__search" aria-label={t('rulesLookup')}>
          <div className="builder__filters">
            <input className="input" type="search" aria-label={t('rulesLookup')} placeholder={t('rulesLookup')} value={query} onChange={(e) => setQuery(e.target.value)} />
            <span className="builder__colors">
              {COLORS.map((c) => (
                <button key={c.key} type="button" className={`pip pip--${c.key === 'C' ? 'n' : c.key} builder__color`} aria-pressed={(colors & c.bit) !== 0}
                  aria-label={t(c.label)} title={t(c.label)} onClick={() => setColors(colors ^ c.bit)} />
              ))}
            </span>
            <select className="input" aria-label={t('manaValue')} value={cmc} onChange={(e) => setCmc(Number(e.target.value))}>
              <option value={-1}>{t('anyCost')}</option>
              {CURVE.map((v) => <option key={v} value={v}>{v === 7 ? '7+' : v}</option>)}
            </select>
            <input className="input" type="search" aria-label={t('rulesTextFilter')} placeholder={t('rulesTextFilter')} title={t('rulesTextHint')} value={rules} onChange={(e) => setRules(e.target.value)} />
            <input className="input" type="search" aria-label={t('typeLineFilter')} placeholder={t('typeLineFilter')} title={t('typeLineHint')} value={typeText} onChange={(e) => setTypeText(e.target.value)} />
            <span className="builder__stat">
              <select className="input" aria-label={t('statFilter')} value={stat} onChange={(e) => setStat(e.target.value as Stat)}>
                {STATS.map((s) => <option key={s.id} value={s.id}>{t(s.label)}</option>)}
              </select>
              <select className="input" aria-label={t('statComparison')} value={statOp} onChange={(e) => setStatOp(e.target.value as StatOp)}>
                {STAT_OPS.map((op) => <option key={op} value={op}>{op}</option>)}
              </select>
              <input className="input" inputMode="numeric" aria-label={t('statValue')} placeholder={t('statValue')} value={statValue} onChange={(e) => setStatValue(e.target.value)} />
            </span>
          </div>
          {(cards.length > 0 || total > 0) && <p className="muted">{t('cardOf', { n: cards.length, total })}</p>}
          <ul className="deck-faces rules__results">
            {cards.map((c, i) => {
              const src = c.imageKey ? cardImage(c.imageKey, 'full') : '';
              return (
                <li key={c.nameEn}>
                  <button type="button" className="deck-face" aria-label={c.name} onClick={() => setOpen(i)}
                    onMouseEnter={(e) => src && setHover({ src, anchor: e.currentTarget.getBoundingClientRect() })}
                    onMouseLeave={() => setHover(null)} onFocus={(e) => src && setHover({ src, anchor: e.currentTarget.getBoundingClientRect() })} onBlur={() => setHover(null)}>
                    {src && <img src={src} alt="" />}
                  </button>
                </li>
              );
            })}
          </ul>
          {cards.length < total && <button type="button" className="btn btn--ghost" onClick={more}>{t('moreCards')}</button>}
          {hover && <CardBeside anchor={hover.anchor} src={hover.src} />}
        </section>
        <section className="deck-analysis__panel" aria-labelledby="rules-faq">
          <h2 id="rules-faq">{t('rulesFaq')}</h2>
          {FAQ.map((f) => <details key={f.q} className="rules__faq"><summary>{t(f.q)}</summary><p>{t(f.a)}</p></details>)}
        </section>
      </div>
      {picked && open != null && (
        <CardDialog card={picked} text={shown?.text} legal={picked.commanderLegal} canCommand={picked.canCommand}
          index={open} total={cards.length} onClose={() => setOpen(null)}
          onStep={(delta) => setOpen((index) => index == null ? index : Math.min(cards.length - 1, Math.max(0, index + delta)))}>
          <h3 title={t('rulesRulingsHint')}>{t('rulesRulings')}</h3>
          {answer?.type === 'servicesError' ? <Unavailable onRetry={rulings.retry} />
            : !shown ? <p className="muted" role="status">{t('connecting')}</p>
            : shown.rulings.length === 0 ? <p className="muted">{t('rulesNoRulings')}</p>
            : <ul className="rules__rulings" lang="en">{shown.rulings.map((r, i) => (
              <li key={i}><span className="muted">{date(r.date)}{r.source === 'wotc' ? ' · Wizards of the Coast' : ''}</span><p>{r.comment}</p></li>
            ))}</ul>}
        </CardDialog>
      )}
    </main>
  );
}

function CardDialog({ card, text, legal, canCommand, index, total, onClose, onStep, children }: {
  card: CatalogCard; text?: string; legal: boolean; canCommand: boolean; index: number; total: number;
  onClose: () => void; onStep: (delta: number) => void; children: ReactNode;
}) {
  const t = useT();
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const dialog = ref.current;
    dialog?.showModal();
    return () => dialog?.close();
  }, []);
  const picture = card.imageKey ? cardImage(card.imageKey, 'full') : null;
  return (
    <dialog ref={ref} className="choice rules-card" aria-labelledby="rules-card" onCancel={(e) => { e.preventDefault(); onClose(); }}
      onClick={(e) => { if (e.target === ref.current) onClose(); }}>
      <button type="button" className="btn btn--ghost rules-card__step rules-card__step--prev" aria-label={t('previousCard')} disabled={index <= 0} onClick={() => onStep(-1)} />
      <button type="button" className="btn btn--ghost rules-card__step rules-card__step--next" aria-label={t('nextCard')} disabled={index >= total - 1} onClick={() => onStep(1)} />
      <div className="rules-card__body">
        {picture && <InspectableCard as="div" card={cardForInspection(card)} className="rules__picture"><img src={picture} alt={card.name} /></InspectableCard>}
        <div>
          <header className="game-menu__head">
            <h2 id="rules-card" className="choice__title">{card.name}</h2>
            <button type="button" className="btn btn--ghost" onClick={onClose}>{t('close')}</button>
          </header>
          <p className="rules-card__type">
            <span className="builder__cost">{manaSymbols(card.cost).map((s, i) => <span key={i} className={`pip pip--${/^\d+$/.test(s) ? 'n' : s.replace('/', '')}`}>{/^\d+$|^X$/.test(s) ? s : ''}</span>)}</span>
            <span className="muted">{card.type}</span>
          </p>
          {text && <p className="rules__text">{text}</p>}
          <p className={legal ? 'muted' : 'deck-analysis__warn'}>
            {t(legal ? 'rulesCommanderLegal' : 'rulesCommanderBanned')}
            {canCommand && ` · ${t('rulesCanCommand')}`}
          </p>
          <p className="muted">{t('cardOf', { n: index + 1, total })}</p>
          {children}
        </div>
      </div>
    </dialog>
  );
}
