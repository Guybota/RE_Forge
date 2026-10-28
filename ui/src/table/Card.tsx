import { useState } from 'react';
import type { CardState } from '../engine';
import { cardImage } from '../images';
import { ManaCost } from '../ManaSymbol';
import { colorKey } from './cards';
import { useCardInspection } from './useCardInspection';
import { useT } from '../i18n';

type Props = {
  card: CardState;
  size: 'land' | 'field' | 'hand' | 'mini';
  selectable?: boolean;
  chosen?: boolean;
  target?: boolean;
  onClick?: () => void;
  onHover?: (card: CardState | null) => void;
  /** Identical cards shown as this one; above 1 the card is drawn as a pile with a count. */
  count?: number;
  /** A small corner label, e.g. the commander tax. */
  badge?: { text: string; title: string };
};

export function Card({ card, size, selectable, chosen, target, onClick, onHover, count = 1, badge }: Props) {
  // In hand the card is shown as printed; on the table the drawn frame stays compact and readable.
  const [fullFailed, setFullFailed] = useState<string | null>(null);
  const t = useT();
  const zoomProps = useCardInspection(card);
  const requestedFull = size === 'hand' ? cardImage(card.imageKey, 'full') : null;
  const full = requestedFull !== fullFailed ? requestedFull : null;

  if (card.hidden) {
    return <div className={`card card--${size} card--back`} aria-label={t('hiddenCard')} />;
  }
  const classes = [
    'card',
    `card--${size}`,
    `card--c${colorKey(card)}`,
    card.tapped && 'is-tapped',
    card.attacking && 'is-attacking',
    selectable && 'is-selectable',
    chosen && 'is-chosen',
    target && 'is-target',
    card.actionable && 'is-actionable',
    full && 'card--printed',
    count > 1 && 'card--pile',
  ].filter(Boolean).join(' ');
  const pile = (count > 1 || badge) && <span className="card__count" title={badge?.title} aria-hidden={!badge}>{badge ? badge.text : `×${count}`}</span>;
  const states = [chosen && t('cardSelected'), selectable && t('cardSelectable'), card.actionable && t('cardAvailable'), target && t('cardTarget')].filter(Boolean);
  const label = [count > 1 ? `${card.name} ×${count}` : card.name, ...states].filter(Boolean).join(', ');
  const stateMark = chosen
    ? <span className="card__state" aria-hidden="true"><svg viewBox="0 0 16 16"><path d="m3 8 3 3 7-7" /></svg></span>
    : card.actionable && <span className="card__state card__state--available" aria-hidden="true"><svg viewBox="0 0 16 16"><path d="m6 3 6 5-6 5Z" /></svg></span>;

  if (full) {
    return (
      <button
        type="button"
        className={classes}
        data-card-id={card.id}
        onClick={onClick}
        {...zoomProps}
        onMouseEnter={() => onHover?.(card)}
        onMouseLeave={() => onHover?.(null)}
        onFocus={() => onHover?.(card)}
        aria-label={label}
        aria-pressed={chosen}
      >
        <img src={full} alt="" decoding="async" onError={() => setFullFailed(full)} />
        {pile}
        {stateMark}
      </button>
    );
  }
  const art = cardImage(card.imageKey, 'crop');
  const pt = card.power !== undefined ? `${card.power}/${card.toughness}` : card.loyalty ?? card.defense;
  // Without a click handler (e.g. a skin preview inside another button) it's just a picture.
  const Tag = onClick ? 'button' : 'div';

  return (
    <Tag
      type={onClick ? 'button' : undefined}
      role={onClick ? undefined : 'img'}
      className={classes}
      data-card-id={card.id}
      onClick={onClick}
      {...zoomProps}
      onMouseEnter={() => onHover?.(card)}
      onMouseLeave={() => onHover?.(null)}
      onFocus={() => onHover?.(card)}
      aria-label={label}
      aria-pressed={chosen}
    >
      {pile}
      {stateMark}
      {card.commander && size !== 'mini' && <span className="card__tag">{t('commander')}</span>}
      <span className="card__top">
        <span className="card__name">{card.name}</span>
        {size !== 'land' && (
          <span className="card__cost">
            <ManaCost cost={card.cost} className="card__cost-icons" />
          </span>
        )}
      </span>
      <span className="card__art">
        {art && <img key={art} src={art} alt="" loading="lazy" decoding="async" onError={(e) => { e.currentTarget.hidden = true; }} />}
      </span>
      {size !== 'land' && size !== 'mini' && <span className="card__type">{card.type}</span>}
      {(pt !== undefined || !!card.damage) && size !== 'land' && (
        <span className="card__pt">{pt}{card.damage ? <em> −{card.damage}</em> : null}</span>
      )}
      {card.counters && size !== 'land' && (
        <span className="card__counters">
          {Object.entries(card.counters).map(([k, v]) => <span key={k} title={k}>{v}</span>)}
        </span>
      )}
    </Tag>
  );
}
