import { useId, useMemo, useState } from 'react';
import { estimateBracket } from './deckTools/bracket';
import { deckFromLines } from './deckTools/cardVisual';
import { deckCardCount } from './deckTools/compare';
import { deckPlans } from './deckTools/improve-adapt';
import { applySuggestionsToDeck, suggestionAdds, suggestionCuts, suggestionKeeps, suggestionsFromReference } from './deckTools/improve-diff';
import { bracketAdjustments, buildGamePlans, readDeck, roomCutSuggestions, type GamePlan } from './deckTools/improve-plans';
import { canonicalizeName } from './deckTools/parse-decklist';
import pt from './deckTools/pt.json';
import { say, setDeckToolsLanguage } from './deckTools/say';
import type { Suggestion } from './deckTools/types';
import { reply, useRequest } from './deckRequests';
import { Unavailable } from './DeckOnline';
import { addAndCut } from './deckText';
import type { CatalogCard, DeckDetail } from './engine';
import { useT, type MessageKey } from './i18n';
import { cardImage } from './images';
import { InspectableCard } from './table/CardInspection';
import { cardForInspection } from './table/useCardInspection';
import type { Engine } from './useEngine';

type Bracket = 1 | 2 | 3 | 4 | 5;
type Card = Pick<CatalogCard, 'name' | 'imageKey' | 'cost' | 'type' | 'typeEn'>;
let nextPreview = 0;

const allNames = (item: Suggestion) => [...suggestionCuts(item), ...suggestionAdds(item), ...suggestionKeeps(item)].map((c) => canonicalizeName(c.name));
const isSet = (item: Suggestion) => suggestionAdds(item).length > 1 || suggestionCuts(item).length > 1;

/**
 * Central's Improve on a Forge deck: switches that push what the list already does, bracket adjustments and the
 * differences with a pasted list. Ideas are only held here; a copy with them becomes a new Forge deck.
 */
export function DeckImprove({ detail, engine, onCreated, source = 'mine' }: { detail: DeckDetail; engine: Engine; onCreated: (name: string) => void; source?: 'mine' | 'precon' }) {
  const t = useT();
  const id = useId();
  const { send } = engine;
  const language = document.documentElement.lang || 'en';
  // The modules write their sentences while computing; the table must be in place first.
  setDeckToolsLanguage(language.startsWith('pt') ? pt : null);

  const { deck } = useMemo(() => deckFromLines(detail.name, detail.lines, detail.identity), [detail]);
  // language is a dependency: the same deck reads differently in another language.
  const reading = useMemo(() => readDeck(deck), [deck, language]); // eslint-disable-line react-hooks/exhaustive-deps
  const built = useMemo(() => buildGamePlans(deck), [deck, language]); // eslint-disable-line react-hooks/exhaustive-deps
  const gamePlans = useMemo(() => deckPlans(deck), [deck, language]); // eslint-disable-line react-hooks/exhaustive-deps
  const current = useMemo(() => estimateBracket(deck).bracket, [deck]);
  const [panel, setPanel] = useState<'switches' | 'bracket'>('switches');
  const [target, setTarget] = useState<Bracket>(current);
  const [planId, setPlanId] = useState(gamePlans[0]?.id ?? '');
  const adjustment = useMemo(() => bracketAdjustments(deck, planId, target), [deck, planId, target, language]); // eslint-disable-line react-hooks/exhaustive-deps

  // Another list, read by Forge (any format, any language) into English names.
  const [refText, setRefText] = useState('');
  const [refRequest, setRefRequest] = useState('');
  const refPreview = engine.deckPreview?.requestId === refRequest && refRequest ? engine.deckPreview : null;
  const refSuggestions = useMemo(() => refPreview
    ? suggestionsFromReference(deck, refPreview.lines.filter((l) => l.nameEn && l.group !== 'commander' && !l.sideboard)
      .map((l) => ({ name: l.nameEn!, quantity: l.qty ?? 1 })))
    : [], [deck, refPreview]);
  const plans: GamePlan[] = useMemo(() => refSuggestions.length ? [...built.plans, {
    id: 'reference', title: t('improveReference'), summary: t('improveReferenceSummary'), play: t('improveReferencePlay'), suggestions: refSuggestions,
  }] : built.plans, [built.plans, refSuggestions, t]);

  const [openId, setOpenId] = useState<string | null>(built.plans[0]?.id ?? null);
  // Held ideas keep their own copy: switching plan or bracket target does not drop them.
  const [saved, setSaved] = useState<Map<string, Suggestion>>(() => new Map());
  const planItems = useMemo(() => [...plans.flatMap((p) => p.suggestions), ...adjustment.toward, ...adjustment.plan], [plans, adjustment]);
  const chosen = [...saved.values()];
  const cutting = new Set(chosen.filter((s) => !s.id.startsWith('room-')).flatMap((s) => suggestionCuts(s).map((c) => canonicalizeName(c.name))));
  const leaves = roomCutSuggestions(deck, cutting);
  const projected = deckCardCount(applySuggestionsToDeck(deck, chosen));
  const taken = new Set(chosen.flatMap(allNames));
  const remember = (item: Suggestion) => setSaved((all) => {
    const next = new Map(all);
    if (next.delete(item.id)) return next;
    const names = allNames(item);
    if ([...all.values()].some((other) => allNames(other).some((n) => names.includes(n)))) return all;
    next.set(item.id, item);
    return next;
  });

  // Cards the ideas bring in are usually not in the deck: their translated names and pictures come from Forge.
  const lines = useMemo(() => new Map(detail.lines.filter((l) => l.nameEn).map((l) => [canonicalizeName(l.nameEn!), l as Card])), [detail]);
  const outside = useMemo(() => [...new Set(planItems.flatMap((s) => suggestionAdds(s).map((c) => c.name)))]
    .filter((n) => !lines.has(canonicalizeName(n))).sort(), [planItems, lines]);
  const cardsRequest = useRequest((requestId) => { if (outside.length) send({ type: 'cardsByName', requestId, names: outside }); }, [outside.join('|'), send]);
  const cardsAnswer = reply(engine, 'cardsByName', cardsRequest.id.current);
  const cards = useMemo(() => {
    const map = new Map(lines);
    if (cardsAnswer?.type === 'cardsByName') for (const c of cardsAnswer.cards) map.set(canonicalizeName(c.nameEn), c);
    return map;
  }, [lines, cardsAnswer]);

  const combosRequest = useRequest((requestId) => send({ type: 'deckSpellbook', requestId, name: detail.name, source }), [detail, source, send]);
  const combos = reply(engine, 'deckSpellbook', combosRequest.id.current);

  const [copyName, setCopyName] = useState(t('improveCopyDefault', { deck: detail.name }));
  const [leaveQuery, setLeaveQuery] = useState('');
  const nameTaken = engine.decks.mine.includes(copyName.trim());
  const createCopy = () => {
    const name = copyName.trim();
    if (!name || nameTaken || projected !== 100) return;
    const times = (cs: { name: string; quantity: number }[]) => cs.flatMap((c) => Array.from({ length: c.quantity }, () => c.name));
    const text = addAndCut(detail.text, chosen.flatMap((s) => times(suggestionAdds(s))), chosen.flatMap((s) => times(suggestionCuts(s))));
    const notes = [detail.notes.trim(), t('improveCopyNotes', { deck: detail.name }), ...chosen.map((s) => `- ${ideaTitle(s)}`)].filter(Boolean).join('\n');
    send({ type: 'saveDeck', text, name });
    send({ type: 'setDeckMeta', name, tags: [...detail.tags, t('improveTag')].slice(0, 20), notes: notes.slice(0, 4000), bracketIntent: detail.bracketIntent });
    onCreated(name);
  };
  const ideaTitle = (s: Suggestion) => s.title ? say(s.title) : [...suggestionCuts(s).map((c) => cardName(c.name)), '→', ...suggestionAdds(s).map((c) => cardName(c.name))].join(' ');
  const cardName = (n: string) => cards.get(canonicalizeName(n))?.name ?? n;

  const side = (label: MessageKey, list: { name: string }[], stays = false) => list.length > 0 && (
    <div className="deck-improve__side">
      <p className="muted">{t(label)}</p>
      <ul>{list.map((c) => {
        const card = cards.get(canonicalizeName(c.name));
        const src = card?.imageKey ? cardImage(card.imageKey, 'full') : null;
        return <InspectableCard as="li" key={c.name} card={card?.imageKey ? cardForInspection(card) : null} className={stays ? 'is-owned' : ''}>
          {src && <img src={src} alt="" loading="lazy" />}<span>{card?.name ?? c.name}</span>
        </InspectableCard>;
      })}</ul>
    </div>
  );
  const idea = (item: Suggestion) => {
    const on = saved.has(item.id);
    const blocked = !on && allNames(item).some((n) => taken.has(n));
    return <li key={item.id} className={`deck-improve__idea ${on ? 'is-on' : ''}`}>
      <div className="deck-analysis__head">
        <strong>{item.title ? say(item.title) : t(!suggestionAdds(item).length ? 'improveCut' : !suggestionCuts(item).length ? 'improveAdd' : 'improveSwitch')}</strong>
        <button type="button" className="btn btn--ghost" aria-pressed={on} disabled={blocked} onClick={() => remember(item)}>
          {t(on ? 'improveSaved' : isSet(item) ? 'improveSaveSet' : 'improveSave')}</button>
      </div>
      {side('improveKeeping', suggestionKeeps(item), true)}
      <div className="deck-improve__switch">{side('improveLeaving', suggestionCuts(item))}{side('improveComing', suggestionAdds(item))}</div>
      <p className="muted">{blocked ? `${t('improveBlocked')} ` : ''}{say(item.reason)}</p>
    </li>;
  };
  const leaveNeedle = leaveQuery.trim().toLowerCase();
  const visibleLeaves = leaveNeedle.length < 2 ? [] : leaves.filter((l) => suggestionCuts(l).some((c) =>
    c.name.toLowerCase().includes(leaveNeedle) || cardName(c.name).toLowerCase().includes(leaveNeedle))).slice(0, 8);

  return (
    <div className="deck-online deck-improve">
      <section className="deck-analysis__panel" aria-labelledby={`${id}-reading`}>
        <h2 id={`${id}-reading`}>{t('improveReading')}</h2>
        <p>{reading.body}</p>
        {reading.threads.length > 0 && <ul className="deck-analysis__names">{reading.threads.map((th) => <li key={th} className="deck-analysis__name">{th}</li>)}</ul>}
        <h3 title={t('improveCombosHint')}>{t('improveCombosIn')}</h3>
        {combos?.type === 'servicesError' ? <Unavailable onRetry={combosRequest.retry} />
          : combos?.type !== 'deckSpellbook' ? <p className="muted" role="status">{t('improveCombosLoading')}</p>
          : combos.combos.length === 0 ? <p className="muted">{t('improveCombosNone')}</p>
          : <ul className="deck-improve__combos">{combos.combos.slice(0, 4).map((c) => <li key={c.id}>
              {c.cardNames.map(cardName).join(' + ')}{c.produces.length > 0 && <span className="muted" lang="en"> · {c.produces.join(' · ')}</span>}
            </li>)}{combos.combos.length > 4 && <li className="muted">{t('improveCombosMore', { n: combos.combos.length - 4 })}</li>}</ul>}
      </section>

      <nav className="builder__views" aria-label={t('improveViews')}>
        <button type="button" className="btn btn--ghost" aria-pressed={panel === 'switches'} title={t('improveSwitchesHint')} onClick={() => setPanel('switches')}>{t('improveSwitches')}</button>
        <button type="button" className="btn btn--ghost" aria-pressed={panel === 'bracket'} title={t('improveBracketHint')} onClick={() => setPanel('bracket')}>{t('improveBracket')}</button>
      </nav>

      {panel === 'switches' ? (plans.length === 0 ? <p className="muted">{t('improveNoPlans')}</p> : <ul className="deck-improve__plans">{plans.map((plan) => {
        const open = openId === plan.id;
        const held = plan.suggestions.filter((s) => saved.has(s.id)).length;
        const count = plan.suggestions.length === 1 && isSet(plan.suggestions[0]) ? t('improveASet')
          : t(plan.suggestions.length === 1 ? 'improveOneIdea' : 'improveIdeas', { n: plan.suggestions.length });
        return <li key={plan.id} className="deck-analysis__panel">
          <button type="button" className="deck-improve__plan" aria-expanded={open} onClick={() => setOpenId(open ? null : plan.id)}>
            <strong>{say(plan.title)}</strong>
            <span className="muted">{count}{held > 0 ? ` · ${t('improveHeld', { n: held })}` : ''}</span>
            <span>{say(plan.summary)}</span>
          </button>
          {open && <><p>{say(plan.play)}</p><ul className="deck-improve__ideas">{plan.suggestions.map(idea)}</ul></>}
        </li>;
      })}</ul>) : (
        <div className="deck-improve__bracket">
          <p className="muted">{t('improveNowReads', { n: current, label: t(`bracket${current}` as MessageKey) })}</p>
          <h3>{t('improveAimAt')}</h3>
          <div className="deck-analysis__head">{([1, 2, 3, 4, 5] as const).map((b) => <button key={b} type="button" className="btn btn--ghost"
            aria-pressed={target === b} onClick={() => setTarget(b)}>{`${b} · ${t(`bracket${b}` as MessageKey)}`}</button>)}</div>
          <h3>{t('improveGamePlan')}</h3>
          {gamePlans.length === 0 ? <p className="muted">{t('improveNoGamePlans')}</p>
            : <div className="deck-analysis__head">{gamePlans.map((p) => <button key={p.id} type="button" className="btn btn--ghost"
              aria-pressed={planId === p.id} onClick={() => setPlanId(p.id)}>{say(p.title)}</button>)}</div>}
          <h3>{t('improveForPlan', { plan: say(gamePlans.find((p) => p.id === planId)?.title ?? '') })}</h3>
          {adjustment.plan.length === 0 ? <p className="muted">{t('improveNoPlanIdeas')}</p> : <ul className="deck-improve__ideas">{adjustment.plan.map(idea)}</ul>}
          <h3>{t('improveToward', { n: target, label: t(`bracket${target}` as MessageKey) })}</h3>
          <p className="muted">{t(target <= 2 ? 'improveCap12' : target === 3 ? 'improveCap3' : 'improveCap45')}</p>
          {adjustment.toward.length === 0 ? <p className="muted">{t('improveTowardNone')}</p> : <ul className="deck-improve__ideas">{adjustment.toward.map(idea)}</ul>}
        </div>
      )}

      {chosen.length > 0 && (
        <section className="deck-analysis__panel" aria-labelledby={`${id}-held`}>
          <h2 id={`${id}-held`}>{t('improveHolding')}</h2>
          <p>{t('improveCopyCount', { n: projected })} {t(projected === 100 ? 'improveCopyFull' : 'improveCopyWait')}</p>
          <ul className="deck-improve__held">{chosen.map((s) => <li key={s.id}><span>{ideaTitle(s)}</span>
            <button type="button" className="btn btn--ghost" onClick={() => remember(s)}>{t('improveLetGo')}</button></li>)}</ul>
          {projected > 100 && <div className="deck-notes__field">
            <p>{t('improveOver', { n: projected - 100 })}</p>
            <label htmlFor={`${id}-leave`}>{t('improveSearchDeck')}</label>
            <input id={`${id}-leave`} className="input" value={leaveQuery} onChange={(e) => setLeaveQuery(e.target.value)} />
            {leaveNeedle.length >= 2 && visibleLeaves.length === 0 && <p className="muted">{t('improveNoMatch')}</p>}
            {visibleLeaves.length > 0 && <ul className="deck-improve__held">{visibleLeaves.map((l) => <li key={l.id}>
              <span>{suggestionCuts(l).map((c) => cardName(c.name)).join(', ')}</span>
              <button type="button" className="btn btn--ghost" aria-pressed={saved.has(l.id)} onClick={() => remember(l)}>{t(saved.has(l.id) ? 'improveSaved' : 'improveSetAside')}</button>
            </li>)}</ul>}
          </div>}
          <div className="deck-notes__field">
            <label htmlFor={`${id}-copy`}>{t('improveCopyName')}</label>
            <span className="deck-notes__add">
              <input id={`${id}-copy`} className="input" value={copyName} onChange={(e) => setCopyName(e.target.value)} />
              <button type="button" className="btn btn--primary" disabled={projected !== 100 || !copyName.trim() || nameTaken} onClick={createCopy}>{t('improveCreateCopy')}</button>
            </span>
            {nameTaken && <p className="deck-analysis__warn">{t('improveNameTaken')}</p>}
          </div>
        </section>
      )}

      <section className="deck-analysis__panel" aria-labelledby={`${id}-reference`}>
        <h2 id={`${id}-reference`} title={t('improveAnotherHint')}>{t('improveAnother')}</h2>
        <textarea className="input deck-improve__reference" rows={5} aria-labelledby={`${id}-reference`} value={refText} onChange={(e) => setRefText(e.target.value)} />
        <div className="deck-analysis__head">
          <button type="button" className="btn btn--ghost" disabled={!refText.trim()} onClick={() => {
            const requestId = `improve-${++nextPreview}`;
            setRefRequest(requestId);
            send({ type: 'previewDeck', text: refText, requestId });
            setOpenId('reference');
          }}>{t('improveShowDiff')}</button>
          {refPreview && <span className="muted" role="status">{t(refSuggestions.length ? 'improveDiffShown' : 'improveNoDiff')}</span>}
        </div>
      </section>
    </div>
  );
}
