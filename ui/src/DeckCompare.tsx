import { useId, useMemo, useState } from 'react';
import { deckFromLines } from './deckTools/cardVisual';
import { compareDecks } from './deckTools/compare';
import type { CompareRow } from './deckTools/types';
import { reply, useRequest } from './deckRequests';
import { Unavailable } from './DeckOnline';
import type { DeckDetail, DeckPreview } from './engine';
import { useT } from './i18n';
import { InspectableCard } from './table/CardInspection';
import { cardForInspection } from './table/useCardInspection';
import type { Engine } from './useEngine';

type Line = DeckPreview['lines'][number];
type Other = { name: string; source: 'mine' | 'precon' };

/** This deck beside another one (own or precon): shared cards, cards only in either, different quantities. */
export function DeckCompare({ detail, engine }: { detail: DeckDetail; engine: Engine }) {
  const t = useT();
  const id = useId();
  const { send, decks } = engine;
  const [other, setOther] = useState<Other | null>(null);
  const request = useRequest((requestId) => { if (other) send({ type: 'deckLines', requestId, name: other.name, source: other.source }); },
    [other?.name, other?.source, send]);
  const answer = other ? reply(engine, 'deckLines', request.id.current) : null;
  const theirs = answer?.type === 'deckLines' && answer.name === other?.name ? answer : null;

  const result = useMemo(() => {
    if (!theirs) return null;
    const a = deckFromLines(detail.name, detail.lines, detail.identity).deck;
    const b = deckFromLines(theirs.name, theirs.lines, theirs.identity).deck;
    return compareDecks(a, b);
  }, [detail, theirs]);
  const names = useMemo(() => {
    const map = new Map<string, Line>();
    for (const l of [...(theirs?.lines ?? []), ...detail.lines]) if (l.nameEn) map.set(l.nameEn.toLowerCase(), l);
    return map;
  }, [detail, theirs]);

  const card = (row: CompareRow, extra = '') => {
    const line = names.get(row.name.toLowerCase());
    return <InspectableCard as="li" key={row.name} card={line?.imageKey ? cardForInspection(line) : null} className="deck-analysis__name">
      {line?.name ?? row.name}{extra}</InspectableCard>;
  };
  const group = (title: string, rows: CompareRow[], extra?: (row: CompareRow) => string) => rows.length > 0 && (
    <section className="deck-analysis__panel" aria-label={title}>
      <h2>{title} <span className="muted">{rows.length}</span></h2>
      <ul className="deck-analysis__names">{rows.map((row) => card(row, extra?.(row)))}</ul>
    </section>
  );
  const others = decks.mine.filter((n) => n !== detail.name);

  return (
    <div className="deck-online">
      <div className="deck-notes__field deck-compare__pick">
        <label htmlFor={`${id}-other`}>{t('compareWith')}</label>
        <select id={`${id}-other`} className="input" value={other ? `${other.source}:${other.name}` : ''} onChange={(e) => {
          const [source, ...name] = e.target.value.split(':');
          setOther(e.target.value ? { source: source as Other['source'], name: name.join(':') } : null);
        }}>
          <option value="">{t('comparePick')}</option>
          {others.length > 0 && <optgroup label={t('myDecks')}>{others.map((n) => <option key={n} value={`mine:${n}`}>{n}</option>)}</optgroup>}
          <optgroup label={t('precons')}>{decks.precons.map((n) => <option key={n} value={`precon:${n}`}>{n}</option>)}</optgroup>
        </select>
      </div>
      {other && answer?.type === 'servicesError' && <Unavailable onRetry={request.retry} />}
      {other && !result && answer?.type !== 'servicesError' && <p className="muted" role="status">{t('connecting')}</p>}
      {result && theirs && <>
        {result.commanderRows.some((r) => r.kind !== 'shared') && group(t('compareCommanders'), result.commanderRows,
          (r) => r.kind === 'onlyA' ? ` · ${detail.name}` : r.kind === 'onlyB' ? ` · ${theirs.name}` : '')}
        {group(t('compareOnly', { deck: detail.name }), result.rows.filter((r) => r.kind === 'onlyA'), (r) => r.kind === 'onlyA' && r.quantity > 1 ? ` ×${r.quantity}` : '')}
        {group(t('compareOnly', { deck: theirs.name }), result.rows.filter((r) => r.kind === 'onlyB'), (r) => r.kind === 'onlyB' && r.quantity > 1 ? ` ×${r.quantity}` : '')}
        {group(t('compareQty'), result.rows.filter((r) => r.kind === 'qtyDiff'), (r) => r.kind === 'qtyDiff' ? ` ${r.qtyA} → ${r.qtyB}` : '')}
        {group(t('compareShared'), result.rows.filter((r) => r.kind === 'shared'))}
      </>}
    </div>
  );
}
