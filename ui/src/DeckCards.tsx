import { useContext, useState } from 'react';
import type { DeckPreview } from './engine';
import { useT, type MessageKey } from './i18n';
import { cardImage } from './images';
import { CardZoom } from './table/CardZoom';

type Line = DeckPreview['lines'][number];
const GROUPS: { id: string; label: MessageKey }[] = [
  { id: 'commander', label: 'commander' }, { id: 'creature', label: 'groupCreatures' }, { id: 'planeswalker', label: 'groupPlaneswalkers' },
  { id: 'instant', label: 'groupInstants' }, { id: 'sorcery', label: 'groupSorceries' }, { id: 'artifact', label: 'groupArtifacts' },
  { id: 'enchantment', label: 'groupEnchantments' }, { id: 'battle', label: 'groupBattles' }, { id: 'land', label: 'groupLands' },
  { id: 'other', label: 'groupOther' },
];

/** A checked decklist: summary, then cards grouped by type. Hover shows the card, right click zooms it. */
export function DeckCards({ preview }: { preview: Omit<DeckPreview, 'type'> }) {
  const t = useT();
  const zoom = useContext(CardZoom);
  const [hovered, setHovered] = useState<Line | null>(null);
  const loose = preview.lines.filter((l) => !l.group);
  const picture = hovered?.imageKey ? cardImage(hovered.imageKey, 'full') : null;
  const line = (l: Line, i: number) => (
    <li key={i} className={`import__line import__line--${l.status}`} title={l.message ?? l.text}
      onMouseEnter={() => setHovered(l)} onMouseLeave={() => setHovered(null)}
      onContextMenu={l.imageKey ? (e) => { e.preventDefault(); zoom({ id: -1, name: l.name, imageKey: l.imageKey }); } : undefined}>
      {l.group ? <><span className="import__qty">{l.qty}</span> {l.name}</> : l.text}
    </li>
  );

  return (
    <section className="import__preview" aria-live="polite">
      <p className="import__summary">
        <span>{t('cardsCount', { n: preview.cards ?? 0 })}</span>
        {preview.unknown > 0 && <span className="danger">{t('unknownCount', { n: preview.unknown })}</span>}
        {preview.problem && <span className="import__problem" title={preview.problem}>{t('notLegal')}</span>}
      </p>
      <div className="import__groups">
        {loose.length > 0 && <ul className="import__lines">{loose.map(line)}</ul>}
        {GROUPS.map((g) => {
          const lines = preview.lines.filter((l) => l.group === g.id);
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
