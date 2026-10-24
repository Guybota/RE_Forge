import { useEffect, useMemo, useRef, useState } from 'react';
import type { CardState, GameState } from '../engine';
import type { Engine } from '../useEngine';
import { cardImage } from '../images';
import { Card } from './Card';
import { ChoiceDialog } from './ChoiceDialog';
import { CombatArrows } from './CombatArrows';
import { PHASE_TRACK, manaSymbols, phaseKey } from './cards';
import { useT } from '../i18n';
import { PlayerArea, type TableContext } from './PlayerArea';
import './table.css';

/** The printed card when there is a picture (it already shows name, cost and text); the text otherwise. */
function Preview({ card }: { card: CardState }) {
  const [failed, setFailed] = useState(false);
  const src = cardImage(card.imageKey, 'full');
  if (src && !failed) {
    return <img className="side__image" src={src} alt={`${card.name}: ${card.text ?? ''}`} onError={() => setFailed(true)} />;
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

export function Table({ engine, game }: { engine: Engine; game: GameState }) {
  const [hovered, setHovered] = useState<CardState | null>(null);
  const [shake, setShake] = useState(false);
  const { send } = engine;
  const t = useT();

  const me = game.players.find((p) => p.isLocal) ?? game.players[0];
  const opponents = game.players.filter((p) => p !== me);
  const { prompt } = game;

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
    const timer = setTimeout(() => setShake(false), 400);
    return () => clearTimeout(timer);
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

  // The engine already dropped the status lines the table shows itself.
  const promptText = prompt.message.split('\n').join(' ');
  const activeTrack = PHASE_TRACK.findIndex((step) => game.phase && step.phases.includes(game.phase));
  const currentStep = phaseKey(game.phase);
  const myTurn = game.activePlayerId === me.id;

  return (
    <div className="table">
      <div className="table__main" ref={main}>
        <CombatArrows game={game} container={main} />
        <div className={`opponents opponents--${opponents.length}`}>
          {opponents.map((p) => (
            <PlayerArea key={p.id} player={p} active={game.activePlayerId === p.id} compact={opponents.length > 1} attackedBy={attackedBy(p.id)} ctx={ctx} />
          ))}
        </div>

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
          </span>
        </div>

        <PlayerArea player={me} active={myTurn} compact={false} attackedBy={attackedBy(me.id)} ctx={ctx} />

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

      <aside className="side">
        <section className="side__preview" aria-live="polite">
          {hovered && !hovered.hidden ? <Preview key={hovered.id} card={hovered} /> : null}
        </section>
        <section>
          <h2>{t('stack')}</h2>
          <ol className="side__stack">
            {game.stack.map((s) => <li key={s.id}>{s.text}</li>)}
          </ol>
        </section>
        <section className="side__log">
          <h2>{t('log')}</h2>
          <ol>
            {game.log.map((l, i) => <li key={i}>{l}</li>)}
          </ol>
        </section>
        {!game.gameOver && !me.hasLost && (
          <button type="button" className="side__concede" onClick={() => send({ type: 'action', action: 'concede' })}>
            {t('concede')}
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
            <h2>{game.gameOver && game.winner === me.name ? t('victory') : t('defeat')}</h2>
            {game.winner && game.winner !== me.name && <p>{game.winner}</p>}
            <button
              type="button"
              className="btn btn--primary"
              onClick={() => {
                if (engine.lobby) {
                  send({ type: 'leaveLobby' });
                  engine.leaveGame();
                  return;
                }
                // In multiplayer the AIs keep playing after we're out; leaving ends the game for them.
                if (!game.gameOver) send({ type: 'action', action: 'leave' });
                engine.leaveGame();
              }}
            >
              {t('continue')}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
