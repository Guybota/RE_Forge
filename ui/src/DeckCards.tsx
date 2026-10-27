import { useState } from 'react';
import type { DeckPreview } from './engine';
import { useT, type MessageKey } from './i18n';
import { cardImage } from './images';
import { InspectableCard } from './table/CardInspection';
import { cardForInspection } from './table/useCardInspection';

type Line = DeckPreview['lines'][number];
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
export function DeckCards({ preview, onCommander, onReplace }: {
  preview: Omit<DeckPreview, 'type'>;
  onCommander?: (nameEn: string) => void;
  onReplace?: (requested: string, nameEn: string) => void;
}) {
  const t = useT();
  const [hovered, setHovered] = useState<Line | null>(null);
  const loose = preview.lines.filter((l) => !l.group);
  const picture = hovered?.imageKey ? cardImage(hovered.imageKey, 'full') : null;
  const line = (l: Line, i: number) => {
    const lead = onCommander && l.canCommand && l.group !== 'commander' && l.nameEn;
    const fixes = onReplace && l.requested && l.suggestions?.length ? l.suggestions : null;
    return (
      <InspectableCard as="li" card={l.imageKey ? cardForInspection(l) : null} key={i}
        className={`import__line import__line--${l.status}${lead || fixes ? ' import__line--actions' : ''}`} title={l.message ?? l.text}
        onMouseEnter={() => setHovered(l)} onMouseLeave={() => setHovered(null)} onFocus={() => setHovered(l)}>
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
      <div className="import__groups">
        {loose.length > 0 && <ul className="import__lines">{loose.map(line)}</ul>}
        {[...GROUPS, { id: 'sideboard', label: 'groupSideboard' as MessageKey }].map((g) => {
          const lines = preview.lines.filter((l) => g.id === 'sideboard' ? l.sideboard : l.group === g.id && !l.sideboard);
          if (!lines.length) return null;
          const count = lines.reduce((n, l) => n + (l.qty ?? 0), 0);
          return (
            <section key={g.id} className="import__group">
              <h2>{t(g.label)} <span className="muted">{count}</span></h2>
              <ul className="import__lines">{lines.map(line)}</ul>
            </section>
          );
        })}
      </div>
      {picture && <img className="import__picture" src={picture} alt="" aria-hidden="true" />}
    </section>
  );
}
