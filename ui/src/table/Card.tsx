import { useContext, useRef, useState } from 'react';
import type { CardState } from '../engine';
import { cardImage } from '../images';
import { colorKey, manaSymbols } from './cards';
import { CardZoom } from './CardZoom';
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
  const zoom = useContext(CardZoom);
  // Touch has no right click: a long press zooms instead, and the click that ends it is swallowed.
  const press = useRef<number | undefined>(undefined);
  const longPressed = useRef(false);
  const endPress = () => window.clearTimeout(press.current);
  const zoomProps = {
    onContextMenu: (e: React.MouseEvent) => { e.preventDefault(); zoom(card); },
    onPointerDown: (e: React.PointerEvent) => {
      if (e.pointerType !== 'touch') return;
      longPressed.current = false;
      press.current = window.setTimeout(() => { longPressed.current = true; zoom(card); }, 450);
    },
    onPointerUp: endPress,
    onPointerCancel: endPress,
    onPointerLeave: endPress,
  };
  const click = onClick && (() => {
    if (longPressed.current) { longPressed.current = false; return; }
    onClick();
  });
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
  const label = count > 1 ? `${card.name} ×${count}` : card.name;

  if (full) {
    return (
      <button
        type="button"
        className={classes}
        data-card-id={card.id}
        onClick={click}
        {...zoomProps}
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
      onClick={click}
      {...zoomProps}
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
