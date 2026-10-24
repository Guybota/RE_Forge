import type { CardState, PlayerState } from '../engine';
import { Card } from './Card';
import { isLand } from './cards';
import { useT } from '../i18n';

export type TableContext = {
  selectableCards: Set<number>;
  chosenCards: Set<number>;
  selectablePlayers: Set<number>;
  targetCards: Set<number>;
  attackLabels: Map<number, string>;
  playerNames: Map<number, string>;
  onCard: (id: number) => void;
  onPlayer: (id: number) => void;
  onHover: (card: CardState | null) => void;
};

type Props = {
  player: PlayerState;
  active: boolean;
  compact: boolean;
  attackedBy: number;
  ctx: TableContext;
};

export function PlayerArea({ player, active, compact, attackedBy, ctx }: Props) {
  const field = player.zones.battlefield;
  const lands = field.filter(isLand);
  const others = field.filter((c) => !isLand(c));
  const selectable = ctx.selectablePlayers.has(player.id);
  const cmdDamage = player.commanderDamage.filter((d) => d.damage > 0);
  const t = useT();

  const cardProps = (c: CardState) => ({
    card: c,
    selectable: ctx.selectableCards.has(c.id),
    chosen: ctx.chosenCards.has(c.id),
    target: ctx.targetCards.has(c.id),
    attackLabel: c.attacking ? ctx.attackLabels.get(c.id) : undefined,
    onClick: () => ctx.onCard(c.id),
    onHover: ctx.onHover,
  });

  return (
    <section className={`player ${compact ? 'player--compact' : ''} ${attackedBy ? 'is-attacked' : ''}`} aria-label={player.name}>
      <header className="player__head">
        <button
          type="button"
          className={`life ${selectable ? 'is-selectable' : ''}`}
          onClick={() => ctx.onPlayer(player.id)}
          aria-label={t('lifeOf', { name: player.name, life: player.life })}
        >
          {player.life}
        </button>
        <span className="player__name">{player.name}</span>
        {active && <span className="chip chip--light">{t('turnChip')}</span>}
        {attackedBy > 0 && <span className="chip chip--danger">{t('attacked', { n: attackedBy })}</span>}
        <span className="player__stats">
          <span>{t('handCount', { n: player.handSize })}</span>
          <span title={t('library')}>{t('libraryShort', { n: player.librarySize })}</span>
          <span title={t('graveyard')}>{t('graveyardShort', { n: player.zones.graveyard.length })}</span>
          {player.zones.exile.length > 0 && <span title={t('exile')}>{t('exileShort', { n: player.zones.exile.length })}</span>}
          {player.poison > 0 && <span className="danger">{t('poison', { n: player.poison })}</span>}
          {cmdDamage.map((d) => (
            <span key={d.commanderId} title={t('commanderDamageFrom', { name: ctx.playerNames.get(d.fromPlayerId) ?? '' })}>
              {t('commanderDamage', { n: d.damage })}
            </span>
          ))}
        </span>
        <span className="player__command">
          {player.zones.command.map((c) => <Card key={c.id} size="mini" {...cardProps(c)} />)}
        </span>
      </header>
      <div className="field">
        <div className="field__row">
          {others.map((c) => <Card key={c.id} size="field" {...cardProps(c)} />)}
        </div>
        <div className="field__row field__row--lands">
          {lands.map((c) => <Card key={c.id} size="land" {...cardProps(c)} />)}
        </div>
      </div>
    </section>
  );
}
