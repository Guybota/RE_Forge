import { canonicalizeName } from "./parse-decklist.ts";

/**
 * Curated lists for local Commander bracket estimates.
 * Game Changers are the Commander Format Panel list (53 cards, February 9, 2026).
 * Names match Scryfall oracle names.
 */

/** Official Commander Game Changers. Unchanged since Farewell and Biorhythm were added. */
export const GAME_CHANGERS: string[] = [
  "Ad Nauseam",
  "Ancient Tomb",
  "Aura Shards",
  "Biorhythm",
  "Bolas's Citadel",
  "Braids, Cabal Minion",
  "Chrome Mox",
  "Coalition Victory",
  "Consecrated Sphinx",
  "Crop Rotation",
  "Cyclonic Rift",
  "Demonic Tutor",
  "Drannith Magistrate",
  "Enlightened Tutor",
  "Farewell",
  "Field of the Dead",
  "Fierce Guardianship",
  "Force of Will",
  "Gaea's Cradle",
  "Gamble",
  "Gifts Ungiven",
  "Glacial Chasm",
  "Grand Arbiter Augustin IV",
  "Grim Monolith",
  "Humility",
  "Imperial Seal",
  "Intuition",
  "Jeska's Will",
  "Lion's Eye Diamond",
  "Mana Vault",
  "Mishra's Workshop",
  "Mox Diamond",
  "Mystical Tutor",
  "Narset, Parter of Veils",
  "Natural Order",
  "Necropotence",
  "Notion Thief",
  "Opposition Agent",
  "Orcish Bowmasters",
  "Panoptic Mirror",
  "Rhystic Study",
  "Seedborn Muse",
  "Serra's Sanctum",
  "Smothering Tithe",
  "Survival of the Fittest",
  "Teferi's Protection",
  "Tergrid, God of Fright",
  "Thassa's Oracle",
  "The One Ring",
  "The Tabernacle at Pendrell Vale",
  "Underworld Breach",
  "Vampiric Tutor",
  "Worldly Tutor",
];

/** Fast mana / dense ramp used for Exhibition vs Core and cEDH-leaning checks. */
export const FAST_MANA: string[] = [
  "Sol Ring",
  "Mana Crypt",
  "Jeweled Lotus",
  "Chrome Mox",
  "Mox Diamond",
  "Lotus Petal",
  "Lion's Eye Diamond",
  "Grim Monolith",
  "Mana Vault",
  "Basalt Monolith",
  "Ancient Tomb",
  "City of Traitors",
  "Gaea's Cradle",
  "Nykthos, Shrine to Nyx",
  "Cabal Coffers",
  "Birds of Paradise",
  "Elves of Deep Shadow",
  "Llanowar Elves",
  "Elvish Mystic",
  "Fyndhorn Elves",
  "Deathrite Shaman",
  "Delighted Halfling",
  "Ragavan, Nimble Pilferer",
];

/** Mass land denial — raises Optimized when present. */
export const MASS_LAND_DENIAL: string[] = [
  "Armageddon",
  "Ravages of War",
  "Catastrophe",
  "Global Ruin",
  "Impending Disaster",
  "Worldslayer",
  "Obliterate",
  "Decree of Annihilation",
  "Jokulhaups",
  "Mass Hysteria",
  "Ruination",
  "From the Ashes",
  "Wildfire",
  "Burning of Xinye",
  "Destructive Force",
  "Death Cloud",
  "Boom // Bust",
  "Boom/Bust",
  "Sunder",
  "Tsunami",
  "Acid Rain",
  "Flashfires",
  "Choke",
  "Back to Basics",
  "Blood Moon",
  "Magus of the Moon",
  "Winter Orb",
  "Static Orb",
  "Stasis",
  "Rising Waters",
  "Hokori, Dust Drinker",
];

/** Extra-turn spells — with Game Changers push toward Optimized. */
export const EXTRA_TURNS: string[] = [
  "Time Warp",
  "Temporal Manipulation",
  "Capture of Jingzhou",
  "Expropriate",
  "Temporal Trespass",
  "Nexus of Fate",
  "Time Stretch",
  "Beacon of Tomorrows",
  "Walk the Aeons",
  "Part the Waterveil",
  "Alrund's Epiphany",
  "Karn's Temporal Sundering",
  "Chance for Glory",
  "Final Fortune",
  "Last Chance",
  "Warrior's Oath",
  "Temporal Mastery",
  "Sage of Hours",
  "Notorious Throng",
];

const gcSet = new Set(GAME_CHANGERS.map(canonicalizeName));
const fastSet = new Set(FAST_MANA.map(canonicalizeName));
const mldSet = new Set(MASS_LAND_DENIAL.map(canonicalizeName));
const etSet = new Set(EXTRA_TURNS.map(canonicalizeName));

export function isGameChanger(name: string): boolean {
  const key = canonicalizeName(name);
  if (gcSet.has(key)) return true;
  return key.split(" // ").some((face) => gcSet.has(face.trim()));
}

export function isFastMana(name: string): boolean {
  return fastSet.has(canonicalizeName(name));
}

export function isMassLandDenial(name: string): boolean {
  return mldSet.has(canonicalizeName(name));
}

export function isExtraTurn(name: string): boolean {
  return etSet.has(canonicalizeName(name));
}
