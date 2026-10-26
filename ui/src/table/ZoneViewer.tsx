import { useEffect, useRef, type ReactNode } from 'react';
import type { CardState } from '../engine';
import { useT } from '../i18n';
import { Card } from './Card';
import type { TableContext } from './PlayerArea';

export type OpenZone = { playerId: number; zone: 'graveyard' | 'exile' };

/** A player's graveyard or exile, or the cards a prompt offers off the table, live from the latest state.
 *  Playable cards (e.g. flashback) can be clicked here. Without onClose it stays until the prompt moves on. */
export function ZoneViewer({ title, cards, ctx, onClose, children }: { title: string; cards: CardState[]; ctx: TableContext; onClose?: () => void; children?: ReactNode }) {
  const t = useT();
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const dialog = ref.current;
    dialog?.showModal();
    return () => dialog?.close();
  }, []);

  return (
    <dialog ref={ref} className="choice game-menu zone" aria-labelledby="zone-title" onCancel={(e) => { e.preventDefault(); onClose?.(); }}>
      <header className="game-menu__head">
        <h2 id="zone-title" className="choice__title">{title}</h2>
        {onClose ? <button type="button" className="btn btn--ghost" onClick={onClose} autoFocus>{t('close')}</button> : children}
      </header>
      <div className="game-menu__body zone__cards">
        {cards.map((c) => {
          const selectable = ctx.selectableCards.has(c.id);
          const usable = selectable || c.actionable;
          return <Card key={c.id} card={c} size="hand" selectable={selectable} chosen={ctx.chosenCards.has(c.id)}
            onClick={usable ? () => { onClose?.(); ctx.onCard(c.id); } : undefined} />;
        })}
      </div>
    </dialog>
  );
}
