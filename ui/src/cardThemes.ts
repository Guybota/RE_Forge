import {
  THEME_ALLIANCE, THEME_BLINK, THEME_CASCADE, THEME_CLUE, THEME_COMBAT, THEME_COPY, THEME_COUNTER,
  THEME_CRIME, THEME_DEATH, THEME_DESCEND, THEME_DONATE, THEME_DRAW, THEME_ENERGY, THEME_FOOD,
  THEME_GOAD, THEME_LAND, THEME_LIFE, THEME_MILL, THEME_MODIFIED, THEME_MONARCH, THEME_MUTATE,
  THEME_NINJA, THEME_PLOT, THEME_POISON, THEME_SAC, THEME_SPELL, THEME_STORM, THEME_TOKEN,
  THEME_TREASURE, THEME_WHEEL, THEME_YARD,
  TYPE_ARTIFACT, TYPE_AURA, TYPE_EQUIPMENT, TYPE_SAGA, TYPE_VEHICLE,
} from './deckTools/card-tag-bits';
import { tagOf } from './deckTools/card-tags';
import { deckLeanThreads } from './deckTools/improve-adapt';
import type { Deck } from './deckTools/types';
import { say } from './deckTools/say';

const THEME_LABELS: { bit: number; label: string }[] = [
  { bit: THEME_LIFE, label: 'life gain' },
  { bit: THEME_TOKEN, label: 'tokens' },
  { bit: THEME_TREASURE, label: 'treasures' },
  { bit: THEME_SAC, label: 'sacrifice' },
  { bit: THEME_COUNTER, label: 'counters' },
  { bit: THEME_SPELL, label: 'spells' },
  { bit: THEME_YARD, label: 'the graveyard' },
  { bit: THEME_MILL, label: 'mill' },
  { bit: THEME_LAND, label: 'lands' },
  { bit: THEME_BLINK, label: 'blinking' },
  { bit: THEME_DRAW, label: 'drawing together' },
  { bit: THEME_GOAD, label: 'goad' },
  { bit: THEME_MONARCH, label: 'the monarch' },
  { bit: THEME_WHEEL, label: 'wheels' },
  { bit: THEME_DONATE, label: 'giving cards away' },
  { bit: THEME_DEATH, label: 'creature deaths' },
  { bit: THEME_POISON, label: 'poison' },
  { bit: THEME_ENERGY, label: 'energy' },
  { bit: THEME_FOOD, label: 'Food' },
  { bit: THEME_CLUE, label: 'Clues' },
  { bit: THEME_COMBAT, label: 'extra combats' },
  { bit: THEME_COPY, label: 'copying spells' },
  { bit: THEME_MODIFIED, label: 'modified creatures' },
  { bit: THEME_CRIME, label: 'crimes' },
  { bit: THEME_PLOT, label: 'plot' },
  { bit: THEME_CASCADE, label: 'cascade' },
  { bit: THEME_STORM, label: 'storm' },
  { bit: THEME_MUTATE, label: 'mutate' },
  { bit: THEME_NINJA, label: 'ninjutsu' },
  { bit: THEME_ALLIANCE, label: 'alliance' },
  { bit: THEME_DESCEND, label: 'descend' },
];

const TYPE_LABELS: { bit: number; label: string }[] = [
  { bit: TYPE_ARTIFACT, label: 'artifacts' },
  { bit: TYPE_EQUIPMENT, label: 'equipment' },
  { bit: TYPE_AURA, label: 'auras' },
  { bit: TYPE_VEHICLE, label: 'Vehicles' },
  { bit: TYPE_SAGA, label: 'Sagas' },
];

/** Theme / type chips for one card, already translated when the deck-tools table is loaded. */
export function cardThemeLabels(nameEn: string): string[] {
  const tag = tagOf(nameEn);
  if (!tag) return [];
  const out: string[] = [];
  for (const row of TYPE_LABELS) if (tag.types & row.bit) out.push(say(row.label));
  for (const row of THEME_LABELS) if (tag.themes & row.bit) out.push(say(row.label));
  for (const sub of tag.sub) if (sub && !out.includes(sub)) out.push(sub);
  return out.slice(0, 8);
}

/** Up to three deck-leaning thread keys (English); translate with say() when shown. */
export function deckThemeKeys(deck: Deck): string[] {
  return deckLeanThreads(deck).slice(0, 3);
}

/** Up to three deck-leaning threads for a poster or summary. */
export function deckThemeLabels(deck: Deck): string[] {
  return deckThemeKeys(deck).map((thread) => say(thread));
}

/** Soft labels from commanders alone (precons / before a full list loads). */
export function commanderThemeLabels(names: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const name of names) {
    for (const label of cardThemeLabels(name)) {
      if (seen.has(label)) continue;
      seen.add(label);
      out.push(label);
      if (out.length >= 3) return out;
    }
  }
  return out;
}
