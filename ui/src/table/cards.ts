import type { CardState } from '../engine';
import type { MessageKey } from '../i18n';

/** Mana symbols of a cost like "{2}{R}{R}" (or "2 R R"), e.g. ["2", "R", "R"]. */
export function manaSymbols(cost: string | undefined): string[] {
  if (!cost || cost === 'no cost') return [];
  const braced = [...cost.matchAll(/\{([^}]+)\}/g)].map((m) => m[1]);
  return braced.length ? braced : cost.split(/\s+/).filter(Boolean);
}

/** One letter for the card's colour family: W U B R G, M for several, C for none. */
export function colorKey(card: CardState): string {
  const letters = new Set(manaSymbols(card.cost).flatMap((s) => s.split('/')).filter((s) => 'WUBRG'.includes(s)));
  if (letters.size === 0 && card.typeEn?.includes('Land')) {
    const basic = ['Plains', 'Island', 'Swamp', 'Mountain', 'Forest'].findIndex((n) => card.typeEn?.includes(n));
    if (basic >= 0) return 'WUBRG'[basic];
  }
  if (letters.size > 1) return 'M';
  return letters.size === 1 ? [...letters][0] : 'C';
}

export const isLand = (c: CardState) => !!c.typeEn?.includes('Land') && !c.typeEn?.includes('Creature');

/**
 * Identical permanents (same picture and state, e.g. five untapped Forests or four Zombie tokens) as one
 * group, in order of first appearance. Cards for which `apart` is true always get their own group.
 */
export function groupCards(cards: CardState[], apart: (c: CardState) => boolean, extra: (c: CardState) => unknown = () => null): CardState[][] {
  const groups = new Map<string, CardState[]>();
  for (const c of cards) {
    const key = apart(c) ? `#${c.id}` : JSON.stringify([c.name, c.imageKey, c.tapped, c.sick, c.power, c.toughness, c.loyalty,
      c.defense, c.damage, c.counters, c.token, c.faceDown, c.commander, c.actionable, extra(c)]);
    const group = groups.get(key);
    if (group) group.push(c);
    else groups.set(key, [c]);
  }
  return [...groups.values()];
}

const PHASES: Record<string, MessageKey> = {
  UNTAP: 'stepUntap',
  UPKEEP: 'phaseUpkeep',
  DRAW: 'phaseDraw',
  MAIN1: 'phaseMain',
  COMBAT_BEGIN: 'stepBeginCombat',
  COMBAT_DECLARE_ATTACKERS: 'stepAttackers',
  COMBAT_DECLARE_BLOCKERS: 'stepBlockers',
  COMBAT_FIRST_STRIKE_DAMAGE: 'stepFirstStrike',
  COMBAT_DAMAGE: 'stepDamage',
  COMBAT_END: 'stepEndCombat',
  MAIN2: 'phaseMain2',
  END_OF_TURN: 'phaseEnd',
  CLEANUP: 'stepCleanup',
};

/** The message key for a Forge phase name, or null for unknown ones. */
export const phaseKey = (phase: string | null): MessageKey | null => (phase ? PHASES[phase] ?? null : null);

/** The short track shown in the centre bar; detailed combat steps collapse into "Combat". */
export const PHASE_TRACK: { label: MessageKey; phases: string[] }[] = [
  { label: 'phaseUpkeep', phases: ['UNTAP', 'UPKEEP'] },
  { label: 'phaseDraw', phases: ['DRAW'] },
  { label: 'phaseMain', phases: ['MAIN1'] },
  { label: 'phaseCombat', phases: ['COMBAT_BEGIN', 'COMBAT_DECLARE_ATTACKERS', 'COMBAT_DECLARE_BLOCKERS', 'COMBAT_FIRST_STRIKE_DAMAGE', 'COMBAT_DAMAGE', 'COMBAT_END'] },
  { label: 'phaseMain2', phases: ['MAIN2'] },
  { label: 'phaseEnd', phases: ['END_OF_TURN', 'CLEANUP'] },
];
