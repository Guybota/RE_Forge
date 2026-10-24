import { useState } from 'react';
import type { CardState } from '../engine';
import { cardImage } from '../images';
import { colorKey, manaSymbols } from './cards';
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
};

export function Card({ card, size, selectable, chosen, target, onClick, onHover, count = 1 }: Props) {
  // In hand the card is shown as printed; on the table the drawn frame stays compact and readable.
  const [fullFailed, setFullFailed] = useState<string | null>(null);
  const t = useT();
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
  const pile = count > 1 && <span className="card__count" aria-hidden="true">×{count}</span>;
  const label = count > 1 ? `${card.name} ×${count}` : card.name;

  if (full) {
    return (
      <button
        type="button"
        className={classes}
        data-card-id={card.id}
        onClick={onClick}
        onMouseEnter={() => onHover?.(card)}
        onMouseLeave={() => onHover?.(null)}
        onFocus={() => onHover?.(card)}
        aria-label={label}
        aria-pressed={chosen}
      >
        <img src={full} alt="" decoding="async" onError={() => setFullFailed(full)} />
        {pile}
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
      onMouseEnter={() => onHover?.(card)}
      onMouseLeave={() => onHover?.(null)}
      onFocus={() => onHover?.(card)}
      aria-label={label}
      aria-pressed={chosen}
    >
      {pile}
      {card.commander && size !== 'mini' && <span className="card__tag">{t('commander')}</span>}
      <span className="card__top">
        <span className="card__name">{card.name}</span>
        {size !== 'land' && (
          <span className="card__cost">
            {manaSymbols(card.cost).map((s, i) => (
              <span key={i} className={`pip pip--${/^\d+$/.test(s) ? 'n' : s.replace('/', '')}`}>{/^\d+$|^X$/.test(s) ? s : ''}</span>
            ))}
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
