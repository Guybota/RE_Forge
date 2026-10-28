import { useEffect, useState } from 'react';
import { reply, useRequest } from './deckRequests';
import { Unavailable } from './DeckOnline';
import type { CatalogCard } from './engine';
import { useT, type MessageKey } from './i18n';
import { cardImage } from './images';
import { InspectableCard } from './table/CardInspection';
import { cardForInspection } from './table/useCardInspection';
import type { Engine } from './useEngine';

const FAQ: { q: MessageKey; a: MessageKey }[] = [
  { q: 'faqStackQ', a: 'faqStackA' }, { q: 'faqInstantQ', a: 'faqInstantA' },
  { q: 'faqReplacementQ', a: 'faqReplacementA' }, { q: 'faqCommanderDamageQ', a: 'faqCommanderDamageA' },
  { q: 'faqCommanderTaxQ', a: 'faqCommanderTaxA' }, { q: 'faqIdentityQ', a: 'faqIdentityA' },
];
let nextSearch = 0;

/** Central's Magic Sage: look a card up (any language), read its text and Scryfall's published rulings, and a short FAQ. */
export function RulesScreen({ engine, onBack }: { engine: Engine; onBack: () => void }) {
  const t = useT();
  const { send } = engine;
  const [query, setQuery] = useState('');
  const [searchId, setSearchId] = useState(0);
  const [picked, setPicked] = useState<CatalogCard | null>(null);
  useEffect(() => {
    if (query.trim().length < 2) return;
    const timer = setTimeout(() => {
      const requestId = 1_000_000 + ++nextSearch;
      setSearchId(requestId);
      send({ type: 'searchCards', requestId, query, allCards: true });
    }, 250);
    return () => clearTimeout(timer);
  }, [query, send]);
  const results = query.trim().length >= 2 && engine.cardResults?.requestId === searchId ? engine.cardResults.cards : [];

  const rulings = useRequest((requestId) => { if (picked) send({ type: 'cardRulings', requestId, name: picked.nameEn }); }, [picked?.nameEn, send]);
  const answer = picked ? reply(engine, 'cardRulings', rulings.id.current) : null;
  const shown = answer?.type === 'cardRulings' && answer.name === picked?.nameEn ? answer : null;
  const date = (iso: string) => {
    const d = new Date(`${iso}T00:00:00`);
    return Number.isNaN(d.getTime()) ? iso : d.toLocaleDateString(document.documentElement.lang || undefined, { dateStyle: 'medium' });
  };
  const picture = picked?.imageKey ? cardImage(picked.imageKey, 'full') : null;

  return (
    <main className="import decks rules">
      <header className="import__head">
        <button type="button" className="btn btn--ghost" onClick={onBack}>{t('back')}</button>
        <h1>{t('rulesTitle')}</h1>
      </header>
      <div className="decks__body">
        <section className="rules__search" aria-label={t('rulesLookup')}>
          <input className="input" type="search" aria-label={t('rulesLookup')} placeholder={t('rulesLookup')} value={query} onChange={(e) => setQuery(e.target.value)} />
          <ul className="decks__list">{results.map((c) => (
            <li key={c.nameEn}>
              <InspectableCard as="button" card={cardForInspection(c)} className={`decks__item ${picked?.nameEn === c.nameEn ? 'is-on' : ''}`}
                aria-pressed={picked?.nameEn === c.nameEn} onClick={() => setPicked(c)}>{c.name}</InspectableCard>
            </li>
          ))}</ul>
        </section>
        <div className="deck-online rules__body">
          {picked && (
            <section className="deck-analysis__panel rules__card" aria-labelledby="rules-card">
              {picture && <InspectableCard as="div" card={cardForInspection(picked)} className="rules__picture"><img src={picture} alt={picked.name} /></InspectableCard>}
              <div>
                <h2 id="rules-card">{picked.name}</h2>
                <p className="muted">{picked.type}</p>
                {shown && <p className="rules__text">{shown.text}</p>}
                <p className={picked.commanderLegal ? 'muted' : 'deck-analysis__warn'}>
                  {t(picked.commanderLegal ? 'rulesCommanderLegal' : 'rulesCommanderBanned')}
                  {picked.canCommand && ` · ${t('rulesCanCommand')}`}
                </p>
                <h3 title={t('rulesRulingsHint')}>{t('rulesRulings')}</h3>
                {answer?.type === 'servicesError' ? <Unavailable onRetry={rulings.retry} />
                  : !shown ? <p className="muted" role="status">{t('connecting')}</p>
                  : shown.rulings.length === 0 ? <p className="muted">{t('rulesNoRulings')}</p>
                  : <ul className="rules__rulings" lang="en">{shown.rulings.map((r, i) => (
                    <li key={i}><span className="muted">{date(r.date)}{r.source === 'wotc' ? ' · Wizards of the Coast' : ''}</span><p>{r.comment}</p></li>
                  ))}</ul>}
              </div>
            </section>
          )}
          <section className="deck-analysis__panel" aria-labelledby="rules-faq">
            <h2 id="rules-faq">{t('rulesFaq')}</h2>
            {FAQ.map((f) => <details key={f.q} className="rules__faq"><summary>{t(f.q)}</summary><p>{t(f.a)}</p></details>)}
          </section>
        </div>
      </div>
    </main>
  );
}
