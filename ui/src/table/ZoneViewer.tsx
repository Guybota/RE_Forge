import { useEffect, useRef } from 'react';
import type { PlayerState } from '../engine';
import { useT } from '../i18n';
import { Card } from './Card';
import type { TableContext } from './PlayerArea';

export type OpenZone = { playerId: number; zone: 'graveyard' | 'exile' };

/** A player's graveyard or exile, live from the latest state. Playable cards (e.g. flashback) can be clicked here. */
export function ZoneViewer({ player, zone, ctx, onClose }: { player: PlayerState; zone: OpenZone['zone']; ctx: TableContext; onClose: () => void }) {
  const t = useT();
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const dialog = ref.current;
    dialog?.showModal();
    return () => dialog?.close();
  }, []);
  // Most recent on top, like the physical pile.
  const cards = [...player.zones[zone]].reverse();

  return (
    <dialog ref={ref} className="choice game-menu zone" aria-labelledby="zone-title" onCancel={(e) => { e.preventDefault(); onClose(); }}>
      <header className="game-menu__head">
        <h2 id="zone-title" className="choice__title">{t(zone)} · {player.name}</h2>
        <button type="button" className="btn btn--ghost" onClick={onClose} autoFocus>{t('close')}</button>
      </header>
      <div className="game-menu__body zone__cards">
        {cards.map((c) => {
          const selectable = ctx.selectableCards.has(c.id);
          const usable = selectable || c.actionable;
          return <Card key={c.id} card={c} size="hand" selectable={selectable} chosen={ctx.chosenCards.has(c.id)}
            onClick={usable ? () => { onClose(); ctx.onCard(c.id); } : undefined} />;
        })}
      </div>
    </dialog>
  );
}
