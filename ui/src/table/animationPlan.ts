import type { CardState, GameState } from '../engine';

export type Zone = 'hand' | 'library' | 'graveyard' | 'exile' | 'command';
/** What moved between two consecutive snapshots; the runner turns each into motion on the table. */
export type AnimationPlan =
  | { kind: 'cast'; card: CardState; fromCardId: number; playerId: number; fromZone: Zone }
  | { kind: 'enter'; cardId: number; ring: boolean }
  | { kind: 'counters'; cardId: number }
  | { kind: 'equip'; card: CardState; hostId: number }
  | { kind: 'zones'; card: CardState; playerId: number; from: 'hand' | 'library'; to: 'graveyard' | 'exile' };

const ZONES = ['hand', 'graveyard', 'exile', 'command', 'battlefield'] as const;
const special = (c: CardState) => /\bLegendary\b/.test(c.typeEn ?? '') || c.rarity === 'MythicRare';
const counters = (c: CardState) => JSON.stringify(Object.entries(c.counters ?? {}).sort()) + '|' + (c.loyalty ?? '') + '|' + (c.defense ?? '');

export type Location = { card: CardState; zone: Zone | 'battlefield' | 'stack'; playerId: number };
/**
 * Last place each card id was seen, kept when it vanishes: Forge takes a spell out of the hand while its
 * costs are paid, a snapshot before it reaches the stack. Spells on the stack are marked so that one
 * resolving into the graveyard is not mistaken for a discard.
 */
export function rememberLocations(memory: Map<number, Location>, state: GameState) {
  for (const p of state.players) for (const zone of ZONES) for (const c of p.zones[zone]) memory.set(c.id, { card: c, zone, playerId: p.id });
  for (const s of state.stack) if (s.sourceCardId !== null && s.isSpell) {
    const was = memory.get(s.sourceCardId);
    memory.set(s.sourceCardId, { card: s.card ?? was?.card ?? { id: s.sourceCardId }, zone: 'stack', playerId: s.controllerId ?? was?.playerId ?? -1 });
  }
}

/** Compare engine snapshots only (never prompts or translated text), like the sound cues. */
export function planAnimations(previous: GameState | null, next: GameState, memory = new Map<number, Location>()): AnimationPlan[] {
  if (!previous || previous.gameOver || next.gameOver) return [];
  const plans: AnimationPlan[] = [];
  // Where every card was before: the previous snapshot, else its last known place.
  const before = new Map(memory);
  rememberLocations(before, previous);
  const onStack = new Set(previous.stack.map(s => s.id));
  for (const item of next.stack) {
    if (onStack.has(item.id) || !item.isSpell || item.sourceCardId === null) continue;
    const was = before.get(item.sourceCardId);
    if (!was || was.zone === 'battlefield' || was.zone === 'stack') continue;
    plans.push({ kind: 'cast', card: item.card ?? was.card, fromCardId: item.sourceCardId, playerId: was.playerId, fromZone: was.zone });
  }
  for (const p of next.players) {
    for (const c of p.zones.battlefield) {
      const was = before.get(c.id);
      if (!was || was.zone !== 'battlefield') { plans.push({ kind: 'enter', cardId: c.id, ring: special(c) }); continue; }
      if (counters(was.card) !== counters(c)) plans.push({ kind: 'counters', cardId: c.id });
      if (c.attachedToId !== undefined && c.attachedToId !== was.card.attachedToId) plans.push({ kind: 'equip', card: c, hostId: c.attachedToId });
    }
    const old = previous.players.find(q => q.id === p.id);
    for (const to of ['graveyard', 'exile'] as const) for (const c of p.zones[to]) {
      const was = before.get(c.id);
      if (was?.zone === 'hand' && was.playerId === p.id) plans.push({ kind: 'zones', card: c, playerId: p.id, from: 'hand', to });
      // Not seen before and the library shrank: milled or exiled from the top.
      else if (!was && old && p.librarySize < old.librarySize) plans.push({ kind: 'zones', card: c, playerId: p.id, from: 'library', to });
    }
  }
  return plans;
}

/** Who plays first, once per match: when turn 1 starts (turn 0 is still the play-or-draw question). */
export function firstPlayer(previous: GameState | null, next: GameState): number | null {
  if (next.gameOver || next.turn !== 1 || next.activePlayerId === null) return null;
  return !previous || previous.turn < 1 || previous.activePlayerId === null ? next.activePlayerId : null;
}
