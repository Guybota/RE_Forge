import { createContext, useEffect, useRef, useState, type ReactNode } from 'react';
import { CardInspectDialog } from '../CardInspectDialog';
import type { CardState } from '../engine';
import { cardImage } from '../images';
import { ManaCost, SymbolText } from '../ManaSymbol';
import type { Engine } from '../useEngine';
import { isMessageKey, useT } from '../i18n';

/** The printed card when there is a picture (it already shows name, cost and text); the text otherwise. */
export function Preview({ card }: { card: CardState }) {
  const [failed, setFailed] = useState<string | null>(null);
  const src = cardImage(card.imageKey, 'full');
  if (src && failed !== src) {
    return <img className="side__image" src={src} alt={`${card.name}: ${card.text ?? ''}`} onError={() => setFailed(src)} />;
  }
  return (
    <>
      <h2>{card.name}</h2>
      <p className="side__cost"><ManaCost cost={card.cost} /></p>
      <p className="side__type">{card.type}</p>
      {card.text && <p className="side__text"><SymbolText text={card.text} /></p>}
      {card.power !== undefined && <p className="side__pt">{card.power}/{card.toughness}</p>}
    </>
  );
}

const sameInspect = (a: CardState, b: CardState) =>
  (a.nameEn && b.nameEn && a.nameEn === b.nameEn && (a.set ?? '') === (b.set ?? '') && (a.number ?? '') === (b.number ?? ''))
  || (!!a.imageKey && a.imageKey === b.imageKey)
  || (a.id >= 0 && a.id === b.id);

/** Shows a card big: right click on desktop, long press on touch. Catalog cards open the rich inspect modal. */
export type CardZoomOpen = (card: CardState, sequence?: CardState[]) => void;
export const CardZoom = createContext<CardZoomOpen>(() => {});

type ZoomState = { card: CardState; sequence: CardState[]; index: number };

export function CardZoomProvider({ children, engine }: { children: ReactNode; engine?: Engine | null }) {
  const [zoom, setZoom] = useState<ZoomState | null>(null);
  const open: CardZoomOpen = (card, sequence) => {
    const seq = (sequence ?? [card]).filter((c) => c && !c.hidden);
    const index = Math.max(0, seq.findIndex((c) => sameInspect(c, card)));
    setZoom({ card: seq[index] ?? card, sequence: seq, index });
  };
  const rich = zoom?.card.nameEn && engine;
  const step = (delta: number) => {
    setZoom((current) => {
      if (!current || current.sequence.length < 2) return current;
      const next = Math.min(current.sequence.length - 1, Math.max(0, current.index + delta));
      const card = current.sequence[next];
      return card ? { ...current, card, index: next } : current;
    });
  };
  return (
    <CardZoom.Provider value={open}>
      {children}
      {rich && zoom && (
        <CardInspectDialog
          card={zoom.card as CardState & { nameEn: string }}
          engine={engine}
          index={zoom.sequence.length > 1 ? zoom.index : undefined}
          total={zoom.sequence.length > 1 ? zoom.sequence.length : undefined}
          onStep={zoom.sequence.length > 1 ? step : undefined}
          onClose={() => setZoom(null)}
        />
      )}
      {zoom && !rich && <ZoomDialog card={zoom.card} onClose={() => setZoom(null)} />}
    </CardZoom.Provider>
  );
}

// A cost or amount ("{2}", "3") can follow a translated name; other details ("from red") stay in the card text.
const costLike = (detail: string) => /^[{\d]/.test(detail);
const WITH_COST = new Set(['WARD', 'EQUIP']);

/** Localized rules and what the card has right now: counters and keyword explanations. */
function CardInfo({ card }: { card: CardState }) {
  const t = useT();
  const counters = Object.entries(card.counters ?? {});
  const keywords = card.keywords ?? [];
  return (
    <aside className="zoom__info" onClick={(e) => e.stopPropagation()}>
      <details className="zoom__description">
        <summary>
          <span className="zoom__show-text">{t('zoomShowText')}</span>
          <span className="zoom__hide-text">{t('zoomHideText')}</span>
        </summary>
        <div className="zoom__description-body">
          <h2>{card.name}</h2>
          {card.cost && <p><ManaCost cost={card.cost} /></p>}
          {card.type && <p className="zoom__type">{card.type}</p>}
          {card.text && <p className="zoom__text"><SymbolText text={card.text} /></p>}
          {card.power !== undefined && <p>{card.power}/{card.toughness}</p>}
        </div>
      </details>
      {counters.length > 0 && <ul className="zoom__counters" aria-label={t('zoomCounters')}>
        {counters.map(([name, n]) => {
          const key = `counter_${name}`;
          return <li key={name} className="chip">{t('counterLine', { name: isMessageKey(key) ? t(key) : name, n })}</li>;
        })}
      </ul>}
      {keywords.length > 0 && <dl className="zoom__keywords" aria-label={t('zoomKeywords')}>
        {keywords.map((k) => {
          const name = `kw_${k.id}`, help = `kwHelp_${k.id}`;
          // Our texts for Ward and Equip quote the cost, so they need one.
          if (!isMessageKey(name) || !isMessageKey(help) || (WITH_COST.has(k.id) && !costLike(k.detail))) {
            return <div key={k.title}><dt>{k.title}</dt>{k.reminder && <dd><SymbolText text={k.reminder} /></dd>}</div>;
          }
          return <div key={k.title}>
            <dt>{costLike(k.detail) ? <>{t(name)} <SymbolText text={k.detail} /></> : t(name)}</dt>
            <dd><SymbolText text={t(help, { detail: k.detail })} /></dd>
          </div>;
        })}
      </dl>}
    </aside>
  );
}

// A modal <dialog> so it also sits above other open dialogs (zones, choices, the menu).
function ZoomDialog({ card, onClose }: { card: CardState; onClose: () => void }) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const dialog = ref.current;
    const source = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    dialog?.showModal();
    return () => { dialog?.close(); if (source?.isConnected) source.focus({ preventScroll: true }); };
  }, []);
  return (
    <dialog ref={ref} className="zoom" aria-label={card.name} onClick={onClose}
      onContextMenu={(e) => { e.preventDefault(); onClose(); }} onCancel={(e) => { e.preventDefault(); onClose(); }}>
      <div className="zoom__body">
        <div className="zoom__card"><Preview key={card.id} card={card} /></div>
        <CardInfo key={card.id} card={card} />
      </div>
    </dialog>
  );
}
