/**
 * Bit flags stored in card-tags.json.
 * scripts/build-card-tags.py reads these exact names. Keep the shifts in sync.
 */

export const TYPE_CREATURE = 1 << 0;
export const TYPE_INSTANT = 1 << 1;
export const TYPE_SORCERY = 1 << 2;
export const TYPE_ENCHANTMENT = 1 << 3;
export const TYPE_ARTIFACT = 1 << 4;
export const TYPE_LAND = 1 << 5;
export const TYPE_PLANESWALKER = 1 << 6;
export const TYPE_BATTLE = 1 << 7;
export const TYPE_LEGENDARY = 1 << 8;
export const TYPE_AURA = 1 << 9;
export const TYPE_EQUIPMENT = 1 << 10;
export const TYPE_VEHICLE = 1 << 11;
export const TYPE_SAGA = 1 << 12;
export const TYPE_CHANGELING = 1 << 13;

export const THEME_LIFE = 1 << 0;
export const THEME_TOKEN = 1 << 1;
export const THEME_TREASURE = 1 << 2;
export const THEME_SAC = 1 << 3;
export const THEME_COUNTER = 1 << 4;
export const THEME_SPELL = 1 << 5;
export const THEME_YARD = 1 << 6;
export const THEME_MILL = 1 << 7;
export const THEME_LAND = 1 << 8;
export const THEME_BLINK = 1 << 9;
export const THEME_DRAW = 1 << 10;
export const THEME_GOAD = 1 << 11;
export const THEME_MONARCH = 1 << 12;
export const THEME_WHEEL = 1 << 13;
export const THEME_DONATE = 1 << 14;
export const THEME_DEATH = 1 << 15;
export const THEME_POISON = 1 << 16;
export const THEME_ENERGY = 1 << 17;
export const THEME_FOOD = 1 << 18;
export const THEME_CLUE = 1 << 19;
export const THEME_COMBAT = 1 << 20;
export const THEME_COPY = 1 << 21;
export const THEME_MODIFIED = 1 << 22;
export const THEME_CRIME = 1 << 23;
export const THEME_PLOT = 1 << 24;
export const THEME_CASCADE = 1 << 25;
export const THEME_STORM = 1 << 26;
export const THEME_MUTATE = 1 << 27;
export const THEME_NINJA = 1 << 28;
export const THEME_ALLIANCE = 1 << 29;
export const THEME_DESCEND = 1 << 30;
