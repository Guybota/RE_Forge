import { createContext, useEffect, useRef, useState, type ReactNode } from 'react';
import type { CardState } from '../engine';
import { cardImage } from '../images';
import { manaSymbols } from './cards';

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

// A modal <dialog> so it also sits above other open dialogs (zones, choices, the menu).
function ZoomDialog({ card, onClose }: { card: CardState; onClose: () => void }) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const dialog = ref.current;
    dialog?.showModal();
    return () => dialog?.close();
  }, []);
  return (
    <dialog ref={ref} className="zoom" aria-label={card.name} onClick={onClose}
      onContextMenu={(e) => { e.preventDefault(); onClose(); }} onCancel={(e) => { e.preventDefault(); onClose(); }}>
      <div className="zoom__card"><Preview key={card.id} card={card} /></div>
    </dialog>
  );
}
