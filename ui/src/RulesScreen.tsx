import { useEffect, useRef, useState } from 'react';
import { CardInspectDialog } from './CardInspectDialog';
import { CardBeside } from './DeckCards';
import type { CatalogCard } from './engine';
import { useT, type MessageKey } from './i18n';
import { cardImage } from './images';
import { ManaSymbol } from './ManaSymbol';
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

  const more = () => {
    append.current = true;
    const requestId = 1_000_000 + ++nextSearch;
    setSearchId(requestId);
    send({ type: 'searchCards', requestId, query, rules, typeText, colors, cmc, allCards: true, offset: cards.length, stat, statOp, statValue: statNumber });
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
                <button key={c.key} type="button" className="mana-swatch builder__color" aria-pressed={(colors & c.bit) !== 0}
                  aria-label={t(c.label)} title={t(c.label)} onClick={() => setColors(colors ^ c.bit)}>
                  <ManaSymbol symbol={c.key} cost />
                </button>
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
        <CardInspectDialog
          card={{ ...cardForInspection(picked), nameEn: picked.nameEn }}
          engine={engine}
          index={open}
          total={cards.length}
          onClose={() => setOpen(null)}
          onStep={(delta) => setOpen((index) => index == null ? index : Math.min(cards.length - 1, Math.max(0, index + delta)))}
        />
      )}
    </main>
  );
}
