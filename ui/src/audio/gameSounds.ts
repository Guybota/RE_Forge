import type { GameState } from '../engine';

export type SoundEffect = 'click' | 'card' | 'attack' | 'turn' | 'phase' | 'priority' | 'resolve' | 'damage' | 'victory' | 'defeat';

/** Compare consecutive engine snapshots, never clicks or translated log text. */
export function gameSounds(previous: GameState | null, next: GameState): SoundEffect[] {
  if (!previous || previous.gameOver) return [];
  const me = next.players.find(p => p.isLocal);
  const wasOut = previous.players.find(p => p.isLocal)?.hasLost;
  if (next.gameOver) return [me && next.winner === me.name ? 'victory' : 'defeat'];
  if (me?.hasLost && !wasOut) return ['defeat'];
  const effects: SoundEffect[] = [];
  const turnChanged = next.turn > 0 && next.activePlayerId !== null &&
    (next.turn !== previous.turn || next.activePlayerId !== previous.activePlayerId);
  if (turnChanged) effects.push('turn');
  else if (previous.phase && next.phase && previous.phase !== next.phase) effects.push('phase');

  const oldStack = new Set(previous.stack.map(item => item.id));
  const cast = next.stack.some(item => item.isSpell === true && !oldStack.has(item.id));
  // Lands do not use the stack. A card must move from a playable zone, excluding tokens and put-into-play creatures.
  const oldField = new Set(previous.players.flatMap(p => p.zones.battlefield.map(c => c.id)));
  const oldPlayable = new Set(previous.players.flatMap(p =>
    [...p.zones.hand, ...p.zones.graveyard, ...p.zones.exile, ...p.zones.command].map(c => c.id)));
  const land = next.players.some(p => p.zones.battlefield.some(c =>
    !c.token && /\bLand\b/.test(c.typeEn ?? '') && !oldField.has(c.id) && oldPlayable.has(c.id)));
  if (cast || land) effects.push('card');

  const oldAttackers = new Set(previous.combat.map(a => a.attackerId));
  if (next.combat.some(a => !oldAttackers.has(a.attackerId))) effects.push('attack');

  // Something left the stack (resolved or countered) without a new turn wiping it.
  const nextStack = new Set(next.stack.map(item => item.id));
  if (!turnChanged && previous.stack.some(item => !nextStack.has(item.id))) effects.push('resolve');
  if (next.players.some(p => p.life < (previous.players.find(q => q.id === p.id)?.life ?? p.life))) effects.push('damage');
  // You can respond to someone else's spell or ability: once per object on top of the stack.
  const respond = (s: GameState) => s.prompt.priority && s.priorityPlayerId === me?.id && s.stack[0]?.controllerId !== me?.id ? s.stack[0]?.id : undefined;
  const top = respond(next);
  if (top !== undefined && top !== respond(previous)) effects.push('priority');
  return effects;
}
