import { useLayoutEffect, useRef, useState, type RefObject } from 'react';
import type { GameState } from '../engine';

type Arrow = { key: string; d: string; kind: 'attack' | 'block'; x2: number; y2: number };

const centre = (el: Element, box: DOMRect) => {
  const r = el.getBoundingClientRect();
  return { x: r.left + r.width / 2 - box.left, y: r.top + r.height / 2 - box.top };
};

// A gentle curve, bowed sideways so arrows between the same rows don't sit on top of each other.
const curve = (a: { x: number; y: number }, b: { x: number; y: number }) => {
  const mx = (a.x + b.x) / 2 + (b.y - a.y) * 0.15;
  const my = (a.y + b.y) / 2 - (b.x - a.x) * 0.15;
  return `M ${a.x} ${a.y} Q ${mx} ${my} ${b.x} ${b.y}`;
};

/**
 * Lines from each attacker to what it attacks, and from each blocker to the attacker it blocks,
 * drawn over the table. Positions come from the cards on screen (data-card-id / data-player-id),
 * so they follow layout changes; recomputed whenever the game state or window size changes.
 */
export function CombatArrows({ game, container }: { game: GameState; container: RefObject<HTMLElement | null> }) {
  const [arrows, setArrows] = useState<Arrow[]>([]);
  const frame = useRef(0);

  useLayoutEffect(() => {
    const measure = () => {
      const root = container.current;
      if (!root) return;
      const box = root.getBoundingClientRect();
      const find = (attr: string, id: number) => root.querySelector(`[${attr}="${id}"]`);
      const next: Arrow[] = [];
      for (const a of game.combat) {
        const attacker = find('data-card-id', a.attackerId);
        if (!attacker) continue;
        const from = centre(attacker, box);
        if (a.blockerIds.length) {
          for (const b of a.blockerIds) {
            const blocker = find('data-card-id', b);
            if (!blocker) continue;
            const to = centre(blocker, box);
            next.push({ key: `b${b}-${a.attackerId}`, d: curve(to, from), kind: 'block', x2: from.x, y2: from.y });
          }
          continue;
        }
        const target = a.defenderPlayerId !== undefined ? find('data-player-id', a.defenderPlayerId) : find('data-card-id', a.defenderCardId ?? -1);
        if (!target) continue;
        const to = centre(target, box);
        next.push({ key: `a${a.attackerId}`, d: curve(from, to), kind: 'attack', x2: to.x, y2: to.y });
      }
      setArrows(next);
    };
    // After the browser has placed the cards (tapped cards rotate, attackers lift).
    frame.current = requestAnimationFrame(measure);
    window.addEventListener('resize', measure);
    return () => {
      cancelAnimationFrame(frame.current);
      window.removeEventListener('resize', measure);
    };
  }, [game, container]);

  if (!arrows.length) return null;
  return (
    <svg className="combat-arrows" aria-hidden="true">
      <defs>
        <marker id="arrow-attack" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
          <path d="M 0 0 L 10 5 L 0 10 z" className="combat-arrows__head--attack" />
        </marker>
        <marker id="arrow-block" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
          <path d="M 0 0 L 10 5 L 0 10 z" className="combat-arrows__head--block" />
        </marker>
      </defs>
      {arrows.map((a) => (
        <path key={a.key} d={a.d} className={`combat-arrows__line combat-arrows__line--${a.kind}`} markerEnd={`url(#arrow-${a.kind})`} />
      ))}
    </svg>
  );
}
