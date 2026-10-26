import { createContext, useEffect, useRef, useState, type ReactNode } from 'react';
import type { CardState } from '../engine';
import { cardImage } from '../images';
import { manaSymbols } from './cards';
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
      <p className="side__cost">{manaSymbols(card.cost).join(' ')}</p>
      <p className="side__type">{card.type}</p>
      <p className="side__text">{card.text}</p>
      {card.power !== undefined && <p className="side__pt">{card.power}/{card.toughness}</p>}
    </>
  );
}

/** Shows a card big: right click on desktop, long press on touch. Any click, right click or Escape closes it. */
export const CardZoom = createContext<(card: CardState) => void>(() => {});

export function CardZoomProvider({ children }: { children: ReactNode }) {
  const [card, setCard] = useState<CardState | null>(null);
  return (
    <CardZoom.Provider value={setCard}>
      {children}
      {card && <ZoomDialog card={card} onClose={() => setCard(null)} />}
    </CardZoom.Provider>
  );
}

// A cost or amount ("{2}", "3") can follow a translated name; other details ("from red") stay in the card text.
const costLike = (detail: string) => /^[{\d]/.test(detail);
const WITH_COST = new Set(['WARD', 'EQUIP']);

/** What the card has right now: its counters, and its keywords with a short explanation (Forge's reminder text otherwise). */
function CardInfo({ card }: { card: CardState }) {
  const t = useT();
  const counters = Object.entries(card.counters ?? {});
  const keywords = card.keywords ?? [];
  if (!counters.length && !keywords.length) return null;
  return (
    <aside className="zoom__info">
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
            return <div key={k.title}><dt>{k.title}</dt>{k.reminder && <dd>{k.reminder}</dd>}</div>;
          }
          return <div key={k.title}>
            <dt>{costLike(k.detail) ? `${t(name)} ${k.detail}` : t(name)}</dt>
            <dd>{t(help, { detail: k.detail })}</dd>
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
        <CardInfo card={card} />
      </div>
    </dialog>
  );
}
