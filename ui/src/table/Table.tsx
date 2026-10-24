import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import type { CardState, GameState } from '../engine';
import type { Engine } from '../useEngine';
import { cardImage } from '../images';
import { Card } from './Card';
import { ChoiceDialog } from './ChoiceDialog';
import { CombatArrows } from './CombatArrows';
import { GameMenu } from './GameMenu';
import { ZoneViewer, type OpenZone } from './ZoneViewer';
import { PanelIcon } from './icons';
import { PHASE_TRACK, manaSymbols, phaseKey } from './cards';
import { useT } from '../i18n';
import { PlayerArea, type TableContext } from './PlayerArea';
import './table.css';

/** The printed card when there is a picture (it already shows name, cost and text); the text otherwise. */
function Preview({ card }: { card: CardState }) {
  const [failed, setFailed] = useState<string | null>(null);
  const src = cardImage(card.imageKey, 'full');
  if (src && failed !== src) {
    return <img className="side__image" src={src} alt={`${card.name}: ${card.text ?? ''}`} onError={() => setFailed(src)} />;
  }
  return (
    <>
      <h2>{card.name}</h2>
      <p className="side__cost">{manaSymbols(card.cost).join(' ')}</p>
      <p className="side__type">{card.type}</p>
      <p className="side__text">{card.text}</p>
      {card.power !== undefined && <p className="side__pt">{card.power}/{card.toughness}</p>}
    </>
  );
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
      combatCards: new Set([...game.combat.flatMap((a) => [a.attackerId, ...a.blockerIds, ...(a.defenderCardId ? [a.defenderCardId] : [])]),
        ...game.stack.flatMap((s) => s.targetCardIds ?? [])]),
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
  const promptText = prompt.message.split('\n').join(' ');
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

  // Only while something is waiting to resolve.
  const stack = game.stack.length > 0 && (
    <section aria-live="polite">
      <h2>{t('stack')}</h2>
      <ol className="side__stack">
        {game.stack.map((s) => <li key={s.id}>{s.text}</li>)}
      </ol>
    </section>
  );

  return (
    <div className={`table ${sideOpen && !narrow ? '' : 'table--wide'} ${narrow ? 'table--narrow' : ''}`}>
      <div className={`table__main ${maximized ? 'table__main--max' : ''}`} ref={main}>
        <CombatArrows game={game} container={main} />
        {maximized ? (
          <div className="opponents opponents--1">
            <PlayerArea player={maximized} active={game.activePlayerId === maximized.id} maximized compact={false}
              attackedBy={attackedBy(maximized.id)} ctx={ctx} />
          </div>
        ) : <div className={`opponents opponents--${opponents.length}`} style={focused !== null
          ? { gridTemplateColumns: opponents.map((p) => (p.id === focused ? 'minmax(0, 1fr)' : 'auto')).join(' ') } : undefined}>
          {opponents.map((p) => (
            <PlayerArea key={p.id} player={p} active={game.activePlayerId === p.id} focused={p.id === focused}
              collapsed={headersOnly || (focused !== null && p.id !== focused)} compact={opponents.length > 1 && focused === null}
              attackedBy={attackedBy(p.id)} ctx={ctx} />
          ))}
        </div>}

        <div className={`bar ${shake ? 'is-shaking' : ''}`}>
          <span className="bar__turn" title={currentStep ? t(currentStep) : undefined}>{t('turn', { n: game.turn })}</span>
          <ol className="bar__phases">
            {PHASE_TRACK.map((step, i) => (
              <li key={step.label} className={i === activeTrack ? 'is-current' : ''}>{t(step.label)}</li>
            ))}
          </ol>
          <span className="bar__prompt" title={prompt.message}>{promptText}</span>
          <span className="bar__buttons">
            {/* While declaring attacks Forge's cancel button is "Alpha Strike" / "Call Back". */}
            {prompt.cancel.label && (
              <button type="button" className="btn btn--ghost" disabled={!prompt.cancel.enabled} onClick={() => send({ type: 'action', action: 'cancel' })}>
                {prompt.cancel.label}
              </button>
            )}
            {prompt.ok.label && (
              <button type="button" className="btn btn--primary" disabled={!prompt.ok.enabled} onClick={() => send({ type: 'action', action: 'ok' })} title="Space">
                {prompt.ok.label}
              </button>
            )}
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

        <PlayerArea player={me} active={myTurn} compact={false} collapsed={!!maximized} attackedBy={attackedBy(me.id)} ctx={ctx} />

        <div className="hand" aria-label={t('hand')}>
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
        return owner && <ZoneViewer player={owner} zone={zone.zone} ctx={ctx} onClose={() => setZone(null)} />;
      })()}

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
