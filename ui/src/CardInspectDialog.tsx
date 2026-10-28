import { useEffect, useMemo, useRef, useState } from 'react';
import { cardThemeLabels } from './cardThemes';
import { reply, useGatedRequest, useRequest } from './deckRequests';
import { Unavailable } from './DeckOnline';
import pt from './deckTools/pt.json';
import { setDeckToolsLanguage } from './deckTools/say';
import type { CardState, EdhrecCombo, Printings } from './engine';
import { ManaCost, SymbolText } from './ManaSymbol';
import { useT } from './i18n';
import { cardImage } from './images';
import type { Engine } from './useEngine';

type PrintingFace = Printings['printings'][number];

const euros = (n: number) => new Intl.NumberFormat(document.documentElement.lang || undefined, { style: 'currency', currency: 'EUR' }).format(n);
const edhrecCard = (nameEn: string) =>
  `https://edhrec.com/cards/${encodeURIComponent(nameEn.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, ''))}`;
const hasName = (combo: EdhrecCombo, nameEn: string) => {
  const want = nameEn.toLowerCase();
  const front = want.split(' // ')[0];
  return combo.cardNames.some((n) => {
    const k = n.toLowerCase();
    return k === want || k === front || k.split(' // ')[0] === front;
  });
};
const dateLabel = (iso: string) => {
  const d = new Date(`${iso}T00:00:00`);
  return Number.isNaN(d.getTime()) ? iso : d.toLocaleDateString(document.documentElement.lang || undefined, { dateStyle: 'medium' });
};

/** Catalog inspection: art on the left, text/tags and collapsible online sections on the right. */
export function CardInspectDialog({ card, engine, onClose, index, total, onStep, onPickPrinting }: {
  card: CardState & { nameEn: string };
  engine: Engine;
  onClose: () => void;
  index?: number;
  total?: number;
  onStep?: (delta: number) => void;
  /** When set, clicking a printing applies it (editable deck). */
  onPickPrinting?: (printing: PrintingFace) => void;
}) {
  const t = useT();
  const { send } = engine;
  const ref = useRef<HTMLDialogElement>(null);
  const lang = engine.info?.language ?? document.documentElement.lang;
  // Tags use say(); set the table before the first paint so chips are not English-only.
  setDeckToolsLanguage(lang.startsWith('pt') ? pt : null);
  const [priceOpen, setPriceOpen] = useState(false);
  const [versionsOpen, setVersionsOpen] = useState(false);
  const [combosOpen, setCombosOpen] = useState(false);
  const [rulingsOpen, setRulingsOpen] = useState(false);
  const nameEn = card.nameEn;
  const panelRef = useRef<HTMLDivElement>(null);
  const tags = useMemo(() => cardThemeLabels(nameEn), [nameEn, lang]);
  const picture = card.imageKey ? cardImage(card.imageKey, 'full') : card.imageUrl ?? null;
  const buy = `https://www.cardmarket.com/en/Magic/Products/Search?searchString=${encodeURIComponent(nameEn)}`;
  const canStep = onStep != null && index != null && total != null && total > 1;

  useEffect(() => {
    setPriceOpen(false);
    setVersionsOpen(false);
    setCombosOpen(false);
    setRulingsOpen(false);
    if (panelRef.current) panelRef.current.scrollTop = 0;
  }, [nameEn, card.set, card.number]);

  // Translated oracle text ships with rulings; load once so the panel is not English-only.
  const rulingsReq = useRequest((requestId) => {
    send({ type: 'cardRulings', requestId, name: nameEn });
  }, [nameEn, send]);
  const rulingsAnswer = reply(engine, 'cardRulings', rulingsReq.id.current);
  const rulings = rulingsAnswer?.type === 'cardRulings' && rulingsAnswer.name === nameEn ? rulingsAnswer : null;
  const oracle = rulings?.text || card.text || card.textEn;

  // Price is fetched with the card (not when the section opens): gating used to bump the request id on
  // close without sending, so a late reply never matched and the section stayed on "connecting".
  const priceReq = useRequest((requestId) => {
    send({ type: 'cardPrice', requestId, name: nameEn, set: card.set, number: card.number });
  }, [nameEn, card.set, card.number, send]);
  const priceRaw = reply(engine, 'cardPrice', priceReq.id.current);
  const price = priceRaw && (priceRaw.type === 'servicesError' || priceRaw.name === nameEn) ? priceRaw : null;

  useEffect(() => {
    if (!versionsOpen) return;
    send({ type: 'getPrintings', name: nameEn });
  }, [versionsOpen, nameEn, send]);
  const printings = engine.printings?.name === nameEn ? engine.printings.printings : null;

  const combosReq = useGatedRequest(!!(combosOpen && card.deckName), (requestId) => {
    send({ type: 'deckCombos', requestId, name: card.deckName!, source: card.deckSource ?? 'mine' });
  }, [card.deckName, card.deckSource, send]);
  const combosAnswer = reply(engine, 'deckCombos', combosReq.id.current);
  const cardCombos = useMemo(() => {
    if (combosAnswer?.type !== 'deckCombos') return null;
    return combosAnswer.groups.flatMap((g) => g.combos.filter((c) => hasName(c, nameEn))).slice(0, 8);
  }, [combosAnswer, nameEn]);

  useEffect(() => {
    const dialog = ref.current;
    const source = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    dialog?.showModal();
    return () => { dialog?.close(); if (source?.isConnected) source.focus({ preventScroll: true }); };
  }, []);

  useEffect(() => {
    if (!canStep) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return;
      const target = event.target;
      if (target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement || target instanceof HTMLSelectElement) return;
      event.preventDefault();
      onStep!(event.key === 'ArrowLeft' ? -1 : 1);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [canStep, onStep]);

  return (
    <dialog ref={ref} className="card-inspect" aria-labelledby="card-inspect-title"
      onCancel={(e) => { e.preventDefault(); onClose(); }}
      onClick={(e) => { if (e.target === ref.current) onClose(); }}>
      <div className="card-inspect__body" onClick={(e) => e.stopPropagation()}>
        <div className="card-inspect__art-col">
          <header className="card-inspect__art-head">
            <h2 id="card-inspect-title">{card.name ?? nameEn}</h2>
            <button type="button" className="btn btn--ghost card-inspect__close-mobile" onClick={onClose}>{t('close')}</button>
          </header>
          <div className="card-inspect__art">
            {picture ? <img key={picture} src={picture} alt={card.name ?? nameEn} /> : <div className="card-inspect__blank"><span>{card.name ?? nameEn}</span></div>}
          </div>
          {canStep && (
            <div className="card-inspect__nav" role="group" aria-label={t('cardOf', { n: index! + 1, total: total! })}>
              <button type="button" className="btn btn--ghost card-inspect__step card-inspect__step--prev" aria-label={t('previousCard')}
                disabled={index! <= 0} onClick={() => onStep!(-1)} />
              <span className="muted">{t('cardOf', { n: index! + 1, total: total! })}</span>
              <button type="button" className="btn btn--ghost card-inspect__step card-inspect__step--next" aria-label={t('nextCard')}
                disabled={index! >= total! - 1} onClick={() => onStep!(1)} />
            </div>
          )}
        </div>
        <div className="card-inspect__panel" ref={panelRef}>
          <header className="card-inspect__head">
            <ManaCost cost={card.cost} />
            <button type="button" className="btn btn--ghost card-inspect__close-desk" onClick={onClose}>{t('close')}</button>
          </header>
          {card.type && <p className="card-inspect__type muted">{card.type}</p>}
          {oracle && <p className="card-inspect__text"><SymbolText text={oracle} /></p>}
          {card.commanderLegal != null && (
            <p className={card.commanderLegal ? 'muted' : 'deck-analysis__warn'}>
              {t(card.commanderLegal ? 'rulesCommanderLegal' : 'rulesCommanderBanned')}
              {card.canCommand && ` · ${t('rulesCanCommand')}`}
            </p>
          )}
          {tags.length > 0 && (
            <ul className="card-inspect__tags" aria-label={t('inspectThemes')}>
              {tags.map((tag) => <li key={tag}>{tag}</li>)}
            </ul>
          )}

          <details className="card-inspect__section" open={priceOpen} onToggle={(e) => setPriceOpen((e.target as HTMLDetailsElement).open)}>
            <summary>{t('inspectPrice')}</summary>
            {!priceOpen ? null
              : price?.type === 'servicesError' ? <Unavailable onRetry={priceReq.retry} />
              : price?.type !== 'cardPrice' ? <p className="muted" role="status">{t('pricesLoading')}</p>
              : <p className="card-inspect__price">
                  {price.eur != null ? <strong>{euros(price.eur)}</strong> : <span className="muted">{t('inspectPriceUnknown')}</span>}
                  {price.eur != null && !price.exact && <span className="muted"> · {t('priceApproxHint')}</span>}
                  <a className="btn btn--ghost" href={buy} target="_blank" rel="noreferrer">{t('menuBuy')}</a>
                </p>}
          </details>

          <details className="card-inspect__section" open={versionsOpen} onToggle={(e) => setVersionsOpen((e.target as HTMLDetailsElement).open)}>
            <summary>{t('inspectVersions')}</summary>
            {!versionsOpen ? null
              : !printings ? <p className="muted" role="status">{t('connecting')}</p>
              : printings.length === 0 ? <p className="muted">{t('inspectVersionsNone')}</p>
              : <ul className="card-inspect__printings">
                  {printings.map((p) => {
                    const src = cardImage(p.imageKey, 'full');
                    const current = card.set === p.set && card.number === p.number;
                    const pick = onPickPrinting ? () => onPickPrinting(p) : undefined;
                    return <li key={`${p.set}/${p.number}`} className={current ? 'is-current' : undefined} title={`${p.setName} #${p.number}`}>
                      {pick
                        ? <button type="button" className="card-inspect__print" onClick={pick}>
                            {src ? <img src={src} alt="" loading="lazy" /> : <span>{p.set} #{p.number}</span>}
                            <span>{p.set}</span>
                          </button>
                        : <>
                            {src ? <img src={src} alt="" loading="lazy" /> : <span>{p.set} #{p.number}</span>}
                            <span>{p.set}</span>
                          </>}
                    </li>;
                  })}
                </ul>}
          </details>

          <details className="card-inspect__section" open={combosOpen} onToggle={(e) => setCombosOpen((e.target as HTMLDetailsElement).open)}>
            <summary>{t('inspectCombos')}</summary>
            {!combosOpen ? null : <>
              <p><a className="btn btn--ghost" href={edhrecCard(nameEn)} target="_blank" rel="noreferrer">{t('inspectCombosOpen')}</a></p>
              {card.deckName && (
                combosAnswer?.type === 'servicesError' ? <Unavailable onRetry={combosReq.retry} />
                  : combosAnswer?.type !== 'deckCombos' ? <p className="muted" role="status">{t('combosLoading')}</p>
                  : !cardCombos?.length ? <p className="muted">{t('inspectCombosNone')}</p>
                  : <ul className="card-inspect__combos">
                      {cardCombos.map((combo) => (
                        <li key={combo.id}>
                          <p lang="en"><strong>{combo.results.length ? combo.results.slice(0, 3).join(' · ') : combo.cardNames.join(' + ')}</strong></p>
                          <p className="muted">{combo.cardNames.join(' · ')}</p>
                          <a className="btn btn--ghost" href={combo.href} target="_blank" rel="noreferrer">{t('comboExplain')}</a>
                        </li>
                      ))}
                    </ul>
              )}
            </>}
          </details>

          <details className="card-inspect__section" open={rulingsOpen} onToggle={(e) => setRulingsOpen((e.target as HTMLDetailsElement).open)}>
            <summary title={t('rulesRulingsHint')}>{t('rulesRulings')}</summary>
            {!rulingsOpen ? null
              : rulingsAnswer?.type === 'servicesError' ? <Unavailable onRetry={rulingsReq.retry} />
              : !rulings ? <p className="muted" role="status">{t('rulesLoading')}</p>
              : rulings.rulings.length === 0 ? <p className="muted">{t('rulesNoRulings')}</p>
              : <ul className="rules__rulings" lang="en">{rulings.rulings.map((r, i) => (
                  <li key={i}><span className="muted">{dateLabel(r.date)}{r.source === 'wotc' ? ' · Wizards of the Coast' : ''}</span><p><SymbolText text={r.comment} /></p></li>
                ))}</ul>}
          </details>
        </div>
      </div>
    </dialog>
  );
}
