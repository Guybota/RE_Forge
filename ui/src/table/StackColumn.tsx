import { useContext, useEffect, useState } from 'react';
import type { CardState, GameState } from '../engine';
import { useT } from '../i18n';
import { cardImage } from '../images';
import { animationOn, getAnimationSettings } from './animationPrefs';
import { CardZoom } from './CardZoom';

type Item = GameState['stack'][number];
type Shown = { item: Item; card?: CardState; leaving: boolean };
/** How long a resolved item takes to slide out (and the column to open or close), at normal speed. */
const SLIDE_MS = 280;

/**
 * The stack in its own column at the right of the table: it opens by pushing the battlefield aside when something
 * waits to resolve and closes when the stack empties, so it never covers the boards. The item that resolves next comes
 * first and larger; abilities show their source's art with the text. Hover shows the card (and the arrows to the top
 * item's targets), right click zooms. With "stack" animations on, the column slides, items slide in, and a resolved
 * item slides out before it disappears.
 */
export function StackColumn({ game, allCards, names, onHover }: {
  game: GameState; allCards: CardState[]; names: Map<number, string>; onHover: (card: CardState | null) => void;
}) {
  const t = useT();
  const zoom = useContext(CardZoom);
  const [shown, setShown] = useState<Shown[]>([]);
  const moving = animationOn('stack');
  const slide = Math.round(SLIDE_MS / getAnimationSettings().speed);

  useEffect(() => {
    const live = new Set(game.stack.map((s) => s.id));
    const current = game.stack.map((item) => ({ item, card: item.card ?? allCards.find((c) => c.id === item.sourceCardId), leaving: false }));
    // Items that just resolved stay a moment, on top where they were, to slide out.
    setShown((before) => moving ? [...before.filter((s) => !live.has(s.item.id)).map((s) => ({ ...s, leaving: true })), ...current] : current);
  }, [game.stack]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!shown.some((s) => s.leaving)) return;
    const timer = setTimeout(() => setShown((s) => s.filter((x) => !x.leaving)), slide);
    return () => clearTimeout(timer);
  }, [shown, slide]);

  const open = game.stack.length > 0 || shown.length > 0;
  const next = shown.find((s) => !s.leaving)?.item.id;

  return (
    <aside className={`stack-col ${open ? 'is-open' : ''} ${moving ? '' : 'stack-col--still'}`} aria-label={t('stack')} aria-hidden={!open}
      style={{ '--stack-ms': `${slide}ms` } as React.CSSProperties}>
      {/* Spells fly here; it keeps its width while the column opens, so the target is already in place. */}
      <div className="stack-col__inner" data-zone="stack">
        <h2 className="stack-col__title">{t('stack')} <span className="stack-col__count">{game.stack.length}</span></h2>
        <ol className="stack-col__items" aria-live="polite">
          {shown.map(({ item: s, card, leaving }) => {
            const owner = game.players.length > 2 && s.controllerId !== null ? names.get(s.controllerId) : undefined;
            const art = card?.imageKey ? cardImage(card.imageKey, s.isSpell ? 'full' : 'crop') : null;
            const isNext = s.id === next;
            return (
              <li key={s.id} data-stack-id={leaving ? undefined : s.id} data-hover-card={card?.id}
                className={`stack-col__item ${isNext ? 'is-next' : ''} ${s.isSpell ? '' : 'is-ability'} ${leaving ? 'is-leaving' : ''}`}
                aria-current={isNext || undefined} aria-hidden={leaving || undefined} title={isNext ? `${t('resolvesNext')}: ${s.text}` : s.text}
                onMouseEnter={card ? () => onHover(card) : undefined} onMouseLeave={card ? () => onHover(null) : undefined}
                onContextMenu={card?.imageKey ? (e) => { e.preventDefault(); zoom({ id: card.id, name: card.name, imageKey: card.imageKey }); } : undefined}>
                {s.isSpell && art ? <img src={art} alt={s.text} />
                  : <div className="stack-col__ability">{art && <img src={art} alt="" />}<p>{s.text}</p></div>}
                {owner && <span className="stack-col__owner">{owner}</span>}
              </li>
            );
          })}
        </ol>
      </div>
    </aside>
  );
}
