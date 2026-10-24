import type { CardState } from '../engine';

/** Mana symbols of a cost like "{2}{R}{R}" (or "2 R R"), e.g. ["2", "R", "R"]. */
export function manaSymbols(cost: string | undefined): string[] {
  if (!cost || cost === 'no cost') return [];
  const braced = [...cost.matchAll(/\{([^}]+)\}/g)].map((m) => m[1]);
  return braced.length ? braced : cost.split(/\s+/).filter(Boolean);
}

/** One letter for the card's colour family: W U B R G, M for several, C for none. */
export function colorKey(card: CardState): string {
  const letters = new Set(manaSymbols(card.cost).flatMap((s) => s.split('/')).filter((s) => 'WUBRG'.includes(s)));
  if (letters.size === 0 && card.type?.includes('Land')) {
    const basic = ['Plains', 'Island', 'Swamp', 'Mountain', 'Forest'].findIndex((n) => card.type?.includes(n));
    if (basic >= 0) return 'WUBRG'[basic];
  }
  if (letters.size > 1) return 'M';
  return letters.size === 1 ? [...letters][0] : 'C';
}

export const isLand = (c: CardState) => !!c.type?.includes('Land') && !c.type?.includes('Creature');

const PHASES: Record<string, string> = {
  UNTAP: 'Desvirar',
  UPKEEP: 'Manutenção',
  DRAW: 'Compra',
  MAIN1: 'Principal',
  COMBAT_BEGIN: 'Início do combate',
  COMBAT_DECLARE_ATTACKERS: 'Atacantes',
  COMBAT_DECLARE_BLOCKERS: 'Bloqueadores',
  COMBAT_FIRST_STRIKE_DAMAGE: 'Dano (iniciativa)',
  COMBAT_DAMAGE: 'Dano',
  COMBAT_END: 'Fim do combate',
  MAIN2: 'Principal 2',
  END_OF_TURN: 'Final',
  CLEANUP: 'Limpeza',
};

export const phaseLabel = (phase: string | null) => (phase ? PHASES[phase] ?? phase : '');

/** The short track shown in the centre bar; detailed combat steps collapse into "Combate". */
export const PHASE_TRACK: { label: string; phases: string[] }[] = [
  { label: 'Manutenção', phases: ['UNTAP', 'UPKEEP'] },
  { label: 'Compra', phases: ['DRAW'] },
  { label: 'Principal', phases: ['MAIN1'] },
  { label: 'Combate', phases: ['COMBAT_BEGIN', 'COMBAT_DECLARE_ATTACKERS', 'COMBAT_DECLARE_BLOCKERS', 'COMBAT_FIRST_STRIKE_DAMAGE', 'COMBAT_DAMAGE', 'COMBAT_END'] },
  { label: 'Principal 2', phases: ['MAIN2'] },
  { label: 'Final', phases: ['END_OF_TURN', 'CLEANUP'] },
];
