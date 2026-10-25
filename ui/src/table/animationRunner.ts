import type { CardState } from '../engine';
import { cardImage } from '../images';
import type { AnimationPlan } from './animationPlan';
import { animationOn, getAnimationSettings } from './animationPrefs';

/** Card positions after the last render: the "before" of the next snapshot's motion. */
export function cardRects(root: HTMLElement) {
  const rects = new Map<number, DOMRect>();
  root.querySelectorAll<HTMLElement>('[data-card-id]').forEach(el => rects.set(Number(el.dataset.cardId), el.getBoundingClientRect()));
  return rects;
}

const visible = (r: DOMRect | undefined): r is DOMRect => !!r && r.width > 0 && r.height > 0;
const cardEl = (root: HTMLElement, id: number) => root.querySelector<HTMLElement>(`[data-card-id="${id}"]`);
/** A player's zone counter (or hand), falling back to their life total when a compact header hides it. */
function zoneRect(root: HTMLElement, playerId: number, zone: string) {
  const el = root.querySelector<HTMLElement>(`[data-zone="${zone}"][data-zone-of="${playerId}"]`)?.getBoundingClientRect();
  return visible(el) ? el : root.querySelector<HTMLElement>(`[data-player-id="${playerId}"]`)?.getBoundingClientRect();
}

/** A loose card drawn above everything, removed when its motion ends. */
function ghost(root: HTMLElement, card: CardState, width: number) {
  const el = document.createElement('div');
  el.className = 'anim-ghost';
  el.style.width = `${width}px`;
  const src = !card.hidden && cardImage(card.imageKey, 'full');
  if (src) { const img = document.createElement('img'); img.src = src; img.alt = ''; el.append(img); }
  else el.classList.add('anim-ghost--back');
  root.append(el);
  return el;
}
const at = (r: DOMRect, w: number, h: number, scale = 1) => `translate(${r.left + r.width / 2 - w / 2}px, ${r.top + r.height / 2 - h / 2}px) scale(${scale})`;

export function runAnimations(plans: AnimationPlan[], before: Map<number, DOMRect>, root: HTMLElement, layer: HTMLElement) {
  const { enabled, speed } = getAnimationSettings();
  if (!enabled || document.hidden || !plans.length) return;
  const time = (ms: number) => ms / speed;
  let moved = 0; // cards leaving together follow one another
  const style = getComputedStyle(root);
  for (const plan of plans) {
    if (plan.kind === 'cast' && animationOn('cast')) {
      const from = before.get(plan.fromCardId) ?? zoneRect(root, plan.playerId, plan.fromZone);
      const stack = root.querySelector<HTMLElement>('[data-zone="stack"]')?.getBoundingClientRect();
      if (!visible(from)) continue;
      const w = 120, h = w * 7 / 5, centre = new DOMRect(window.innerWidth / 2 - 1, window.innerHeight / 2 - 1, 2, 2);
      const el = ghost(layer, plan.card, w);
      // Lift to the centre, hold so it can be read, then fly to the stack.
      el.animate([
        { transform: at(from, w, h, from.width / w), opacity: 0.9 },
        { transform: at(centre, w, h, 1.9), opacity: 1, offset: 0.35 },
        { transform: at(centre, w, h, 1.9), opacity: 1, offset: 0.7 },
        { transform: at(visible(stack) ? stack : centre, w, h, 0.35), opacity: 0 },
      ], { duration: time(1400), easing: 'ease-in-out', fill: 'both' }).finished.finally(() => el.remove());
    } else if (plan.kind === 'enter' && (animationOn('enter') || plan.ring && animationOn('ring'))) {
      const el = cardEl(root, plan.cardId);
      if (!el) continue;
      if (animationOn('enter')) {
        el.animate([
          { transform: 'translateY(-28px) scale(1.18)', boxShadow: style.getPropertyValue('--card-shadow-lifted'), offset: 0 },
          { transform: 'translateY(-28px) scale(1.18)', boxShadow: style.getPropertyValue('--card-shadow-lifted'), offset: 0.45 },
          { transform: 'translateY(2px) scale(0.98)', offset: 0.85 },
          { transform: 'none' },
        ], { duration: time(750), easing: 'ease-out', composite: 'add' });
      }
      if (plan.ring && animationOn('ring')) {
        const ring = style.getPropertyValue('--anim-ring');
        el.animate([
          { boxShadow: `0 0 0 0 ${ring}` },
          { boxShadow: `0 0 0 6px ${ring}`, offset: 0.4 },
          { boxShadow: '0 0 0 14px transparent' },
        ], { duration: time(1100), delay: time(animationOn('enter') ? 500 : 0), easing: 'ease-out' });
      }
    } else if (plan.kind === 'counters' && animationOn('counters')) {
      const card = cardEl(root, plan.cardId);
      const el = card?.querySelector<HTMLElement>('.card__counters, .card__pt') ?? card;
      el?.animate([{ transform: 'scale(1)' }, { transform: 'scale(1.35)', offset: 0.4 }, { transform: 'scale(1)' }],
        { duration: time(500), easing: 'ease-out', composite: 'add' });
    } else if (plan.kind === 'equip' && animationOn('equip')) {
      // The card is already drawn behind its host: a copy flies there from where it was, then the card shows.
      const from = before.get(plan.card.id) ?? cardEl(root, plan.card.id)?.getBoundingClientRect(), host = cardEl(root, plan.hostId);
      const to = host?.getBoundingClientRect();
      if (!host || !visible(from) || !visible(to)) continue;
      const w = from.width, h = w * 7 / 5, el = ghost(layer, plan.card, w);
      const lift = new DOMRect((from.left + to.left) / 2, Math.min(from.top, to.top) - 50, from.width, from.height);
      el.animate([
        { transform: at(from, w, h), opacity: 1 },
        { transform: at(lift, w, h, 1.15), opacity: 1, offset: 0.5 },
        { transform: at(to, w, h, 0.8), opacity: 0 },
      ], { duration: time(700), easing: 'ease-in-out', fill: 'both' }).finished.finally(() => el.remove());
      host.animate([{ transform: 'scale(1)' }, { transform: 'scale(1.08)', offset: 0.5 }, { transform: 'scale(1)' }],
        { duration: time(350), delay: time(600), easing: 'ease-out', composite: 'add' });
      cardEl(root, plan.card.id)?.animate([{ opacity: 0 }, { opacity: 0, offset: 0.85 }, { opacity: 1 }], { duration: time(700) });
    } else if (plan.kind === 'zones' && animationOn('zones')) {
      const from = (plan.from === 'hand' ? before.get(plan.card.id) : undefined) ?? zoneRect(root, plan.playerId, plan.from);
      const to = zoneRect(root, plan.playerId, plan.to);
      if (!visible(from) || !visible(to)) continue;
      const w = 80, h = w * 7 / 5, el = ghost(layer, plan.card, w);
      // Arc towards the middle of the window, so boards at the top do not throw the card off screen.
      const arc = (from.top + to.top) / 2 < window.innerHeight / 2 ? 90 : -90;
      el.animate([
        { transform: at(from, w, h, Math.max(0.3, from.width / w)), opacity: 1 },
        { transform: at(new DOMRect((from.left + to.left) / 2, (from.top + to.top) / 2 + arc, from.width, from.height), w, h, 0.9), opacity: 1, offset: 0.45 },
        { transform: at(to, w, h, 0.25), opacity: 0 },
      ], { duration: time(800), delay: time(150 * moved++), easing: 'ease-in-out', fill: 'both' }).finished.finally(() => el.remove());
    } else if (plan.kind === 'dies' && animationOn('dies')) {
      // Fades and sinks from its last place on the battlefield into its owner's graveyard or exile.
      const from = before.get(plan.card.id), to = zoneRect(root, plan.playerId, plan.to);
      if (!visible(from) || !visible(to)) continue;
      const w = Math.min(from.width, from.height), h = w * 7 / 5, el = ghost(layer, plan.card, w);
      const grey = 'grayscale(1) brightness(0.6)';
      el.animate([
        { transform: at(from, w, h), opacity: 1, filter: 'none' },
        { transform: `${at(from, w, h, 1.05)} rotate(-4deg)`, opacity: 1, filter: grey, offset: 0.35 },
        { transform: `${at(to, w, h, 0.3)} rotate(-10deg)`, opacity: 0, filter: grey },
      ], { duration: time(900), delay: time(150 * moved++), easing: 'ease-in', fill: 'both' }).finished.finally(() => el.remove());
    } else if (plan.kind === 'life' && animationOn('life')) {
      const life = root.querySelector<HTMLElement>(`[data-player-id="${plan.playerId}"]`), r = life?.getBoundingClientRect();
      if (!life || !visible(r)) continue;
      const el = document.createElement('div');
      el.className = `life-float ${plan.delta < 0 ? 'life-float--loss' : 'life-float--gain'}`;
      el.textContent = plan.delta < 0 ? `−${-plan.delta}` : `+${plan.delta}`;
      el.style.left = `${r.left + r.width / 2}px`;
      el.style.top = `${r.top}px`;
      layer.append(el);
      el.animate([
        { transform: 'translate(-50%, 0)', opacity: 0 },
        { transform: 'translate(-50%, -26px)', opacity: 1, offset: 0.2 },
        { transform: 'translate(-50%, -52px)', opacity: 0 },
      ], { duration: time(1300), easing: 'ease-out', fill: 'both' }).finished.finally(() => el.remove());
      if (plan.delta < 0) {
        life.animate([{ transform: 'none' }, { transform: 'translateX(-4px)' }, { transform: 'translateX(4px)' }, { transform: 'translateX(-2px)' }, { transform: 'none' }],
          { duration: time(350), composite: 'add' });
      }
    }
  }
}
