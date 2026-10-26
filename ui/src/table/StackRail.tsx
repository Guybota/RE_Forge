import { useContext, useEffect, useRef, useState } from 'react';
import type { CardState, GameState } from '../engine';
import { useT } from '../i18n';
import { cardImage } from '../images';
import { CardZoom } from './CardZoom';

/**
 * The stack, drawn once, like Arena: a column of cards at the right of the battlefield while something waits to
 * resolve. Its button sits in the phase bar (spells fly to it) and the cards hang below the bar. The item that
 * resolves next comes first and larger; abilities show their source's art with the text.
 * Hover shows the card (and the arrows to the top item's targets), right click zooms. It can be folded away; a new
 * item opens it again.
 */
export function StackRail({ game, allCards, names, onHover }: {
  game: GameState; allCards: CardState[]; names: Map<number, string>; onHover: (card: CardState | null) => void;
}) {
  const t = useT();
  const zoom = useContext(CardZoom);
  const [folded, setFolded] = useState(false);
  const size = game.stack.length;
  const previous = useRef(size);
  useEffect(() => {
    if (size > previous.current) setFolded(false);
    previous.current = size;
  }, [size]);
  if (!size) return null;

  return (
    <section className={`stack-rail ${folded ? 'is-folded' : ''}`} aria-label={t('stack')} aria-live="polite">
      <button type="button" className="btn btn--ghost stack-rail__toggle" data-zone="stack" aria-expanded={!folded} title={t(folded ? 'showStack' : 'hideStack')}
        onClick={() => setFolded((f) => !f)}>
        {t('stack')} <span className="stack-rail__count">{size}</span>
      </button>
      {!folded && <ol className="stack-rail__items">
        {game.stack.map((s, i) => {
          const card = s.card ?? allCards.find((c) => c.id === s.sourceCardId);
          const owner = game.players.length > 2 && s.controllerId !== null ? names.get(s.controllerId) : undefined;
          const art = card?.imageKey ? cardImage(card.imageKey, s.isSpell ? 'full' : 'crop') : null;
          return (
            <li key={s.id} data-stack-id={s.id} data-hover-card={card?.id} className={`stack-rail__item ${i === 0 ? 'is-next' : ''} ${s.isSpell ? '' : 'is-ability'}`}
              aria-current={i === 0 || undefined} title={i === 0 ? `${t('resolvesNext')}: ${s.text}` : s.text}
              onMouseEnter={card ? () => onHover(card) : undefined} onMouseLeave={card ? () => onHover(null) : undefined}
              onContextMenu={card?.imageKey ? (e) => { e.preventDefault(); zoom({ id: card.id, name: card.name, imageKey: card.imageKey }); } : undefined}>
              {s.isSpell && art ? <img src={art} alt={s.text} />
                : <div className="stack-rail__ability">{art && <img src={art} alt="" />}<p>{s.text}</p></div>}
              {owner && <span className="stack-rail__owner">{owner}</span>}
            </li>
          );
        })}
      </ol>}
    </section>
  );
}
