import { useEffect, useId, useMemo, useState } from 'react';
import { DeckStatistics } from './DeckStatistics';
import type { DeckEntry, DeckFilter } from './deckAnalysis';
import { estimateBracket, type BracketTriggerKind } from './deckTools/bracket';
import { deckFromLines } from './deckTools/cardVisual';
import { checkCommanderDeck, type CommanderIssue } from './deckTools/commander-check';
import { readDeckRoles, weakSlots, type RoleKey, type WeakSlot } from './deckTools/deck-roles';
import { commanderFlags } from './deckTools/partner';
import type { CatalogCard, DeckDetail, DeckPreview } from './engine';
import { useT, type MessageKey } from './i18n';
import { cardImage } from './images';
import { InspectableCard } from './table/CardInspection';
import { cardForInspection } from './table/useCardInspection';
import type { Engine } from './useEngine';

type Line = DeckPreview['lines'][number];
const ROLES: RoleKey[] = ['lands', 'ramp', 'draw', 'removal', 'wipes', 'protection'];
const TRIGGERS: { kind: BracketTriggerKind; key: 'gameChangers' | 'fastMana' | 'massLandDenial' | 'extraTurns'; label: MessageKey }[] = [
  { kind: 'game-changer', key: 'gameChangers', label: 'bracketGameChangers' },
  { kind: 'fast-mana', key: 'fastMana', label: 'bracketFastMana' },
  { kind: 'mld', key: 'massLandDenial', label: 'bracketMassLandDenial' },
  { kind: 'extra-turn', key: 'extraTurns', label: 'bracketExtraTurns' },
];
const COLOR_KEYS: Record<string, MessageKey> = { W: 'colorW', U: 'colorU', B: 'colorB', R: 'colorR', G: 'colorG' };
const HAND = 7;

/** English card names as inspectable chips with the player's language name. */
function CardNames({ names, lines }: { names: string[]; lines: Map<string, Line> }) {
  return <ul className="deck-analysis__names">{names.map((n) => {
    const line = lines.get(n);
    return <InspectableCard as="li" key={n} card={line?.imageKey ? cardForInspection(line) : null} className="deck-analysis__name">
      {line?.name ?? n}</InspectableCard>;
  })}</ul>;
}

function issueText(t: ReturnType<typeof useT>, issue: CommanderIssue, size: number, identity: string): string {
  if (issue.kind === 'command-zone') return t(`commanderIssue_${issue.code ?? 'pair'}` as MessageKey);
  if (issue.kind === 'deck-size') return t('commanderIssue_size', { n: size });
  if (issue.kind === 'color-identity') return t('commanderIssue_identity', { identity: identity || '—' });
  return t(`commanderIssue_${issue.kind}` as MessageKey);
}

function slotText(t: ReturnType<typeof useT>, slot: WeakSlot): string {
  if (slot.code === 'no-wipe') return t('weakSlot_noWipe');
  if (slot.code === 'thin-color') return t('weakSlot_color', { color: t(COLOR_KEYS[slot.color]), pips: slot.pips, sources: slot.sources });
  return t(`weakSlot_${slot.code}` as MessageKey, { n: slot.count });
}

function shuffled<T>(items: T[]): T[] {
  const out = [...items];
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

/** Central's deck reading on a Forge deck: bracket, Commander rules, card jobs, statistics and a sample hand. */
export function DeckAnalysis({ detail }: { detail: DeckDetail }) {
  const t = useT();
  const { deck, visuals } = useMemo(() => deckFromLines(detail.name, detail.lines, detail.identity), [detail]);
  const lines = useMemo(() => new Map(detail.lines.filter((l) => l.nameEn).map((l) => [l.nameEn!, l])), [detail]);
  const get = (name: string) => visuals.get(name);
  const bracket = useMemo(() => estimateBracket(deck), [deck]);
  const check = useMemo(() => checkCommanderDeck(deck, (n) => visuals.get(n)), [deck, visuals]);
  const roles = useMemo(() => readDeckRoles(deck, (n) => visuals.get(n)), [deck, visuals]);
  const companions = (deck.sideboard ?? []).filter((c) => commanderFlags(get(c.name)).companion).map((c) => c.name);
  const entries: DeckEntry[] = useMemo(() => detail.lines.filter((l) => l.nameEn && l.qty && !l.sideboard && !l.maybeboard)
    .map((l) => ({ ...(l as CatalogCard), group: l.typeGroup ?? l.group ?? 'other', qty: l.qty ?? 1, commander: l.group === 'commander' })), [detail]);
  const [filter, setFilter] = useState<DeckFilter>(null);
  const [includeCommanders, setIncludeCommanders] = useState(false);

  // Sample hand: the 99 shuffled; the commander stays in the command zone.
  const library = useMemo(() => deck.cards.flatMap((c) => Array.from({ length: c.quantity }, () => c.name)), [deck]);
  const [hand, setHand] = useState<{ library: string[]; order: string[] } | null>(null);
  const order = hand?.library === library ? hand.order : null;
  const [drawn, setDrawn] = useState(HAND);
  const newHand = () => { setHand({ library, order: shuffled(library) }); setDrawn(HAND); };

  const identity = (deck.colorIdentity ?? []).join('');
  const intent = detail.bracketIntent;
  return (
    <div className="deck-analysis">
      <section className="deck-analysis__panel" aria-labelledby="deck-bracket">
        <h2 id="deck-bracket" title={t('bracketDisclaimer')}>{t('bracketTitle')}</h2>
        <p className="deck-analysis__bracket">
          <strong>{bracket.bracket}</strong>
          <span>{t(`bracket${bracket.bracket}` as MessageKey)}</span>
          {intent > 0 && <span className={intent === bracket.bracket ? 'muted' : 'deck-analysis__warn'}>{t('bracketIntentIs', { n: intent })}</span>}
        </p>
        <p>{t(`bracketRule_${bracket.ruleId}` as MessageKey, { gc: bracket.gameChangers.length, fm: bracket.fastMana.length })}</p>
        <p className="muted">{t(`bracketNote${bracket.bracket}` as MessageKey)}</p>
        {TRIGGERS.map(({ key, label }) => bracket[key].length > 0 && (
          <div key={key}><h3>{t(label)} <span className="muted">{bracket[key].length}</span></h3><CardNames names={bracket[key]} lines={lines} /></div>
        ))}
        {bracket.bracket >= 3 && bracket.cutToMoveDown.length > 0 && (
          <div><h3 title={t('bracketCutHint')}>{t('bracketCut')}</h3><CardNames names={bracket.cutToMoveDown} lines={lines} /></div>
        )}
      </section>

      <section className="deck-analysis__panel" aria-labelledby="deck-check">
        <h2 id="deck-check">{t('commanderCheck')}</h2>
        {check.ok
          ? <p className="deck-analysis__ok">{t('commanderCheckOk')}</p>
          : <ul className="deck-analysis__issues">{check.issues.map((issue, i) => (
            <li key={i}><span className="deck-analysis__warn">{issueText(t, issue, check.size, identity)}</span>
              {issue.names.length > 0 && <CardNames names={issue.names.map((n) => n.replace(/ \(×\d+\)$/, ''))} lines={lines} />}</li>
          ))}</ul>}
        {companions.length === 1 && <p className="muted">{t('companionNote', { name: lines.get(companions[0])?.name ?? companions[0] })}</p>}
      </section>

      <section className="deck-analysis__panel" aria-labelledby="deck-roles">
        <h2 id="deck-roles" title={t('rolesHint')}>{t('rolesTitle')}</h2>
        <dl className="deck-analysis__roles">
          {ROLES.map((key) => <div key={key}><dt>{t(`role_${key}` as MessageKey)}</dt><dd>{roles.roles.find((r) => r.key === key)?.count ?? 0}</dd></div>)}
        </dl>
        {weakSlots(roles).map((slot, i) => <p key={i} className="deck-analysis__warn">{slotText(t, slot)}</p>)}
      </section>

      <section className="deck-analysis__panel deck-analysis__hand" aria-labelledby="deck-hand">
        <header className="deck-analysis__head">
          <h2 id="deck-hand" title={t('sampleHandHint')}>{t('sampleHand')}</h2>
          <button type="button" className="btn btn--ghost" disabled={!library.length} onClick={newHand}>{t(order ? 'newHand' : 'drawHand')}</button>
          {order && <button type="button" className="btn btn--ghost" disabled={drawn >= order.length} onClick={() => setDrawn((n) => n + 1)}>{t('drawCard')}</button>}
        </header>
        {order && <ul className="deck-analysis__cards">{order.slice(0, drawn).map((n, i) => {
          const line = lines.get(n);
          const src = line?.imageKey ? cardImage(line.imageKey, 'full') : null;
          return <InspectableCard as="li" key={`${n}-${i}`} card={line?.imageKey ? cardForInspection(line) : null} title={line?.name ?? n}>
            {src ? <img src={src} alt={line?.name ?? n} loading="lazy" /> : <span>{line?.name ?? n}</span>}
          </InspectableCard>;
        })}</ul>}
      </section>

      <DeckStatistics entries={entries} filter={filter} onFilter={setFilter} includeCommanders={includeCommanders} onIncludeCommanders={setIncludeCommanders} />
    </div>
  );
}

/** The player's tags, notes and intended bracket, saved in the Forge deck. Key it by the saved values to reset. */
export function DeckNotes({ detail, engine }: { detail: DeckDetail; engine: Engine }) {
  const t = useT();
  const [tags, setTags] = useState(detail.tags);
  const [tag, setTag] = useState('');
  const [notes, setNotes] = useState(detail.notes);
  const [intent, setIntent] = useState(detail.bracketIntent);
  const [saving, setSaving] = useState(false);
  const id = useId();
  useEffect(() => { if (engine.error) setSaving(false); }, [engine.error]);
  const changed = notes !== detail.notes || intent !== detail.bracketIntent || tags.join('\n') !== detail.tags.join('\n');
  const addTag = () => {
    const next = tag.trim().replace(/,/g, ' ');
    if (next && !tags.some((x) => x.toLowerCase() === next.toLowerCase())) setTags([...tags, next]);
    setTag('');
  };
  return (
    <form className="deck-notes" onSubmit={(e) => {
      e.preventDefault();
      setSaving(true);
      engine.send({ type: 'setDeckMeta', name: detail.name, tags, notes, bracketIntent: intent });
    }}>
      <fieldset className="deck-notes__tags">
        <legend>{t('deckTags')}</legend>
        <ul>{tags.map((x) => <li key={x}>{x}
          <button type="button" className="btn btn--ghost deck-notes__remove" aria-label={t('removeTag', { tag: x })} onClick={() => setTags(tags.filter((y) => y !== x))}>×</button>
        </li>)}</ul>
        <span className="deck-notes__add">
          <input className="input" aria-label={t('newTag')} placeholder={t('newTag')} maxLength={40} value={tag}
            onChange={(e) => setTag(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); addTag(); } }} />
          <button type="button" className="btn btn--ghost" disabled={!tag.trim() || tags.length >= 20} onClick={addTag}>{t('addTag')}</button>
        </span>
      </fieldset>
      <div className="deck-notes__field"><label htmlFor={`${id}-bracket`}>{t('bracketIntent')}</label>
        <select id={`${id}-bracket`} className="input" value={intent} onChange={(e) => setIntent(Number(e.target.value))}>
          <option value={0}>{t('bracketIntentNone')}</option>
          {[1, 2, 3, 4, 5].map((n) => <option key={n} value={n}>{`${n} · ${t(`bracket${n}` as MessageKey)}`}</option>)}
        </select>
      </div>
      <div className="deck-notes__field"><label htmlFor={`${id}-notes`}>{t('deckNotes')}</label>
        <textarea id={`${id}-notes`} className="input" rows={8} maxLength={4000} value={notes} onChange={(e) => setNotes(e.target.value)} />
      </div>
      <button type="submit" className="btn btn--primary" disabled={!changed || saving}>{t(saving ? 'saving' : 'save')}</button>
    </form>
  );
}
