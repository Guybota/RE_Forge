import type { CSSProperties } from 'react';
import type { CardState, PlayerState } from '../engine';
import { Card } from './Card';
import { groupCards, isLand } from './cards';
import { useT } from '../i18n';
import { MaximizeIcon, RestoreIcon } from './icons';

export type TableContext = {
  selectableCards: Set<number>;
  chosenCards: Set<number>;
  selectablePlayers: Set<number>;
  /** Cards an arrow or a choice points at (combat, stack targets): never folded into a pile. */
  combatCards: Set<number>;
  /** E.g. the player your attackers are aimed at while declaring attacks. */
  chosenPlayers: Set<number>;
  targetCards: Set<number>;
  /** Players the object on top of the stack targets. */
  targetPlayers: Set<number>;
  /** Equipment, auras and fortifications by the id of the battlefield card they are attached to. */
  attachments: Map<number, CardState[]>;
  playerNames: Map<number, string>;
  onCard: (id: number) => void;
  onPlayer: (id: number) => void;
  onHover: (card: CardState | null) => void;
  onZone: (playerId: number, zone: 'graveyard' | 'exile') => void;
  /** Opponents only: widen this player's board (or back to equal widths). */
  onFocus?: (playerId: number) => void;
  /** Opponents only: show this board alone over the whole table (or back). */
  onMaximize?: (playerId: number) => void;
};

type Props = {
  player: PlayerState;
  active: boolean;
  compact: boolean;
  focused?: boolean;
  /** Another opponent is enlarged: only the header (life, name, counts) is shown. */
  collapsed?: boolean;
  /** Shown alone over the whole table, with large cards. */
  maximized?: boolean;
  attackedBy: number;
  /** The game is waiting on this player (priority or another decision). */
  priority?: boolean;
  ctx: TableContext;
};

export function PlayerArea({ player, active, compact, focused, collapsed, maximized, attackedBy, priority, ctx }: Props) {
  // Attachments are drawn behind their host (possibly on another board), never as loose cards.
  const hosted = new Set([...ctx.attachments.values()].flat().map((c) => c.id));
  const field = player.zones.battlefield.filter((c) => !hosted.has(c.id));
  // Hosts stay apart so each pile is really interchangeable.
  const piles = (cards: typeof field) => groupCards(cards,
    (c) => ctx.attachments.has(c.id) || c.attachedToId !== undefined || ctx.combatCards.has(c.id) || !!c.attacking || !!c.blocking,
    (c) => [ctx.selectableCards.has(c.id), ctx.chosenCards.has(c.id)]);
  const lands = piles(field.filter(isLand));
  const others = piles(field.filter((c) => !isLand(c)));
  const selectable = ctx.selectablePlayers.has(player.id);
  const chosen = ctx.chosenPlayers.has(player.id);
  const cmdDamage = player.commanderDamage.filter((d) => d.damage > 0);
  const t = useT();
  const counts = `${t('handCount', { n: player.handSize })} · ${t('libraryShort', { n: player.librarySize })}`;

  const cardProps = (c: CardState) => ({
    card: c,
    selectable: ctx.selectableCards.has(c.id),
    chosen: ctx.chosenCards.has(c.id),
    target: ctx.targetCards.has(c.id),
    onClick: () => ctx.onCard(c.id),
    onHover: ctx.onHover,
  });

  // An aura on an equipment goes behind the same host, after it.
  const behind = (id: number): CardState[] => (ctx.attachments.get(id) ?? []).flatMap((a) => [a, ...behind(a.id)]);
  const place = (g: CardState[], size: 'field' | 'land') => {
    const card = <Card key={g[0].id} size={size} count={g.length} {...cardProps(g[0])} />;
    const under = behind(g[0].id);
    if (!under.length) return card;
    return (
      <span key={g[0].id} className="attach" style={{ '--attached': under.length } as CSSProperties}>
        {under.map((a, i) => <span key={a.id} className="attach__under" style={{ '--i': i } as CSSProperties}><Card size={size} {...cardProps(a)} /></span>)}
        {card}
      </span>
    );
  };

  const command = (
    <span className="player__command">
      {player.zones.command.map((c) => {
        const casts = player.commanderCasts?.find((x) => x.id === c.id)?.casts ?? 0;
        return <Card key={c.id} size="mini" {...cardProps(c)}
          badge={casts > 0 ? { text: `+${casts * 2}`, title: t('commanderTax', { n: casts * 2 }) } : undefined} />;
      })}
    </span>
  );

  return (
    <section className={`player ${compact ? 'player--compact' : ''} ${collapsed ? 'player--collapsed' : ''} ${maximized ? 'player--max' : ''} ${maximized && others.length + lands.length <= 5 ? 'player--max-big' : ''} ${attackedBy ? 'is-attacked' : ''} ${priority ? 'has-priority' : ''}`} aria-label={player.name}>
      <header className="player__head">
        <button
          type="button"
          className={`life ${selectable ? 'is-selectable' : ''} ${chosen ? 'is-chosen' : ''} ${ctx.targetPlayers.has(player.id) ? 'is-target' : ''}`}
          data-player-id={player.id}
          aria-pressed={chosen}
          onClick={() => ctx.onPlayer(player.id)}
          aria-label={t('lifeOf', { name: player.name, life: player.life })}
        >
          {player.life}
        </button>
        {ctx.onMaximize && !player.isLocal && (
          <button type="button" className="player__max" aria-pressed={!!maximized} aria-label={t(maximized ? 'restoreBoard' : 'maximizeBoard')}
            title={t(maximized ? 'restoreBoard' : 'maximizeBoard')} onClick={() => ctx.onMaximize?.(player.id)}>
            {maximized ? <RestoreIcon /> : <MaximizeIcon />}
          </button>
        )}
        {ctx.onFocus && !player.isLocal && !maximized
          ? <button type="button" className="player__name player__name--button" aria-pressed={!!focused}
              title={`${t(focused ? 'showAllBoards' : 'enlargeBoard')} · ${counts}`} onClick={() => ctx.onFocus?.(player.id)}>{player.name}</button>
          : <span className="player__name" title={compact ? counts : undefined}>{player.name}</span>}
        {active && <span className="chip chip--light">{t('turnChip')}</span>}
        {priority && (player.isLocal
          ? <span className="chip chip--priority" title={t('priorityHint')}>{t('yourCall')}</span>
          : <span className="chip chip--priority chip--thinking" title={t('priorityHint')}>{t('thinking')}<span className="thinking-dots" aria-hidden="true" /></span>)}
        {attackedBy > 0 && <span className="chip chip--danger">{t('attacked', { n: attackedBy })}</span>}
        <span className="player__stats">
          <span className="player__minor" data-zone="hand" data-zone-of={player.id}>{t('handCount', { n: player.handSize })}</span>
          <span className="player__minor" title={t('library')} data-zone="library" data-zone-of={player.id}>{t('libraryShort', { n: player.librarySize })}</span>
          {(['graveyard', 'exile'] as const).map((zone) => {
            const n = player.zones[zone].length;
            if (zone === 'exile' && n === 0) return null;
            const playable = player.zones[zone].some((c) => c.actionable || ctx.selectableCards.has(c.id));
            return <button type="button" key={zone} className={`player__zone ${playable ? 'is-selectable' : ''}`} title={t(zone)} data-zone={zone} data-zone-of={player.id}
              aria-haspopup="dialog" disabled={n === 0} onClick={() => ctx.onZone(player.id, zone)}>
              {t(zone === 'graveyard' ? 'graveyardShort' : 'exileShort', { n })}
            </button>;
          })}
          {player.poison > 0 && <span className="danger">{t('poison', { n: player.poison })}</span>}
          {cmdDamage.map((d) => (
            <span key={d.commanderId} title={t('commanderDamageFrom', { name: ctx.playerNames.get(d.fromPlayerId) ?? '' })}>
              {t('commanderDamage', { n: d.damage })}
            </span>
          ))}
        </span>
        {!compact && command}
      </header>
      {!collapsed && <div className="field">
        {/* In a narrow column the commander joins the board instead of making the header two lines tall. */}
        {compact && command}
        <div className="field__row">
          {others.map((g) => place(g, 'field'))}
        </div>
        <div className="field__row field__row--lands">
          {lands.map((g) => place(g, 'land'))}
        </div>
      </div>}
    </section>
  );
}
