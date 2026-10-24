import { useEffect, useMemo, useState } from 'react';
import type { CardState, GameState } from '../engine';
import type { Engine } from '../useEngine';
import { Card } from './Card';
import { ChoiceDialog } from './ChoiceDialog';
import { PHASE_TRACK, manaSymbols, phaseLabel } from './cards';
import { PlayerArea, type TableContext } from './PlayerArea';
import './table.css';

// Forge's priority prompt repeats what the phase track and stack already show.
const REDUNDANT_PROMPT_LINE = /^(Priority|Turn|Phase|Stack):/;

export function Table({ engine, game }: { engine: Engine; game: GameState }) {
  const [hovered, setHovered] = useState<CardState | null>(null);
  const [shake, setShake] = useState(false);
  const { send } = engine;

  const me = game.players.find((p) => p.isLocal) ?? game.players[0];
  const opponents = game.players.filter((p) => p !== me);
  const { prompt } = game;

  const ctx: TableContext = useMemo(() => {
    const names = new Map(game.players.map((p) => [p.id, p.name]));
    const cardNames = new Map(game.players.flatMap((p) => p.zones.battlefield.map((c) => [c.id, c.name ?? ''] as const)));
    const top = game.stack[0];
    return {
      selectableCards: new Set(prompt.selectable.cards),
      chosenCards: new Set(prompt.chosen.cards),
      selectablePlayers: new Set(prompt.selectable.players),
      targetCards: new Set(top?.targetCardIds ?? []),
      attackLabels: new Map(game.combat.map((a) => [
        a.attackerId,
        a.defenderPlayerId !== undefined ? names.get(a.defenderPlayerId) ?? '' : cardNames.get(a.defenderCardId ?? -1) ?? '',
      ])),
      playerNames: names,
      onCard: (id) => send({ type: 'action', action: 'card', id }),
      onPlayer: (id) => send({ type: 'action', action: 'player', id }),
      onHover: setHovered,
    };
  }, [game, prompt, send]);

  const attackedBy = (playerId: number) => game.combat.filter((a) => a.defenderPlayerId === playerId).length;

  useEffect(() => {
    if (engine.notice?.kind !== 'incorrectAction') return;
    setShake(true);
    const t = setTimeout(() => setShake(false), 400);
    return () => clearTimeout(t);
  }, [engine.notice]);

  // Space = OK, Escape = cancel, unless a dialog or text field has focus.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (engine.choice || (e.target instanceof HTMLElement && e.target.closest('input, textarea, dialog'))) return;
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
  }, [engine.choice, prompt, send]);

  const promptText = prompt.message.split('\n').filter((l) => l.trim() && !REDUNDANT_PROMPT_LINE.test(l)).join(' ');
  const activeTrack = PHASE_TRACK.findIndex((t) => game.phase && t.phases.includes(game.phase));
  const myTurn = game.activePlayerId === me.id;

  return (
    <div className="table">
      <div className="table__main">
        <div className={`opponents opponents--${opponents.length}`}>
          {opponents.map((p) => (
            <PlayerArea key={p.id} player={p} active={game.activePlayerId === p.id} compact={opponents.length > 1} attackedBy={attackedBy(p.id)} ctx={ctx} />
          ))}
        </div>

        <div className={`bar ${shake ? 'is-shaking' : ''}`}>
          <span className="bar__turn" title={phaseLabel(game.phase)}>Turno {game.turn}</span>
          <ol className="bar__phases">
            {PHASE_TRACK.map((t, i) => (
              <li key={t.label} className={i === activeTrack ? 'is-current' : ''}>{t.label}</li>
            ))}
          </ol>
          <span className="bar__prompt" title={prompt.message}>{promptText}</span>
          <span className="bar__buttons">
            {myTurn && game.phase === 'COMBAT_DECLARE_ATTACKERS' && prompt.ok.enabled && (
              <button type="button" className="btn btn--ghost" onClick={() => send({ type: 'action', action: 'attackAll' })}>Atacar com tudo</button>
            )}
            {prompt.cancel.label && (
              <button type="button" className="btn btn--ghost" disabled={!prompt.cancel.enabled} onClick={() => send({ type: 'action', action: 'cancel' })}>
                {prompt.cancel.label}
              </button>
            )}
            {prompt.ok.label && (
              <button type="button" className="btn btn--primary" disabled={!prompt.ok.enabled} onClick={() => send({ type: 'action', action: 'ok' })} title="Espaço">
                {prompt.ok.label}
              </button>
            )}
          </span>
        </div>

        <PlayerArea player={me} active={myTurn} compact={false} attackedBy={attackedBy(me.id)} ctx={ctx} />

        <div className="hand" aria-label="Mão">
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

      <aside className="side">
        <section className="side__preview" aria-live="polite">
          {hovered && !hovered.hidden ? (
            <>
              <h2>{hovered.name}</h2>
              <p className="side__cost">{manaSymbols(hovered.cost).join(' ')}</p>
              <p className="side__type">{hovered.type}</p>
              <p className="side__text">{hovered.text}</p>
              {hovered.power !== undefined && <p className="side__pt">{hovered.power}/{hovered.toughness}</p>}
            </>
          ) : null}
        </section>
        <section>
          <h2>Stack</h2>
          <ol className="side__stack">
            {game.stack.map((s) => <li key={s.id}>{s.text}</li>)}
          </ol>
        </section>
        <section className="side__log">
          <h2>Registo</h2>
          <ol>
            {game.log.map((l, i) => <li key={i}>{l}</li>)}
          </ol>
        </section>
        {!game.gameOver && !me.hasLost && (
          <button type="button" className="side__concede" onClick={() => send({ type: 'action', action: 'concede' })}>
            Conceder
          </button>
        )}
      </aside>

      {engine.choice && <ChoiceDialog key={engine.choice.id} choice={engine.choice} answer={engine.answer} onHover={setHovered} cards={game} />}

      {engine.notice && (engine.notice.kind === 'message' || engine.notice.kind === 'error') && engine.notice.text && (
        <div key={engine.notice.at} className={`toast ${engine.notice.kind === 'error' ? 'toast--error' : ''}`} role="status">
          {engine.notice.text}
        </div>
      )}

      {(game.gameOver || me.hasLost) && (
        <div className="overlay">
          <div className="overlay__box">
            <h2>{game.gameOver && game.winner === me.name ? 'Vitória' : 'Derrota'}</h2>
            {game.winner && game.winner !== me.name && <p>{game.winner}</p>}
            <button
              type="button"
              className="btn btn--primary"
              onClick={() => {
                // In multiplayer the AIs keep playing after we're out; leaving ends the game for them.
                if (!game.gameOver) send({ type: 'action', action: 'leave' });
                engine.leaveGame();
              }}
            >
              Continuar
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
