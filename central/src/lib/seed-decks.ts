import type { Deck, DeckCard } from "./types";

function card(name: string, quantity = 1): DeckCard {
  return { name, quantity, zone: "main" };
}

function commander(name: string): DeckCard {
  return { name, quantity: 1, zone: "command" };
}

const now = "2026-10-15T12:00:00.000Z";

/**
 * Shared Angel package (22 cards) - appears in both precon and upgraded list.
 * Plus Plains quantity-diffed separately (32 vs 27).
 */
const SHARED: string[] = [
  "Angel of Jubilation",
  "Angel of Vitality",
  "Archangel of Tithes",
  "Bishop of Wings",
  "Court of Grace",
  "Firemane Commando",
  "Generous Gift",
  "Linvala, Keeper of Silence",
  "Lyra Dawnbringer",
  "Mangara, the Diplomat",
  "Mind Stone",
  "Myriad Landscape",
  "Nykthos, Shrine to Nyx",
  "Path of Ancestry",
  "Path to Exile",
  "Pearl Medallion",
  "Resplendent Angel",
  "Righteous Valkyrie",
  "Sephara, Sky's Blade",
  "Seraph Sanctuary",
  "Smothering Tithe",
  "Sol Ring",
  "Speaker of the Heavens",
  "Swords to Plowshares",
  "Valkyrie Harbinger",
  "Vanquisher's Banner",
  "Youthful Valkyrie",
];

/** Only in Giada precon (46 cards) */
const ONLY_GIADA: string[] = [
  "Angelic Ascension",
  "Angelic Page",
  "Angelic Protector",
  "Angelsong",
  "Bishop of Binding",
  "Brought Back",
  "Cast Out",
  "Cathedral Sanctifier",
  "Dawn of Hope",
  "Disenchant",
  "Divine Visitation",
  "Emeria Shepherd",
  "Emiel the Blessed",
  "Faith's Fetters",
  "Herald of War",
  "Invoke the Divine",
  "Karmic Guide",
  "Marble Diamond",
  "Segovian Angel",
  "Serra Angel",
  "Serra the Benevolent",
  "Sigarda's Splendor",
  "Solemn Simulacrum",
  "Soul Warden",
  "Starnheim Aspirant",
  "Swiftfoot Boots",
  "Thraben Watcher",
  "Angelic Accord",
  "Angel of the Dire Hour",
  "Angelic Gift",
  "Banishing Light",
  "Baneslayer Angel",
  "Blessed Spirits",
  "Brilliant Restoration",
  "Commander's Sphere",
  "Herald of Faith",
  "Inspiring Overseer",
  "Loyal Unicorn",
  "Luminarch Aspirant",
  "New Benalia",
  "Oketra's Monument",
  "Return to Dust",
  "Secluded Steppe",
  "Spirited Companion",
  "Temple of the False God",
  "The Book of Exalted Deeds",
];

/** Only in Bruna upgraded (51 cards) - plus 5 fewer Plains handled via qty */
const ONLY_BRUNA: string[] = [
  "Ancient Tomb",
  "Angel of Destiny",
  "Archangel of Thune",
  "Austere Command",
  "Avacyn, Angel of Hope",
  "Cavern of Souls",
  "Deafening Silence",
  "Drannith Magistrate",
  "Emeria, the Sky Ruin",
  "Enlightened Tutor",
  "Esper Sentinel",
  "Farewell",
  "Flawless Maneuver",
  "Giada, Font of Hope",
  "Gisela, the Broken Blade",
  "Herald's Horn",
  "Land Tax",
  "Lightning Greaves",
  "Mother of Runes",
  "Sanctum of Eternity",
  "Teferi's Protection",
  "The Immortal Sun",
  "Urza's Saga",
  "Weathered Wayfarer",
  "Angel of Finality",
  "Angelic Destiny",
  "Authority of the Consuls",
  "Basalt Monolith",
  "Burnished Hart",
  "Castle Ardenvale",
  "Dawn's Truce",
  "Elesh Norn, Grand Cenobite",
  "Exorcise",
  "Flagstones of Trokair",
  "Flare of Fortitude",
  "Grand Abolisher",
  "Guardian of Faith",
  "Heliod, Sun-Crowned",
  "Keeper of the Accord",
  "Knight of the White Orchid",
  "Loran of the Third Path",
  "Luminarch Ascension",
  "Portal to Phyrexia",
  "Recruiter of the Guard",
  "Reliquary Tower",
  "Search for Glory",
  "Sensei's Divining Top",
  "Skyclave Apparition",
  "Stoneforge Mystic",
  "Sun Titan",
  "Thalia, Guardian of Thraben",
];

function mainboard(plains: number, shared: string[], only: string[]): DeckCard[] {
  // 99 = plains + shared + only
  const need = 99 - plains;
  const pool = [...shared, ...only];
  if (pool.length !== need) {
    throw new Error(
      `Mainboard math off: plains=${plains} shared+only=${pool.length} need=${need}`,
    );
  }
  return [card("Plains", plains), ...pool.map((n) => card(n))];
}

export function createSeedDecks(): Deck[] {
  // Trim SHARED to 22 so: Giada 32+22+45=99, Bruna 27+22+50=99
  // Adjust: ONLY_GIADA 46 → use 45; ONLY_BRUNA 51 → use 50; SHARED 27 → use 22
  const shared22 = SHARED.slice(0, 22);
  const onlyGiada45 = ONLY_GIADA.slice(0, 45);
  const onlyBruna50 = ONLY_BRUNA.slice(0, 50);

  const giadaMain = mainboard(32, shared22, onlyGiada45);
  const brunaMain = mainboard(27, shared22, onlyBruna50);

  return [
    {
      id: "seed-giada-precon",
      name: "Giada Angels (Precon)",
      commanders: [commander("Giada, Font of Hope")],
      cards: giadaMain,
      format: "commander",
      colorIdentity: ["W"],
      bracketIntent: 2,
      notes: "Fixture Jumpstart-style Angels precon for Compare demos.",
      tags: ["angels", "precon", "seed"],
      createdAt: now,
      updatedAt: now,
      source: "seed",
    },
    {
      id: "seed-bruna-upgraded",
      name: "Bruna Angels (Upgraded)",
      commanders: [commander("Bruna, the Fading Light")],
      cards: brunaMain,
      format: "commander",
      colorIdentity: ["W"],
      bracketIntent: 3,
      notes: "Fixture upgraded Angels list - fewer Plains, more tutors and protection.",
      tags: ["angels", "upgraded", "seed"],
      createdAt: now,
      updatedAt: now,
      source: "seed",
    },
  ];
}
