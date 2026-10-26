import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import type { CardState, GameState } from '../engine';
import type { Engine } from '../useEngine';
import { Card } from './Card';
import { ChoiceDialog } from './ChoiceDialog';
import { CombatArrows } from './CombatArrows';
import { GameMenu } from './GameMenu';
import { ZoneViewer, type OpenZone } from './ZoneViewer';
import { PanelIcon } from './icons';
import { PHASE_TRACK, attachmentsByHost, phaseKey } from './cards';
import { Preview } from './CardZoom';
import { useT } from '../i18n';
import { PlayerArea, type TableContext } from './PlayerArea';
import { firstPlayer, planAnimations, rememberLocations, yourTurn, type Location } from './animationPlan';
import { cardRects, runAnimations } from './animationRunner';
import { animationOn, getAnimationSettings } from './animationPrefs';
import './table.css';

/** Cosmetic coin toss naming who plays first; Forge has already decided. */
function CoinFlip({ name, onDone }: { name: string; onDone: () => void }) {
  const t = useT();
  const duration = 1600 / getAnimationSettings().speed;
  // Once per toss: new snapshots re-render the table but must not restart the timer.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { const timer = window.setTimeout(onDone, duration + 900); return () => window.clearTimeout(timer); }, []);
  return (
    <div className="coin-flip" role="status">
      <div className="coin-flip__coin" style={{ animationDuration: `${duration}ms` }} aria-hidden="true" />
      <p className="coin-flip__text" style={{ animationDelay: `${duration}ms` }}>{t('coinFirst', { name })}</p>
    </div>
  );
}

/** Brief "your turn" notice when your turn begins. */
function TurnBanner({ onDone }: { onDone: () => void }) {
  const t = useT();
  const duration = 1300 / getAnimationSettings().speed;
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { const timer = window.setTimeout(onDone, duration); return () => window.clearTimeout(timer); }, []);
  return <p className="turn-banner" role="status" style={{ animationDuration: `${duration}ms` }}>{t('yourTurn')}</p>;
}

/** Whole seconds since `key` last changed; ticks while `key` is set. */
function useElapsed(key: number | undefined) {
  const [since, setSince] = useState({ key, at: Date.now() });
  const [, tick] = useState(0);
  if (since.key !== key) setSince({ key, at: Date.now() });
  useEffect(() => {
    if (key === undefined) return;
    const timer = window.setInterval(() => tick((n) => n + 1), 1000);
    return () => window.clearInterval(timer);
  }, [key]);
  return since.key === key ? Math.floor((Date.now() - since.at) / 1000) : 0;
}

/** With the side panel closed: the hovered card, drawn beside it (never over it) and kept inside the window. */
function FloatPreview({ card }: { card: CardState }) {
  const ref = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<{ left: number; top: number } | null>(null);
  useLayoutEffect(() => {
    const target = document.querySelector(`[data-card-id="${card.id}"]`)?.getBoundingClientRect();
    const box = ref.current?.getBoundingClientRect();
    if (!target || !box) return;
    const gap = 12, w = box.width, h = box.height;
    const right = target.right + gap + w <= window.innerWidth - 8;
    const left = right ? target.right + gap : Math.max(8, target.left - gap - w);
    const top = Math.min(Math.max(8, target.top + target.height / 2 - h / 2), window.innerHeight - h - 8);
    setPos({ left, top });
  }, [card]);
  return (
    <div ref={ref} className="float-preview" aria-hidden="true" style={pos ? { left: pos.left, top: pos.top } : { visibility: 'hidden' }}>
      <Preview card={card} />
    </div>
  );
}

const SIDE_STORAGE = 'reforge.sidePanel';
const NARROW = '(max-width: 760px)';

/** True while the window matches the media query. */
function useMedia(query: string) {
  const [matches, setMatches] = useState(() => window.matchMedia(query).matches);
  useEffect(() => {
    const list = window.matchMedia(query);
    const update = () => setMatches(list.matches);
    list.addEventListener('change', update);
    return () => list.removeEventListener('change', update);
  }, [query]);
  return matches;
}

export function Table({ engine, game }: { engine: Engine; game: GameState }) {
  const [hovered, setHovered] = useState<CardState | null>(null);
  // The side panel keeps showing the last card looked at instead of going blank.
  const [lastSeen, setLastSeen] = useState<CardState | null>(null);
  useEffect(() => { if (hovered && !hovered.hidden) setLastSeen(hovered); }, [hovered]);
  const narrow = useMedia(NARROW);
  const [shake, setShake] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const [zone, setZone] = useState<OpenZone | null>(null);
  const [focus, setFocus] = useState<number | null>(null);
  const [maximize, setMaximize] = useState<number | null>(null);
  // On a phone the panel is a drawer over the table, closed until asked for; the choice is not remembered there.
  const [sideOpen, setSideOpen] = useState(() => {
    if (window.matchMedia(NARROW).matches) return false;
    try { return localStorage.getItem(SIDE_STORAGE) !== 'closed'; } catch { return true; }
  });
  const toggleSide = () => setSideOpen((open) => {
    if (!narrow) try { localStorage.setItem(SIDE_STORAGE, open ? 'closed' : 'open'); } catch { /* remembered for this session only */ }
    return !open;
  });
  const { send } = engine;
  const t = useT();

  // Motion between snapshots: positions from the previous render, played before the browser paints the new one.
  const tableRoot = useRef<HTMLDivElement>(null);
  const animationLayer = useRef<HTMLDivElement>(null);
  const previousGame = useRef<GameState | null>(null);
  // Last known place and position of every card, kept after it leaves the screen (see rememberLocations).
  const lastRects = useRef(new Map<number, DOMRect>());
  const lastLocations = useRef(new Map<number, Location>());
  const [coin, setCoin] = useState<number | null>(null);
  const [turnBanner, setTurnBanner] = useState(0);
  useLayoutEffect(() => {
    const root = tableRoot.current, layer = animationLayer.current, previous = previousGame.current;
    if (root && layer) runAnimations(planAnimations(previous, game, lastLocations.current), lastRects.current, root, layer);
    const first = firstPlayer(previous, game);
    if (first !== null && animationOn('coin') && !document.hidden) setCoin(first);
    if (yourTurn(previous, game) && animationOn('turn') && !document.hidden) setTurnBanner((n) => n + 1);
    previousGame.current = game;
    rememberLocations(lastLocations.current, game);
    if (root) cardRects(root).forEach((rect, id) => lastRects.current.set(id, rect));
  }, [game]);

  const me = game.players.find((p) => p.isLocal) ?? game.players[0];
  const opponents = game.players.filter((p) => p !== me);
  const { prompt } = game;

  useEffect(() => {
    if (engine.choice || game.gameOver || me.hasLost) setMenuOpen(false);
  }, [engine.choice, game.gameOver, me.hasLost]);

  const main = useRef<HTMLDivElement>(null);
  const ctx: TableContext = useMemo(() => {
    const names = new Map(game.players.map((p) => [p.id, p.name]));
    const top = game.stack[0];
    return {
      selectableCards: new Set(prompt.selectable.cards),
      chosenCards: new Set(prompt.chosen.cards),
      selectablePlayers: new Set(prompt.selectable.players),
      chosenPlayers: new Set(prompt.chosen.players),
      targetCards: new Set(top?.targetCardIds ?? []),
      targetPlayers: new Set(top?.targetPlayerIds ?? []),
      combatCards: new Set([...game.combat.flatMap((a) => [a.attackerId, ...a.blockerIds, ...(a.defenderCardId ? [a.defenderCardId] : [])]),
        ...game.stack.flatMap((s) => s.targetCardIds ?? [])]),
      // On whichever board the host is, also when the attachment's controller is someone else.
      attachments: attachmentsByHost(game.players.flatMap((p) => p.zones.battlefield)),
      playerNames: names,
      onCard: (id) => send({ type: 'action', action: 'card', id }),
      onPlayer: (id) => send({ type: 'action', action: 'player', id }),
      onHover: setHovered,
      onZone: (playerId, z) => setZone({ playerId, zone: z }),
      onFocus: game.players.length > 2 ? (id) => setFocus((f) => (f === id ? null : id)) : undefined,
      onMaximize: (id) => setMaximize((m) => (m === id ? null : id)),
    };
  }, [game, prompt, send]);

  // During combat every board stays open so the attack and block arrows have both ends.
  const focused = game.combat.length === 0 && opponents.some((p) => p.id === focus) ? focus : null;
  const maximized = game.combat.length === 0 ? opponents.find((p) => p.id === maximize) : undefined;
  // Phones show opponents as headers only (life, counts); a tap on the maximize icon opens a board.
  const headersOnly = narrow && opponents.length > 1;
  const attackedBy = (playerId: number) => game.combat.filter((a) => a.defenderPlayerId === playerId).length;

  // Whose move it is: yours while Forge waits on your input, else whoever holds priority (an AI or a remote player).
  // Picking cards (e.g. discarding to hand size) can leave both buttons disabled until enough are chosen.
  const myInput = !!engine.choice || prompt.ok.enabled || prompt.cancel.enabled
    || prompt.selectable.cards.length > 0 || prompt.selectable.players.length > 0;
  const waitingFor = myInput || game.gameOver || me.hasLost ? undefined
    : game.players.find((p) => p.id === game.priorityPlayerId && !p.isLocal);
  const waited = useElapsed(waitingFor?.id);
  const priorityOf = (p: { id: number }) => (p.id === me.id ? myInput && !game.gameOver : p.id === waitingFor?.id);
  const top = game.stack[0];
  // Passing priority does something different with and without a stack, so the button says which.
  const okLabel = prompt.priority ? t(top ? 'resolve' : 'pass') : prompt.ok.label;
  const okHint = prompt.priority ? (top ? t('resolveHint', { name: top.card?.name ?? top.text }) : t('passHint')) : 'Space';
  // Someone else's spell or ability is waiting on your answer.
  const respond = prompt.priority && !!top && top.controllerId !== me.id;

  useEffect(() => {
    if (engine.notice?.kind !== 'incorrectAction') return;
    setShake(true);
    const timer = setTimeout(() => setShake(false), 400);
    return () => clearTimeout(timer);
  }, [engine.notice]);

  // Space = OK, Escape = cancel, unless a dialog or text field has focus.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.code === 'Escape' && maximized && !menuOpen && !zone && !engine.choice) {
        setMaximize(null);
        return;
      }
      if (menuOpen || zone || engine.choice || (e.target instanceof HTMLElement && e.target.closest('input, textarea, select, dialog'))) return;
      if (e.code === 'Space' && prompt.ok.enabled) {
        e.preventDefault();
        send({ type: 'action', action: 'ok' });
      } else if (e.code === 'Escape' && prompt.cancel.enabled) {
        send({ type: 'action', action: 'cancel' });
      } else if (e.code === 'KeyZ' && e.ctrlKey) {
        send({ type: 'action', action: 'undo' });
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [menuOpen, zone, maximized, engine.choice, prompt, send]);

  // The engine already dropped the status lines the table shows itself.
  const promptText = waitingFor
    ? t('waitingFor', { name: waitingFor.name }) + (waited >= 5 ? ` · ${t('waitingSeconds', { n: waited })}` : '')
    : prompt.message.split('\n').join(' ');
  // Shared by the bar and the off-table cards viewer (library searches), which must offer the same answer.
  const promptButtons = <>
    {prompt.cancel.label && (
      <button type="button" className="btn btn--ghost" disabled={!prompt.cancel.enabled} onClick={() => send({ type: 'action', action: 'cancel' })}>
        {prompt.cancel.label}
      </button>
    )}
    {prompt.ok.label && (
      <button type="button" className={`btn btn--primary ${respond ? 'is-attention' : ''}`} disabled={!prompt.ok.enabled}
        onClick={() => send({ type: 'action', action: 'ok' })} title={okHint}>
        {okLabel}
      </button>
    )}
  </>;
  const activeTrack = PHASE_TRACK.findIndex((step) => game.phase && step.phases.includes(game.phase));
  const currentStep = phaseKey(game.phase);
  const myTurn = game.activePlayerId === me.id;

  const leave = () => {
    if (engine.lobby) {
      send({ type: 'leaveLobby' });
      engine.leaveGame();
      return;
    }
    // In multiplayer the AIs keep playing after we're out; leaving ends the game for them.
    if (!game.gameOver) send({ type: 'action', action: 'leave' });
    engine.leaveGame();
  };

  // "Leave" from the menu concedes first; Forge asks to confirm. Confirmed: straight home. Cancelled: stay.
  const [leaving, setLeaving] = useState(false);
  const askedToConcede = useRef(false);
  useEffect(() => {
    if (!leaving) return;
    if (me.hasLost || game.gameOver) { askedToConcede.current = false; setLeaving(false); leave(); return; }
    if (engine.choice) { askedToConcede.current = true; return; }
    if (!askedToConcede.current) return;
    // The question closed without a loss arriving soon after: the player cancelled.
    const timer = setTimeout(() => { askedToConcede.current = false; setLeaving(false); }, 1500);
    return () => clearTimeout(timer);
  }, [leaving, engine.choice, me.hasLost, game.gameOver]);

  // Only while something is waiting to resolve. The top item resolves next; its source shows on hover.
  const allCards = game.players.flatMap((p) => Object.values(p.zones).flat());
  const stack = game.stack.length > 0 && (
    <section aria-live="polite">
      <h2>{t('stack')}</h2>
      <ol className="side__stack" data-zone="stack">
        {game.stack.map((s, i) => {
          const card = s.card ?? allCards.find((c) => c.id === s.sourceCardId);
          const owner = s.controllerId !== null ? ctx.playerNames.get(s.controllerId) : undefined;
          return (
            <li key={s.id} data-stack-id={s.id} className={i === 0 ? 'is-next' : undefined} aria-current={i === 0 || undefined}
              title={i === 0 ? t('resolvesNext') : undefined}
              onMouseEnter={card ? () => setHovered(card) : undefined} onMouseLeave={card ? () => setHovered(null) : undefined}>
              {owner && game.players.length > 2 && <span className="side__stack-owner">{owner}</span>}
              {s.text}
            </li>
          );
        })}
      </ol>
    </section>
  );

  return (
    <div ref={tableRoot} className={`table ${sideOpen && !narrow ? '' : 'table--wide'} ${narrow ? 'table--narrow' : ''}`}>
      <div ref={animationLayer} className="anim-layer" aria-hidden="true" />
      {turnBanner > 0 && <TurnBanner key={turnBanner} onDone={() => setTurnBanner(0)} />}
      {coin !== null && <CoinFlip name={game.players.find((p) => p.id === coin)?.name ?? ''} onDone={() => setCoin(null)} />}
      <div className={`table__main ${maximized ? 'table__main--max' : ''}`} ref={main}>
        <CombatArrows game={game} container={tableRoot} />
        {maximized ? (
          <div className="opponents opponents--1">
            <PlayerArea player={maximized} active={game.activePlayerId === maximized.id} maximized compact={false}
              attackedBy={attackedBy(maximized.id)} priority={priorityOf(maximized)} ctx={ctx} />
          </div>
        ) : <div className={`opponents opponents--${opponents.length}`} style={focused !== null
          ? { gridTemplateColumns: opponents.map((p) => (p.id === focused ? 'minmax(0, 1fr)' : 'auto')).join(' ') } : undefined}>
          {opponents.map((p) => (
            <PlayerArea key={p.id} player={p} active={game.activePlayerId === p.id} focused={p.id === focused}
              collapsed={headersOnly || (focused !== null && p.id !== focused)} compact={opponents.length > 1 && focused === null}
              attackedBy={attackedBy(p.id)} priority={priorityOf(p)} ctx={ctx} />
          ))}
        </div>}

        <div className={`bar ${shake ? 'is-shaking' : ''}`}>
          <span className="bar__turn" title={currentStep ? t(currentStep) : undefined}>{t('turn', { n: game.turn })}</span>
          <ol className="bar__phases">
            {PHASE_TRACK.map((step, i) => (
              <li key={step.label} className={i === activeTrack ? 'is-current' : ''}>{t(step.label)}</li>
            ))}
          </ol>
          <span className={`bar__prompt ${waitingFor ? 'bar__prompt--waiting' : ''}`} title={waitingFor ? undefined : prompt.message}>{promptText}</span>
          <span className="bar__buttons">
            {/* While declaring attacks Forge's cancel button is "Alpha Strike" / "Call Back". */}
            {promptButtons}
            {!sideOpen && !game.gameOver && !me.hasLost && (
              <button type="button" className="btn btn--ghost" aria-haspopup="dialog" onClick={() => setMenuOpen(true)}>{t('menu')}</button>
            )}
            {!sideOpen && (
              <button type="button" className="btn btn--ghost bar__icon" aria-label={t('showPanel')} title={t('showPanel')} onClick={toggleSide}>
                <PanelIcon />
              </button>
            )}
          </span>
        </div>

        <PlayerArea player={me} active={myTurn} compact={false} collapsed={!!maximized} attackedBy={attackedBy(me.id)} priority={priorityOf(me)} ctx={ctx} />

        <div className="hand" aria-label={t('hand')} data-zone="hand" data-zone-of={me.id}>
          {me.zones.hand.map((c, i, all) => {
            const d = i - (all.length - 1) / 2;
            return (
              <div key={c.id} className="hand__slot" style={{ transform: `translateY(${d * d * 2}px) rotate(${d * 2.5}deg)` }}>
                <Card card={c} size="hand" selectable={ctx.selectableCards.has(c.id)} chosen={ctx.chosenCards.has(c.id)}
                  onClick={() => ctx.onCard(c.id)} onHover={setHovered} />
              </div>
            );
          })}
        </div>
      </div>

      {!sideOpen && game.stack.length > 0 && <div className="float-stack">{stack}</div>}
      {!sideOpen && !narrow && hovered && !hovered.hidden && <FloatPreview key={hovered.id} card={hovered} />}

      {sideOpen && narrow && <button type="button" className="side-scrim" aria-label={t('hidePanel')} onClick={toggleSide} />}
      {sideOpen && <aside className="side">
        <div className="side__tools">
          <button type="button" className="side__menu side__icon" aria-label={t('hidePanel')} title={t('hidePanel')} onClick={toggleSide}>
            <PanelIcon />
          </button>
          {!game.gameOver && !me.hasLost && <button type="button" className="side__menu" aria-haspopup="dialog" onClick={() => setMenuOpen(true)}>{t('menu')}</button>}
        </div>
        {game.puzzle && <section className="puzzle-goal" title={game.puzzle.description}>
          <strong>{game.puzzle.name}</strong>
          {t('puzzleGoal')}: {game.puzzle.goal.toLowerCase() === 'win' ? t('goalWin') : game.puzzle.goal.toLowerCase() === 'survive' ? t('goalSurvive') : game.puzzle.goal}
          {game.puzzle.turns && ` · ${t('turnsLimit', { n: game.puzzle.turns })}`}
        </section>}
        {lastSeen && <section className="side__preview" aria-live="polite"><Preview key={lastSeen.id} card={lastSeen} /></section>}
        {stack}
        <section className="side__log">
          <h2>{t('log')}</h2>
          <ol>
            {game.log.map((l, i) => <li key={i}>{l}</li>)}
          </ol>
        </section>
      </aside>}

      {menuOpen && !engine.choice && !game.gameOver && !me.hasLost && <GameMenu engine={engine} onClose={() => setMenuOpen(false)} onLeave={() => {
        if (engine.lobby) { leave(); return; }
        setLeaving(true);
        send({ type: 'action', action: 'concede' });
      }} />}

      {zone && !menuOpen && !engine.choice && (() => {
        const owner = game.players.find((p) => p.id === zone.playerId);
        // Most recent on top, like the physical pile.
        return owner && <ZoneViewer title={`${t(zone.zone)} · ${owner.name}`} cards={[...owner.zones[zone.zone]].reverse()} ctx={ctx} onClose={() => setZone(null)} />;
      })()}

      {prompt.cards.length > 0 && !menuOpen && !engine.choice && (
        <ZoneViewer title={prompt.message.split('\n').pop() ?? ''} cards={prompt.cards} ctx={ctx}><span className="bar__buttons">{promptButtons}</span></ZoneViewer>
      )}

      {engine.choice && <ChoiceDialog key={engine.choice.id} choice={engine.choice} answer={engine.answer} onHover={setHovered} cards={game} />}

      {engine.notice && (engine.notice.kind === 'message' || engine.notice.kind === 'error') && engine.notice.text && (
        <div key={engine.notice.at} className={`toast ${engine.notice.kind === 'error' ? 'toast--error' : ''}`} role="status">
          {engine.notice.text}
        </div>
      )}

      {(game.gameOver || me.hasLost) && (
        <div className="overlay">
          <div className="overlay__box">
            <h2>{game.gameOver && game.winner === me.name ? t('victory') : t('defeat')}</h2>
            {game.winner && game.winner !== me.name && <p>{game.winner}</p>}
            <button type="button" className="btn btn--primary" onClick={leave}>
              {t('continue')}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
