import { useContext, useEffect, useRef, useState } from 'react';
import type { DeckPreview } from './engine';
import { useT, type MessageKey } from './i18n';
import { cardImage } from './images';
import { CardZoom } from './table/CardZoom';
import { InspectableCard } from './table/CardInspection';
import { cardForInspection } from './table/useCardInspection';

type Line = DeckPreview['lines'][number];
export type FacePrice = { eur: number; exact: boolean };
export type BestPrice = { set: string; eur: number };

/** Full card beside the one under the pointer: to the right when it fits, otherwise to the left. */
export function CardBeside({ anchor, src }: { anchor: DOMRect; src: string }) {
  const width = Math.min(320, window.innerWidth - 48, (window.innerHeight - 24) * 5 / 7);
  const height = width * 7 / 5;
  const pad = 12;
  const gap = 16;
  let x = anchor.right + gap;
  if (x + width > window.innerWidth - pad) x = anchor.left - gap - width;
  x = Math.max(pad, Math.min(x, window.innerWidth - pad - width));
  const y = Math.max(pad, Math.min(anchor.top, window.innerHeight - pad - height));
  return <img className="card-beside" style={{ left: x, top: y, width, height }} src={src} alt="" />;
}

const amount = (n: number) => new Intl.NumberFormat(document.documentElement.lang || undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(n);
const euros = (n: number) => `€${amount(n)}`;
export const GROUPS: { id: string; label: MessageKey }[] = [
  { id: 'commander', label: 'commander' }, { id: 'creature', label: 'groupCreatures' }, { id: 'planeswalker', label: 'groupPlaneswalkers' },
  { id: 'instant', label: 'groupInstants' }, { id: 'sorcery', label: 'groupSorceries' }, { id: 'artifact', label: 'groupArtifacts' },
  { id: 'enchantment', label: 'groupEnchantments' }, { id: 'battle', label: 'groupBattles' }, { id: 'land', label: 'groupLands' },
  { id: 'other', label: 'groupOther' },
];

const printingKey = (l: Line) => l.set && l.number ? `${l.set}/${l.number}` : '';

/**
 * A checked decklist: summary, then cards grouped by type. Hover shows the card, right click zooms it. On the import
 * screen, possible commanders can be chosen and unknown lines replaced by a suggested card.
 */
export function DeckCards({ preview, onCommander, onReplace, faces = false, prices, best, editable, onChangePrinting, onRemove, onDemote }: {
  preview: Omit<DeckPreview, 'type'>;
  onCommander?: (nameEn: string) => void;
  onReplace?: (requested: string, nameEn: string) => void;
  /** Card faces instead of names, in the page flow. */
  faces?: boolean;
  prices?: Map<string, FacePrice>;
  best?: Map<string, BestPrice>;
  /** Owned decks can change a printing, drop a card, or stop it being the commander. */
  editable?: boolean;
  onChangePrinting?: (line: Line) => void;
  onRemove?: (line: Line) => void;
  onDemote?: (line: Line) => void;
}) {
  const t = useT();
  const zoom = useContext(CardZoom);
  const [hovered, setHovered] = useState<Line | null>(null);
  const [anchor, setAnchor] = useState<DOMRect | null>(null);
  const [menu, setMenu] = useState<{ id: string; line: Line; x: number; y: number } | null>(null);
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
      <div className={faces ? 'deck-face-groups deck-gallery' : 'import__groups'}>
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
                  const key = printingKey(l);
                  const price = key ? prices?.get(key) : undefined;
                  const cheaper = key ? best?.get(key) : undefined;
                  const id = `${g.id}:${key}:${i}`;
                  return (
                    <InspectableCard as="li" card={l.imageKey ? cardForInspection(l) : null} key={id} className="deck-face-wrap"
                      onMouseEnter={(e) => show(l, e.currentTarget)} onMouseLeave={hide}>
                      <button type="button" className="deck-face" aria-label={l.name ?? l.text}
                        onFocus={(e) => show(l, e.currentTarget)} onBlur={hide}>
                        {src && <img src={src} alt="" />}
                        {(l.qty ?? 0) > 1 && <span className="deck-face__qty">{l.qty}</span>}
                        {price && <span className="deck-face__price" title={price.exact ? undefined : t('priceApproxHint')}>
                          <span>{t('facePrice', { set: l.set ?? '', price: euros(price.eur) })}</span>
                          {cheaper && <span>{t('faceBestPrice', { set: cheaper.set, price: euros(cheaper.eur) })}</span>}
                        </span>}
                      </button>
                      <button type="button" className="deck-face__menu" aria-haspopup="menu" aria-expanded={menu?.id === id} aria-label={t('cardMenu')}
                        onClick={(e) => {
                          const rect = e.currentTarget.getBoundingClientRect();
                          setMenu(menu?.id === id ? null : { id, line: l, x: rect.right, y: rect.bottom });
                        }}>
                        <span><span className="deck-face__dots" /></span>
                      </button>
                    </InspectableCard>
                  );
                })}</ul>
              ) : <ul className="import__lines">{lines.map(line)}</ul>}
            </section>
          );
        })}
      </div>
      {picture && anchor && faces && !menu && <CardBeside anchor={anchor} src={picture} />}
      {picture && !faces && <img className="import__picture" src={picture} alt="" aria-hidden="true" />}
      {menu && <CardMenu line={menu.line} x={menu.x} y={menu.y} editable={editable} onClose={() => setMenu(null)}
        onChangePrinting={onChangePrinting} onRemove={onRemove} onDemote={onDemote}
        onView={() => { if (menu.line.imageKey) zoom(cardForInspection(menu.line)); }} />}
    </section>
  );
}

function CardMenu({ line, x, y, editable, onClose, onChangePrinting, onRemove, onDemote, onView }: {
  line: Line;
  x: number;
  y: number;
  editable?: boolean;
  onClose: () => void;
  onChangePrinting?: (line: Line) => void;
  onRemove?: (line: Line) => void;
  onDemote?: (line: Line) => void;
  onView: () => void;
}) {
  const t = useT();
  const ref = useRef<HTMLDivElement>(null);
  const [copied, setCopied] = useState(false);
  useEffect(() => {
    const close = (e: MouseEvent) => { if (!ref.current?.contains(e.target as Node)) onClose(); };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { onClose(); return; }
      const key = e.key.toLowerCase();
      const done = (run?: () => void) => { run?.(); onClose(); };
      if (editable && key === 'p' && line.nameEn) { e.preventDefault(); done(() => onChangePrinting?.(line)); }
      else if (key === 'n') { e.preventDefault(); void navigator.clipboard.writeText(line.name ?? line.nameEn ?? '').then(() => setCopied(true)).catch(() => {}); }
      else if (editable && (e.key === 'Delete' || e.key === 'Backspace')) { e.preventDefault(); done(() => onRemove?.(line)); }
      else if (editable && key === 'd' && line.group === 'commander') { e.preventDefault(); done(() => onDemote?.(line)); }
      else if (key === 'i') { e.preventDefault(); done(onView); }
    };
    window.addEventListener('mousedown', close);
    window.addEventListener('keydown', onKey);
    return () => { window.removeEventListener('mousedown', close); window.removeEventListener('keydown', onKey); };
  }, [editable, line, onChangePrinting, onClose, onDemote, onRemove, onView]);
  useEffect(() => {
    const place = () => {
      const el = ref.current;
      if (!el) return;
      const rect = el.getBoundingClientRect();
      const left = Math.max(8, Math.min(x - rect.width, window.innerWidth - rect.width - 8));
      const top = y + rect.height > window.innerHeight - 8 ? Math.max(8, y - rect.height - 48) : y + 4;
      el.style.left = `${left}px`;
      el.style.top = `${top}px`;
    };
    place();
  }, [x, y]);
  const copy = async () => {
    try { await navigator.clipboard.writeText(line.name ?? line.nameEn ?? ''); setCopied(true); } catch { /* the menu stays open */ }
  };
  const buy = line.nameEn ? `https://www.cardmarket.com/en/Magic/Products/Search?searchString=${encodeURIComponent(line.nameEn)}` : '';
  const act = (run?: () => void) => { run?.(); onClose(); };
  return (
    <div ref={ref} className="deck-face__options" role="menu" style={{ left: x, top: y }}>
      {editable && line.nameEn && <button type="button" role="menuitem" onClick={() => act(() => onChangePrinting?.(line))}>{t('menuChangePrinting')}<kbd>P</kbd></button>}
      <button type="button" role="menuitem" onClick={copy}>{t(copied ? 'copied' : 'menuCopyName')}<kbd>N</kbd></button>
      {editable && <button type="button" role="menuitem" className="is-danger" onClick={() => act(() => onRemove?.(line))}>{t('menuRemove')}<kbd>DEL</kbd></button>}
      {editable && line.group === 'commander' && <button type="button" role="menuitem" onClick={() => act(() => onDemote?.(line))}>{t('menuRemoveCommander')}<kbd>D</kbd></button>}
      <button type="button" role="menuitem" onClick={() => act(onView)}>{t('menuViewCard')}<kbd>I</kbd></button>
      {buy && <a role="menuitem" href={buy} target="_blank" rel="noreferrer" onClick={onClose}>{t('menuBuy')}</a>}
    </div>
  );
}
