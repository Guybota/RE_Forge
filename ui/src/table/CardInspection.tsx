import { createElement, type HTMLAttributes } from 'react';
import type { CardState } from '../engine';
import { useCardInspection } from './useCardInspection';
import './inspection.css';
type InspectableProps = HTMLAttributes<HTMLElement> & {
  as?: 'li' | 'article' | 'button' | 'div' | 'span';
  card: CardState | null | undefined;
  disabled?: boolean;
  type?: 'button';
};

/** Keep existing list/article semantics; add a keyboard inspection stop without nesting buttons. */
export function InspectableCard({ as = 'article', card, children, title, onKeyDown, ...props }: InspectableProps) {
  const inspection = useCardInspection(card);
  const available = card && !card.hidden;
  return createElement(as, {
    ...props,
    ...(available ? inspection : {}),
    type: as === 'button' ? 'button' : undefined,
    tabIndex: available && as !== 'button' ? props.tabIndex ?? 0 : props.tabIndex,
    title,
    onKeyDown: (e: React.KeyboardEvent<HTMLElement>) => { if (available) inspection.onKeyDown(e); if (!e.defaultPrevented) onKeyDown?.(e); },
    className: [props.className, available && 'inspectable-card'].filter(Boolean).join(' '),
  }, children);
}

