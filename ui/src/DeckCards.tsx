import { useState } from 'react';
import type { DeckPreview } from './engine';
import { useT, type MessageKey } from './i18n';
import { cardImage } from './images';
import { InspectableCard } from './table/CardInspection';
import { cardForInspection } from './table/useCardInspection';

type Line = DeckPreview['lines'][number];

/** Full card beside the one under the pointer: to the right when it fits, otherwise to the left. */
export function CardBeside({ anchor, src }: { anchor: DOMRect; src: string }) {
  const width = 280;
  const height = width * 7 / 5;
  const pad = 12;
  const gap = 14;
  let x = anchor.right + gap;
  if (x + width > window.innerWidth - pad) x = anchor.left - gap - width;
  x = Math.max(pad, Math.min(x, window.innerWidth - pad - width));
  const y = Math.max(pad, Math.min(anchor.top, window.innerHeight - pad - height));
  return <img className="card-beside" style={{ left: x, top: y, width }} src={src} alt="" />;
}

const euros = (n: number) => new Intl.NumberFormat(document.documentElement.lang || undefined, { style: 'currency', currency: 'EUR' }).format(n);
export const GROUPS: { id: string; label: MessageKey }[] = [
  { id: 'commander', label: 'commander' }, { id: 'creature', label: 'groupCreatures' }, { id: 'planeswalker', label: 'groupPlaneswalkers' },
  { id: 'instant', label: 'groupInstants' }, { id: 'sorcery', label: 'groupSorceries' }, { id: 'artifact', label: 'groupArtifacts' },
  { id: 'enchantment', label: 'groupEnchantments' }, { id: 'battle', label: 'groupBattles' }, { id: 'land', label: 'groupLands' },
  { id: 'other', label: 'groupOther' },
];

/**
 * A checked decklist: summary, then cards grouped by type. Hover shows the card, right click zooms it. On the import
 * screen, possible commanders can be chosen and unknown lines replaced by a suggested card.
 */
export function DeckCards({ preview, onCommander, onReplace, faces = false, prices }: {
  preview: Omit<DeckPreview, 'type'>;
  onCommander?: (nameEn: string) => void;
  onReplace?: (requested: string, nameEn: string) => void;
  /** Card faces instead of names. Prices, when known, stay hidden until the card is hovered. */
  faces?: boolean;
  prices?: Map<string, number>;
}) {
  const t = useT();
  const [hovered, setHovered] = useState<Line | null>(null);
  const [anchor, setAnchor] = useState<DOMRect | null>(null);
  const show = (l: Line, el: HTMLElement) => { setHovered(l); setAnchor(el.getBoundingClientRect()); };
  const hide = () => { setHovered(null); setAnchor(null); };
  const loose = preview.lines.filter((l) => !l.group);
  const picture = hovered?.imageKey ? cardImage(hovered.imageKey, 'full') : null;
  const line = (l: Line, i: number) => {
    const lead = onCommander && l.canCommand && l.group !== 'commander' && l.nameEn;
    const fixes = onReplace && l.requested && l.suggestions?.length ? l.suggestions : null;
    return (
      <InspectableCard as="li" card={l.imageKey ? cardForInspection(l) : null} key={i}
        className={`import__line import__line--${l.status}${lead || fixes ? ' import__line--actions' : ''}`} title={l.message ?? l.text}
        onMouseEnter={(e) => show(l, e.currentTarget)} onMouseLeave={hide} onFocus={(e) => show(l, e.currentTarget)} onBlur={hide}>
        <span className="import__text">{l.group ? <><span className="import__qty">{l.qty}</span> {l.name}</> : l.text}</span>
        {lead && <button type="button" className="import__fix" title={t('makeCommanderHint')} aria-label={t('setCommander', { name: l.name ?? lead })}
          onClick={() => onCommander(lead)}>{t('commander')}</button>}
        {fixes?.map((s) => <button key={s.nameEn} type="button" className="import__fix" title={t('replaceWith', { name: s.nameEn })}
          aria-label={t('replaceWith', { name: s.name })} onClick={() => onReplace!(l.requested!, s.nameEn)}>{s.name}</button>)}
      </InspectableCard>
    );
  };

  return (
    <section className="import__preview" aria-live="polite">
      <p className="import__summary">
        <span>{t('cardsCount', { n: preview.cards ?? 0 })}</span>
        {preview.unknown > 0 && <span className="danger">{t('unknownCount', { n: preview.unknown })}</span>}
        {preview.problem && <span className="import__problem" title={preview.problem}>{t('notLegal')}</span>}
      </p>
      <div className={faces ? 'deck-face-groups' : 'import__groups'}>
        {loose.length > 0 && <ul className="import__lines">{loose.map(line)}</ul>}
        {[...GROUPS, { id: 'sideboard', label: 'groupSideboard' as MessageKey }].map((g) => {
          const lines = preview.lines.filter((l) => g.id === 'sideboard' ? l.sideboard : l.group === g.id && !l.sideboard);
          if (!lines.length) return null;
          const count = lines.reduce((n, l) => n + (l.qty ?? 0), 0);
          return (
            <section key={g.id} className="import__group">
              <h2>{t(g.label)} <span className="muted">{count}</span></h2>
              {faces ? (
                <ul className="deck-faces">{lines.map((l, i) => {
                  const src = l.imageKey ? cardImage(l.imageKey, 'full') : null;
                  const price = l.set && l.number ? prices?.get(`${l.set}/${l.number}`) : undefined;
                  return (
                    <InspectableCard as="li" card={l.imageKey ? cardForInspection(l) : null} key={`${l.nameEn}-${i}`}>
                      <button type="button" className="deck-face" aria-label={l.name ?? l.text}
                        onMouseEnter={(e) => show(l, e.currentTarget)} onMouseLeave={hide}
                        onFocus={(e) => show(l, e.currentTarget)} onBlur={hide}>
                        {src && <img src={src} alt="" />}
                        {(l.qty ?? 0) > 1 && <span className="deck-face__qty">{l.qty}</span>}
                        {price != null && <span className="deck-face__price">{euros(price)}</span>}
                      </button>
                    </InspectableCard>
                  );
                })}</ul>
              ) : <ul className="import__lines">{lines.map(line)}</ul>}
            </section>
          );
        })}
      </div>
      {picture && anchor && faces && <CardBeside anchor={anchor} src={picture} />}
      {picture && !faces && <img className="import__picture" src={picture} alt="" aria-hidden="true" />}
    </section>
  );
}
