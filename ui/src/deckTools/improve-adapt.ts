import { tagOf } from "./card-tags.ts";
import {
  THEME_ALLIANCE,
  THEME_BLINK,
  THEME_CASCADE,
  THEME_CLUE,
  THEME_COMBAT,
  THEME_COPY,
  THEME_COUNTER,
  THEME_CRIME,
  THEME_DEATH,
  THEME_DESCEND,
  THEME_DONATE,
  THEME_DRAW,
  THEME_ENERGY,
  THEME_FOOD,
  THEME_GOAD,
  THEME_LAND,
  THEME_LIFE,
  THEME_MILL,
  THEME_MODIFIED,
  THEME_MONARCH,
  THEME_MUTATE,
  THEME_NINJA,
  THEME_PLOT,
  THEME_POISON,
  THEME_SAC,
  THEME_SPELL,
  THEME_STORM,
  THEME_TOKEN,
  THEME_TREASURE,
  THEME_WHEEL,
  THEME_YARD,
  TYPE_ARTIFACT,
  TYPE_AURA,
  TYPE_CHANGELING,
  TYPE_CREATURE,
  TYPE_ENCHANTMENT,
  TYPE_EQUIPMENT,
  TYPE_LAND,
  TYPE_LEGENDARY,
  TYPE_PLANESWALKER,
  TYPE_VEHICLE,
} from "./card-tag-bits.ts";
import { isGameChanger } from "./game-changers.ts";
import { canonicalizeName } from "./parse-decklist.ts";
import { joinList, say, translating } from "./say.ts";
import type { ColorIdentity, Deck, Suggestion } from "./types.ts";

export type AdaptPlan = {
  id: string;
  title: string;
  summary: string;
  play: string;
  suggestions: Suggestion[];
};

type Offer = {
  name: string;
  colors: ColorIdentity[];
  because: string;
};

type Avoid = "bit" | "aura" | "equipment" | "enchant" | "artifact" | "vehicle" | "legend";

type ThemeDef = {
  id: string;
  title: string;
  summary: string;
  play: string;
  commanderPlay?: string;
  thread: string;
  threshold: number;
  bit?: number;
  avoid: Avoid;
  offers: Offer[];
};

const BASIC = /^(snow-covered )?(plains|island|swamp|mountain|forest|wastes)$/i;

const KEEP = new Set(
  [
    "sol ring",
    "arcane signet",
    "command tower",
    "mana crypt",
    "fellwar stone",
    "mind stone",
    "thought vessel",
    "swiftfoot boots",
    "lightning greaves",
    "path to exile",
    "swords to plowshares",
    "chaos warp",
    "beast within",
    "blasphemous act",
    "generous gift",
    "cultivate",
    "farseek",
    "kodama's reach",
    "rampant growth",
    "nature's lore",
    "three visits",
    "sakura-tribe elder",
    "solemn simulacrum",
    "skullclamp",
    "exotic orchard",
    "reliquary tower",
    "bojuka bog",
  ].map((name) => canonicalizeName(name)),
);

const WEAK = new Set(
  [
    "armillary sphere",
    "darksteel ingot",
    "commander's sphere",
    "pilgrim's eye",
    "burnished hart",
    "hedron archive",
    "dreamstone hedron",
    "surveyor's scope",
    "manalith",
    "prismatic lens",
    "traveler's amulet",
    "wanderer's twig",
    "opal palace",
    "temple of the false god",
    "myriad landscape",
    "journey to nowhere",
    "oblivion ring",
    "faith's fetters",
    "pacifism",
    "arrest",
    "prison term",
    "crib swap",
    "condemn",
    "pillory of the sleepless",
    "soul snare",
    "transguild promenade",
    "rupture spire",
    "gateway plaza",
  ].map((name) => canonicalizeName(name)),
);

const COMMANDER_FORCE = new Set([
  "donate",
  "goad",
  "monarch",
  "combat",
  "poison",
  "mutate",
  "ninja",
  "storm",
  "cascade",
]);

function o(name: string, colors: ColorIdentity[], because: string): Offer {
  return { name, colors, because };
}

function article(word: string): string {
  return /^[aeio]/i.test(word) ? "an" : "a";
}

function pluralType(type: string, count: number): string {
  if (count === 1) return type;
  const irregular: Record<string, string> = {
    Elf: "Elves",
    Dwarf: "Dwarves",
    Wolf: "Wolves",
    Werewolf: "Werewolves",
    Mouse: "Mice",
    Human: "Humans",
  };
  if (irregular[type]) return irregular[type];
  if (/[^aeiou]y$/i.test(type)) return `${type.slice(0, -1)}ies`;
  if (/(s|x|ch|sh)$/i.test(type)) return `${type}es`;
  return `${type}s`;
}

function fill(text: string, tribe: string, plural: string, count: number): string {
  return say(text)
    .replaceAll("{tribe}", tribe)
    .replaceAll("{plural}", plural)
    .replaceAll("{count}", String(count));
}

function inDeck(deck: Deck, name: string): boolean {
  const key = canonicalizeName(name);
  return [...deck.commanders, ...deck.cards].some((card) => canonicalizeName(card.name) === key);
}

function fits(colors: ColorIdentity[], identity: ColorIdentity[]): boolean {
  if (!identity.length) return colors.length === 0;
  return colors.every((color) => identity.includes(color));
}

function isKeep(name: string): boolean {
  if (KEEP.has(canonicalizeName(name))) return true;
  if (/^talisman of /i.test(name)) return true;
  if (/signet$/i.test(name)) return true;
  return false;
}

function isWeak(name: string): boolean {
  if (WEAK.has(canonicalizeName(name))) return true;
  return /cluestone|obelisk/i.test(name);
}

function hasType(name: string, bit: number): boolean {
  const tag = tagOf(name);
  return Boolean(tag && tag.types & bit);
}

function supportsTheme(name: string, bit: number): boolean {
  const tag = tagOf(name);
  return Boolean(tag && tag.themes & bit);
}

function supportsTribe(name: string, tribe: string): boolean {
  const tag = tagOf(name);
  if (tag && tag.types & TYPE_CHANGELING) return true;
  if (tag?.sub.some((sub) => sub.toLowerCase() === tribe.toLowerCase())) return true;
  const hint: Record<string, RegExp> = {
    Elf: /\bEl(f|ves)\b/i,
    Human: /\bHumans?\b/i,
    Wolf: /\bWol(f|ves)\b/i,
    Dwarf: /\bDwar(f|ves)\b/i,
  };
  if (hint[tribe]) return hint[tribe].test(name);
  if (tribe.length <= 4) return new RegExp(`\\b${tribe}s?\\b`, "i").test(name);
  return new RegExp(tribe, "i").test(name);
}

export function pickDisposableCuts(
  deck: Deck,
  count: number,
  usedCuts: Set<string>,
  avoid: (name: string) => boolean,
): string[] {
  const ranked: { name: string; score: number }[] = [];
  for (const card of deck.cards) {
    const key = canonicalizeName(card.name);
    if (usedCuts.has(key)) continue;
    if (BASIC.test(card.name.trim())) continue;
    if (deck.commanders.some((commander) => canonicalizeName(commander.name) === key)) continue;
    if (isGameChanger(card.name) || isKeep(card.name) || avoid(card.name)) continue;
    const tag = tagOf(card.name);
    const cmc = tag?.cmc ?? 4;
    const land = Boolean(tag && tag.types & TYPE_LAND);
    const creature = Boolean(tag && tag.types & TYPE_CREATURE);
    const legendary = Boolean(tag && tag.types & TYPE_LEGENDARY);
    const planeswalker = Boolean(tag && tag.types & TYPE_PLANESWALKER);
    let score = 0;
    if (isWeak(card.name) && !land) score = 200 + cmc;
    else if (isWeak(card.name) && land) score = 30 + cmc;
    else if (!planeswalker && creature && !legendary && cmc >= 3) score = 100 + cmc;
    else if (!planeswalker && creature && legendary && cmc >= 6) score = 40 + cmc;
    else if (!planeswalker && !creature && !legendary && !land && tag && tag.types & TYPE_ARTIFACT)
      score = 50 + cmc;
    if (score <= 0) continue;
    ranked.push({ name: card.name, score });
  }
  ranked.sort((a, b) => b.score - a.score || a.name.localeCompare(b.name));
  const out: string[] = [];
  const seen = new Set<string>();
  for (const row of ranked) {
    if (out.length >= count) break;
    const key = canonicalizeName(row.name);
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(row.name);
  }
  return out;
}

const UNIVERSAL: Offer[] = [
  o("Vanquisher's Banner", [], "Vanquisher's Banner gives your {plural} +1/+1 and draws a card whenever you cast one."),
  o("Roaming Throne", [], "Roaming Throne is every creature type, so it counts as a {tribe}, and it copies a triggered ability of that type."),
  o("Patchwork Banner", [], "Patchwork Banner anthems your {plural} and adds one mana of a color they share."),
  o("Herald's Horn", [], "Herald's Horn makes the next {tribe} cheaper and can draw you one on your upkeep."),
  o("Icon of Ancestry", [], "Icon of Ancestry anthems your {plural} and lets you dig for another one."),
  o("Metallic Mimic", [], "Metallic Mimic enters as a {tribe} and puts a +1/+1 counter on each {tribe} you cast."),
  o("Door of Destinies", [], "Door of Destinies grows a counter each time you cast a {tribe}, and your {plural} get that much power and toughness."),
];

const COLOR_TRIBAL: Offer[] = [
  o("Kindred Discovery", ["U"], "Kindred Discovery draws a card whenever one of your {plural} enters or attacks."),
  o("Reflections of Littjara", ["U"], "Reflections of Littjara copies the next {tribe} spell you cast each turn."),
  o("Distant Melody", ["U"], "Distant Melody draws a card for each {tribe} you control."),
  o("Shared Animosity", ["R"], "Shared Animosity pumps each attacking {tribe} for the other attacking creatures that share a type with it."),
  o("Kindred Summons", ["G"], "Kindred Summons looks at the top of your library for {plural} and puts them onto the battlefield."),
  o("Beast Whisperer", ["G"], "Beast Whisperer draws a card whenever you cast a creature, and this list casts a lot of {plural}."),
  o("Guardian Project", ["G"], "Guardian Project draws a card the first time you cast a new creature each turn."),
  o("Shared Triumph", ["W"], "Shared Triumph anthems the {tribe} type you choose."),
  o("Patriarch's Bidding", ["B"], "Patriarch's Bidding returns every {tribe} from the graveyard at once."),
  o("Haunting Voyage", ["B"], "Haunting Voyage returns {plural} from your graveyard, and foretell makes it all of them."),
];

const TRIBE_OFFERS: Record<string, Offer[]> = {
  Elf: [
    o("Elvish Archdruid", ["G"], "Elvish Archdruid taps for green mana for each Elf you control and anthems them."),
    o("Priest of Titania", ["G"], "Priest of Titania taps for green mana for each Elf you control."),
    o("Marwyn, the Nurturer", ["G"], "Marwyn, the Nurturer grows when Elves enter and taps for that much green mana."),
    o("Elvish Warmaster", ["G"], "Elvish Warmaster makes a 1/1 Elf whenever you cast an Elf, and it can pump them for an attack."),
    o("Heritage Druid", ["G"], "Heritage Druid taps three Elves for three green mana."),
    o("Circle of Dreams Druid", ["G"], "Circle of Dreams Druid taps for green mana equal to the creatures you control."),
    o("Joraga Warcaller", ["G"], "Joraga Warcaller gets a counter for each mana you spend and gives your other Elves that much power and toughness."),
    o("Ezuri, Renegade Leader", ["G"], "Ezuri, Renegade Leader regenerates your Elves or gives them +3/+3 and trample for a turn."),
  ],
  Goblin: [
    o("Krenko, Mob Boss", ["R"], "Krenko, Mob Boss taps to make Goblins equal to the Goblins you already have."),
    o("Goblin Warchief", ["R"], "Goblin Warchief makes your Goblins cheaper and gives them haste."),
    o("Muxus, Goblin Grandee", ["R"], "Muxus, Goblin Grandee puts a pile of Goblins from the top of your library onto the battlefield."),
    o("Pashalik Mons", ["R"], "Pashalik Mons makes a Goblin when it enters and deals damage whenever a Goblin you control dies."),
    o("Skirk Prospector", ["R"], "Skirk Prospector sacrifices a Goblin for red mana."),
    o("Goblin Trashmaster", ["R"], "Goblin Trashmaster anthems your Goblins and can sacrifice one to destroy an artifact."),
    o("Goblin Matron", ["R"], "Goblin Matron tutors a Goblin card into your hand."),
    o("Warren Instigator", ["R"], "Warren Instigator lets you drop Goblins from your hand when it connects."),
  ],
  Dragon: [
    o("Dragon Tempest", ["R"], "Dragon Tempest gives your Dragons haste and deals damage when one enters."),
    o("Scourge of Valkas", ["R"], "Scourge of Valkas deals damage whenever a Dragon enters, for each Dragon you control."),
    o("Utvara Hellkite", ["R"], "Utvara Hellkite makes a Dragon token whenever a Dragon you control attacks."),
    o("Lathliss, Dragon Queen", ["R"], "Lathliss, Dragon Queen makes a Dragon token whenever a nontoken Dragon enters and can pump them."),
    o("Terror of the Peaks", ["R"], "Terror of the Peaks deals damage equal to a creature's power when it enters."),
    o("Dragonlord's Servant", ["R"], "Dragonlord's Servant makes your Dragon spells cost less."),
    o("Dragonspeaker Shaman", ["R"], "Dragonspeaker Shaman makes your Dragon spells cost less."),
    o("Wrathful Red Dragon", ["R"], "Wrathful Red Dragon deals damage back whenever a Dragon you control is dealt damage."),
  ],
  Zombie: [
    o("Rooftop Storm", ["U"], "Rooftop Storm lets you cast Zombie spells for free."),
    o("Diregraf Colossus", ["B"], "Diregraf Colossus enters with a counter for each Zombie you control and makes tokens when you cast Zombies."),
    o("Undead Augur", ["B"], "Undead Augur draws a card whenever a Zombie you control dies."),
    o("Gravecrawler", ["B"], "Gravecrawler comes back from the graveyard as long as you control a Zombie."),
    o("Lord of the Undead", ["B"], "Lord of the Undead anthems your Zombies and can put one from the graveyard on top of your library."),
    o("Death Baron", ["B"], "Death Baron gives your Zombies and Skeletons +1/+1 and deathtouch."),
    o("Cemetery Reaper", ["B"], "Cemetery Reaper anthems Zombies and exiles a graveyard card to make a Zombie token."),
    o("Endless Ranks of the Dead", ["B"], "Endless Ranks of the Dead makes a Zombie token on your upkeep for every two Zombies you have."),
  ],
  Vampire: [
    o("Captivating Vampire", ["B"], "Captivating Vampire anthems your Vampires and can turn another creature into one."),
    o("Cordial Vampire", ["B"], "Cordial Vampire puts a +1/+1 counter on each Vampire you control whenever a creature dies."),
    o("Vampire Nocturnus", ["B"], "Vampire Nocturnus pumps your Vampires and gives them first strike while the top of your library is black."),
    o("Legion Lieutenant", ["W", "B"], "Legion Lieutenant gives your other Vampires +1/+1."),
    o("Bloodline Keeper", ["B"], "Bloodline Keeper makes a Vampire token on your turn and can become a lord."),
    o("Vampire Socialite", ["B"], "Vampire Socialite grows when a Vampire you control attacks, and your other Vampires get that much too."),
    o("Stromkirk Captain", ["B", "R"], "Stromkirk Captain gives your other Vampires +1/+1 and first strike."),
    o("Crossway Troublemakers", ["R"], "Crossway Troublemakers gives attacking Vampires menace if you attacked with three or more creatures."),
  ],
  Wizard: [
    o("Harmonic Prodigy", ["R"], "Harmonic Prodigy doubles triggered abilities of Shamans and Wizards you control."),
    o("Naban, Dean of Iteration", ["U"], "Naban, Dean of Iteration doubles enter-the-battlefield triggers of your Wizards."),
    o("Archmage Emeritus", ["U"], "Archmage Emeritus draws a card whenever you copy or cast an instant or sorcery."),
    o("Azami, Lady of Scrolls", ["U"], "Azami, Lady of Scrolls taps a Wizard to draw a card."),
    o("Aether Channeler", ["U"], "Aether Channeler draws, bounces, or makes a token, and Wizards you control copy that choice."),
    o("Rite of Replication", ["U"], "Rite of Replication copies a creature, and kicked it makes five copies."),
  ],
  Dinosaur: [
    o("Regisaur Alpha", ["R", "G"], "Regisaur Alpha makes a 3/3 Dinosaur with haste and gives your other Dinosaurs haste."),
    o("Polyraptor", ["G"], "Polyraptor makes a copy of itself whenever it is dealt damage."),
    o("Marauding Raptor", ["R"], "Marauding Raptor makes Dinosaurs cheaper and deals damage when one enters."),
    o("Forerunner of the Empire", ["R"], "Forerunner of the Empire tutors a Dinosaur and damages each creature when a Dinosaur enters."),
    o("Zacama, Primal Calamity", ["W", "R", "G"], "Zacama, Primal Calamity untaps your lands when it enters and can fight, gain life, or deal damage."),
    o("Ghalta, Primal Hunger", ["G"], "Ghalta, Primal Hunger costs less for the power of your creatures and is a huge Dinosaur."),
    o("Temple Altisaur", ["W"], "Temple Altisaur prevents all but 1 damage to your other Dinosaurs."),
    o("Savage Stomp", ["G"], "Savage Stomp fights and puts counters on the Dinosaur you control."),
  ],
  Pirate: [
    o("Corsair Captain", ["U"], "Corsair Captain makes a Treasure when it enters and gives your Pirates menace."),
    o("Admiral Beckett Brass", ["U", "B", "R"], "Admiral Beckett Brass lets you steal a creature when three or more Pirates attack."),
    o("Ramirez DePietro, Pillager", ["U", "B"], "Ramirez DePietro, Pillager fills the graveyard and casts spells from it when Pirates deal combat damage."),
    o("Pitiless Plunderer", ["B"], "Pitiless Plunderer makes a Treasure whenever a creature you control dies."),
    o("Coercive Recruiter", ["R"], "Coercive Recruiter gains control of a creature whenever a Pirate enters."),
    o("Port Razer", ["R"], "Port Razer untaps your attackers and gives you another combat when it deals combat damage."),
    o("Captain Lannery Storm", ["R"], "Captain Lannery Storm makes a Treasure on attack and can sacrifice one for +1/+0 and menace."),
    o("Malcolm, Keen-Eyed Navigator", ["U"], "Malcolm, Keen-Eyed Navigator makes a Treasure whenever a Pirate you control deals damage to an opponent."),
  ],
  Sliver: [
    o("The First Sliver", ["W", "U", "B", "R", "G"], "The First Sliver gives your Sliver spells cascade."),
    o("Sliver Hivelord", ["W", "U", "B", "R", "G"], "Sliver Hivelord gives your Slivers indestructible."),
    o("Sliver Legion", ["W", "U", "B", "R", "G"], "Sliver Legion pumps your Slivers for each Sliver on the battlefield."),
    o("Cloudshredder Sliver", ["R"], "Cloudshredder Sliver gives your Slivers flying and haste."),
    o("Diffusion Sliver", ["U"], "Diffusion Sliver taxes spells that target your Slivers."),
    o("Galerider Sliver", ["U"], "Galerider Sliver gives your Slivers flying."),
    o("Harmonic Sliver", ["G"], "Harmonic Sliver destroys an artifact or enchantment whenever a Sliver enters."),
    o("Megantic Sliver", ["G"], "Megantic Sliver gives your Slivers +3/+3."),
  ],
  Merfolk: [
    o("Merfolk Mistbinder", ["G", "U"], "Merfolk Mistbinder gives your other Merfolk +1/+1."),
    o("Silvergill Adept", ["U"], "Silvergill Adept draws a card if you control another Merfolk."),
    o("Kumena, Tyrant of Orazca", ["G", "U"], "Kumena, Tyrant of Orazca taps Merfolk to draw or to put counters on them."),
    o("Master of the Pearl Trident", ["U"], "Master of the Pearl Trident gives your other Merfolk +1/+1 and islandwalk."),
    o("Lord of Atlantis", ["U"], "Lord of Atlantis gives your other Merfolk +1/+1 and islandwalk."),
    o("Merrow Reejerey", ["U"], "Merrow Reejerey untaps a permanent when you cast a Merfolk and anthems them."),
    o("Svyelun of Sea and Sky", ["U"], "Svyelun of Sea and Sky protects your Merfolk and draws when one deals combat damage."),
    o("Deeproot Elite", ["G"], "Deeproot Elite puts a +1/+1 counter on a Merfolk whenever another Merfolk enters."),
  ],
  Faerie: [
    o("Scion of Oona", ["U"], "Scion of Oona gives your other Faeries +1/+1 and shroud."),
    o("Spellstutter Sprite", ["U"], "Spellstutter Sprite counters a spell with mana value up to the number of Faeries you control."),
    o("Glen Elendra Archmage", ["U"], "Glen Elendra Archmage counters a noncreature spell and comes back with persist."),
    o("Tegwyll, Duke of Splendor", ["U", "B"], "Tegwyll, Duke of Splendor anthems Faeries and draws when one dies."),
    o("Obyra, Dreaming Duelist", ["U", "B"], "Obyra, Dreaming Duelist makes a Faerie token whenever you cast a spell during an opponent's turn."),
    o("Alela, Cunning Conqueror", ["U", "B"], "Alela, Cunning Conqueror makes a Faerie when you cast during an opponent's turn and goads when a Faerie deals combat damage."),
    o("Faerie Mastermind", ["U"], "Faerie Mastermind draws when an opponent draws a second card, and it can make each opponent draw."),
  ],
  Soldier: [
    o("Myrel, Shield of Argive", ["W"], "Myrel, Shield of Argive makes Soldiers on attack and stops opponents from casting on your turn."),
    o("Field Marshal", ["W"], "Field Marshal gives your other Soldiers +1/+1 and first strike."),
    o("Captain of the Watch", ["W"], "Captain of the Watch makes three Soldiers and gives your other Soldiers +1/+1 and vigilance."),
    o("Daru Warchief", ["W"], "Daru Warchief makes Soldier spells cheaper and gives your Soldiers +1/+2."),
    o("Catapult Master", ["W"], "Catapult Master taps five Soldiers to exile a creature."),
    o("Preeminent Captain", ["W"], "Preeminent Captain lets you put a Soldier from your hand onto the battlefield when it attacks."),
    o("Valiant Veteran", ["W"], "Valiant Veteran gives your other Soldiers +1/+1, and it can be exiled to pump them more."),
    o("Adeline, Resplendent Cathar", ["W"], "Adeline, Resplendent Cathar makes a tapped Soldier token on attack for each opponent."),
  ],
  Knight: [
    o("Knight Exemplar", ["W"], "Knight Exemplar gives your other Knights +1/+1 and indestructible."),
    o("History of Benalia", ["W"], "History of Benalia makes two Knight tokens and then pumps your Knights."),
    o("Knights' Charge", ["W", "B"], "Knights' Charge drains an opponent when a Knight attacks and can return a Knight from the graveyard."),
    o("Valiant Knight", ["W"], "Valiant Knight pumps your Knights and can double the number of attacking creatures."),
    o("Acclaimed Contender", ["W"], "Acclaimed Contender looks for a Knight when it enters if you control another Knight."),
    o("Worthy Knight", ["W"], "Worthy Knight makes a Soldier token whenever you cast a Knight."),
    o("Syr Alin, the Lion's Claw", ["W"], "Syr Alin, the Lion's Claw pumps attacking creatures when it attacks, and other Knights get more."),
  ],
  Spirit: [
    o("Drogskol Captain", ["W", "U"], "Drogskol Captain gives your other Spirits +1/+1 and hexproof."),
    o("Supreme Phantom", ["U"], "Supreme Phantom gives your other Spirits +1/+1."),
    o("Shacklegeist", ["U"], "Shacklegeist taps a creature when it enters, and it costs less if you control other Spirits."),
    o("Millicent, Restless Revenant", ["W", "U"], "Millicent, Restless Revenant makes Spirit tokens when Spirits you control die and anthems them."),
    o("Nebelgast Herald", ["U"], "Nebelgast Herald taps a creature whenever a Spirit enters."),
    o("Hallowed Haunting", ["W"], "Hallowed Haunting makes a Spirit token whenever you cast an enchantment, and those Spirits get bigger."),
    o("Geist-Honored Monk", ["W"], "Geist-Honored Monk enters with a Spirit token for each creature you control."),
  ],
  Cat: [
    o("Feline Sovereign", ["G"], "Feline Sovereign anthems Cats and destroys an artifact or enchantment when a Cat deals combat damage."),
    o("Kaheera, the Orphanguard", ["G", "W"], "Kaheera, the Orphanguard gives your other Cats, Elementals, Nightmares, Dinosaurs, and Beasts vigilance and +1/+1."),
    o("Jetmir, Nexus of Revels", ["R", "G", "W"], "Jetmir, Nexus of Revels pumps your team, and three or more creatures gives them trample and double strike."),
    o("Jinnie Fay, Jetmir's Second", ["R", "G", "W"], "Jinnie Fay, Jetmir's Second lets your tokens enter as Cats or Dogs instead."),
    o("Arahbo, Roar of the World", ["G", "W"], "Arahbo, Roar of the World pumps a Cat when it enters and when it attacks."),
    o("Regal Caracal", ["W"], "Regal Caracal makes two Cat tokens and gives your Cats lifelink and +1/+1."),
  ],
  Human: [
    o("Thalia's Lieutenant", ["W"], "Thalia's Lieutenant gets a counter whenever another Human enters, and that Human gets one too."),
    o("Champion of the Parish", ["W"], "Champion of the Parish gets a +1/+1 counter whenever you cast a Human."),
    o("Katilda, Dawnhart Prime", ["G", "W"], "Katilda, Dawnhart Prime taps Humans for any-color mana and buffs them at five mana."),
    o("Kyler, Sigardian Emissary", ["G", "W"], "Kyler, Sigardian Emissary grows when a Human enters and gives your other Humans that much power and toughness."),
    o("Heronblade Elite", ["G"], "Heronblade Elite taps for green mana for each creature you control and grows whenever a Human enters."),
    o("Coppercoat Vanguard", ["W"], "Coppercoat Vanguard gives your other Humans ward and +1/+0."),
    o("Adeline, Resplendent Cathar", ["W"], "Adeline, Resplendent Cathar makes a tapped Human token on attack for each opponent."),
  ],
  Cleric: [
    o("Righteous Valkyrie", ["W"], "Righteous Valkyrie anthems Angels and Clerics and gains life when one enters."),
    o("Vito, Thorn of the Dusk Rose", ["B"], "Vito, Thorn of the Dusk Rose drains an opponent whenever you gain life, and it can make your team lifelink."),
    o("Orah, Skyclave Hierophant", ["W", "B"], "Orah, Skyclave Hierophant returns a cheaper Cleric whenever a Cleric dies."),
    o("Heliod, Sun-Crowned", ["W"], "Heliod, Sun-Crowned gives a creature lifelink and puts counters on your creatures whenever you gain life."),
    o("Cleric Class", ["W"], "Cleric Class gains life when a creature enters and can put counters on a Cleric or Warrior."),
    o("Speaker of the Heavens", ["W"], "Speaker of the Heavens taps to make an Angel token once your life total is high enough."),
  ],
  Warrior: [
    o("Kargan Warleader", ["R", "W"], "Kargan Warleader gives your other Warriors +1/+1 and can pump one for an attack."),
    o("Blood-Chin Rager", ["B"], "Blood-Chin Rager gives your Warriors menace."),
    o("Wulfgar of Icewind Dale", ["R"], "Wulfgar of Icewind Dale doubles attack triggers."),
    o("Arashin Foremost", ["W"], "Arashin Foremost double strikes and gives another Warrior double strike when it enters."),
    o("Garna, Bloodfist of Keld", ["B", "R"], "Garna, Bloodfist of Keld gives your creatures haste and draws when one dies on your turn."),
  ],
  Elemental: [
    o("Risen Reef", ["G", "U"], "Risen Reef draws or ramps whenever an Elemental enters."),
    o("Omnath, Locus of Rage", ["R", "G"], "Omnath, Locus of Rage makes an Elemental when a land enters and deals damage when an Elemental dies."),
    o("Animar, Soul of Elements", ["U", "R", "G"], "Animar, Soul of Elements gets a counter whenever you cast a creature and makes creature spells of that color cost less."),
    o("Incandescent Soulstoke", ["R"], "Incandescent Soulstoke pumps your Elementals and can sneak one in for a turn."),
    o("Scampering Scorcher", ["R"], "Scampering Scorcher makes two Elemental tokens and gives your Elementals haste."),
    o("Cavalier of Flame", ["R"], "Cavalier of Flame discards to pump Elementals and deals damage when it dies."),
  ],
  Hydra: [
    o("Gargos, Vicious Watcher", ["G"], "Gargos, Vicious Watcher makes Hydras cheaper, fights when you cast one, and grows when it is targeted."),
    o("Unbound Flourishing", ["G"], "Unbound Flourishing copies or doubles X spells and counters."),
    o("Branching Evolution", ["G"], "Branching Evolution doubles the +1/+1 counters you put on creatures."),
    o("Hardened Scales", ["G"], "Hardened Scales adds an extra +1/+1 counter whenever you put counters on a creature."),
    o("Kalonian Hydra", ["G"], "Kalonian Hydra doubles its counters on attack and enters with four."),
    o("Invigorating Surge", ["G"], "Invigorating Surge doubles the counters on a creature and can do it again."),
  ],
  Beast: [
    o("Rampaging Baloths", ["G"], "Rampaging Baloths makes a 4/4 Beast whenever a land enters."),
    o("Garruk's Packleader", ["G"], "Garruk's Packleader draws a card whenever you cast a creature with power 3 or greater."),
    o("Krosan Warchief", ["G"], "Krosan Warchief makes Beasts cheaper and regenerates them."),
    o("Beast Whisperer", ["G"], "Beast Whisperer draws a card whenever you cast a creature."),
    o("Quartzwood Crasher", ["R", "G"], "Quartzwood Crasher makes a Beast token with trample when a creature you control deals excess combat damage."),
    o("Pathbreaker Ibex", ["G"], "Pathbreaker Ibex gives your team extra power and toughness equal to the greatest power among them when it attacks."),
  ],
  Wall: [
    o("High Alert", ["W", "U"], "High Alert lets your Walls attack as though they didn't have defender, using toughness as power."),
    o("Assault Formation", ["G"], "Assault Formation lets your creatures deal damage with toughness and pumps one."),
    o("Arcades, the Strategist", ["W", "U", "G"], "Arcades, the Strategist lets Walls attack and draws when one enters."),
    o("Rolling Stones", ["W"], "Rolling Stones lets Walls attack as though they didn't have defender."),
    o("Stalwart Shield-Bearers", ["W"], "Stalwart Shield-Bearers gives your other Walls +0/+2."),
  ],
  Eldrazi: [
    o("Forsaken Monument", [], "Forsaken Monument adds an extra colorless mana, pumps colorless creatures, and gains life when one attacks."),
    o("Eldrazi Monument", [], "Eldrazi Monument gives your creatures flying, indestructible, and +1/+1."),
    o("Conduit of Ruin", [], "Conduit of Ruin makes the next colorless creature cheaper and tutors one."),
    o("It That Betrays", [], "It That Betrays puts a permanent onto the battlefield under your control whenever an opponent sacrifices one."),
    o("Morophon, the Boundless", [], "Morophon, the Boundless reduces the cost of a chosen creature type and buffs those creatures."),
    o("Eldrazi Temple", [], "Eldrazi Temple taps for two colorless toward Eldrazi and colorless spells."),
    o("All Is Dust", [], "All Is Dust makes each player sacrifice all of their colored permanents."),
    o("Not of This World", [], "Not of This World counters a spell that targets a creature you control with power 7 or greater, often for free."),
  ],
  Rat: [
    o("Marrow-Gnawer", ["B"], "Marrow-Gnawer gives Rats fear and taps to make Rats equal to the Rats you have."),
    o("Lord Skitter, Sewer King", ["B"], "Lord Skitter, Sewer King makes a Rat token on your end step and exiles graveyards."),
    o("Karumonix, the Rat King", ["B"], "Karumonix, the Rat King gives your other Rats toxic and draws when a Rat deals combat damage to a player."),
    o("Piper of the Swarm", ["B"], "Piper of the Swarm makes Rats and can steal a creature if you have enough of them."),
    o("Ogre Slumlord", ["B"], "Ogre Slumlord gives your Rats deathtouch and makes a Rat when a nontoken creature dies."),
    o("Tangled Colony", ["B"], "Tangled Colony makes Rats when it dies if it was dealt damage."),
    o("Swarmyard", [], "Swarmyard regenerates a Rat, Spider, Squirrel, or Insect."),
  ],
  Werewolf: [
    o("Immerwolf", ["R", "G"], "Immerwolf pumps your Wolf and Werewolf creatures and keeps them from transforming back."),
    o("Nightpack Ambusher", ["G"], "Nightpack Ambusher makes a Wolf on your end step if you cast no spells, and it pumps Wolves and Werewolves."),
    o("Cult of the Waxing Moon", ["R"], "Cult of the Waxing Moon makes a Wolf token whenever a permanent you control transforms."),
    o("Unnatural Moonrise", ["R", "G"], "Unnatural Moonrise makes day into night and draws when a permanent transforms."),
    o("Silverfur Partisan", ["G"], "Silverfur Partisan makes a Wolf whenever a Wolf or Werewolf you control becomes the target of a spell."),
    o("Howl of the Night Pack", ["G"], "Howl of the Night Pack makes a Wolf token for each Forest you control."),
  ],
  Treefolk: [
    o("Doran, the Siege Tower", ["W", "B", "G"], "Doran, the Siege Tower makes creatures deal damage with toughness."),
    o("Timber Protector", ["G"], "Timber Protector makes your other Treefolk indestructible and pumps them."),
    o("Dauntless Dourbark", ["G"], "Dauntless Dourbark's power and toughness grow with your Forests and Treefolk."),
    o("Reach of Branches", ["G"], "Reach of Branches makes a Treefolk token whenever a Treefolk you control dies, and it can come back from the graveyard."),
    o("Bosk Banneret", ["G", "W"], "Bosk Banneret makes Treefolk and Shaman spells cheaper."),
  ],
  Ally: [
    o("Turntimber Ranger", ["G"], "Turntimber Ranger makes an Ally token and grows whenever an Ally enters."),
    o("Hagra Diabolist", ["B"], "Hagra Diabolist drains an opponent for each Ally you control when it or another Ally enters."),
    o("Sea Gate Loremaster", ["U"], "Sea Gate Loremaster draws a card for each Ally you control when it enters, if you tap your Allies."),
    o("Resolute Blademaster", ["R", "W"], "Resolute Blademaster gives your Allies double strike when it attacks."),
    o("Kalastria Healer", ["B"], "Kalastria Healer drains an opponent whenever an Ally enters."),
    o("General Tazri", ["W"], "General Tazri tutors an Ally and anthems Allies for white mana."),
    o("Munda, Ambush Leader", ["R", "W"], "Munda, Ambush Leader looks for an Ally whenever one enters."),
  ],
  Assassin: [
    o("Mari, the Killing Quill", ["B"], "Mari, the Killing Quill draws and makes a Treasure when an Assassin, Rogue, or Warlock deals combat damage, and it gives them deathtouch."),
    o("Etrata, the Silencer", ["U", "B"], "Etrata, the Silencer exiles a creature it hits and can win if three cards are exiled with hit counters."),
    o("Vein Ripper", ["B"], "Vein Ripper drains an opponent whenever a creature dies and is hard to block."),
    o("Massacre Girl, Known Killer", ["B"], "Massacre Girl, Known Killer draws when a creature dies from having 0 or less toughness and gives your creatures wither."),
  ],
  Phyrexian: [
    o("Skrelv, Defector Mite", ["W"], "Skrelv, Defector Mite protects a creature from a color and can make it toxic."),
    o("Glissa Sunslayer", ["G"], "Glissa Sunslayer draws, destroys an enchantment, or removes counters when it deals combat damage."),
    o("Bilious Skulldweller", ["B"], "Bilious Skulldweller has toxic and can proliferate."),
    o("Grafted Exoskeleton", [], "Grafted Exoskeleton gives a creature +2/+2 and infect."),
    o("Ichor Rats", ["B"], "Ichor Rats gives each player a poison counter when it enters."),
    o("Phyrexian Swarmlord", ["G"], "Phyrexian Swarmlord makes Insect tokens on your upkeep for each poison counter your opponents have."),
  ],
  Demon: [
    o("Liliana's Contract", ["B"], "Liliana's Contract draws two cards on your upkeep and wins if you control four Demons."),
    o("Blood Speaker", ["B"], "Blood Speaker tutors a Demon and can bring it back when a Demon dies."),
    o("Burning-Rune Demon", ["B"], "Burning-Rune Demon looks at the top of your library and gives you a Demon or a removal spell."),
    o("Shadowborn Apostle", ["B"], "A pack of Shadowborn Apostles can be sacrificed to tutor a Demon."),
    o("Harvester of Souls", ["B"], "Harvester of Souls draws a card whenever a nontoken creature dies."),
  ],
  Horror: [
    o("Toxrill, the Corrosive", ["U", "B"], "Toxrill, the Corrosive puts slime counters on creatures and makes Slug tokens when they die."),
    o("Umbris, Fear Manifest", ["U", "B"], "Umbris, Fear Manifest exiles opposing graveyards when it attacks and grows for exiled cards."),
    o("Cellar Door", [], "Cellar Door mills and makes a Horror token when a land is milled."),
    o("Nighthowler", ["B"], "Nighthowler pumps a creature for the creatures in graveyards, from the battlefield or from the graveyard."),
  ],
  Rogue: [
    o("Oona's Blackguard", ["B"], "Oona's Blackguard puts a counter on a Rogue when it enters and discards when that Rogue hits."),
    o("Thieves' Guild Enforcer", ["U", "B"], "Thieves' Guild Enforcer mills when it or another Rogue enters."),
    o("Notorious Throng", ["U"], "Notorious Throng makes a Rogue token for the damage a Rogue dealt, and prowl takes an extra turn."),
    o("Oona, Queen of the Fae", ["U", "B"], "Oona, Queen of the Fae makes Faerie Rogue tokens and exiles cards from an opponent's library."),
    o("Gonti, Lord of Luxury", ["B"], "Gonti, Lord of Luxury steals a card from an opponent's library when it enters."),
    o("Robber of the Rich", ["R"], "Robber of the Rich exiles cards from the top of a defending player's library and lets you cast them."),
  ],
  Bird: [
    o("Kangee, Sky Warden", ["W", "U"], "Kangee, Sky Warden pumps your attacking Birds and can do it from the graveyard."),
    o("Watcher of the Spheres", ["W", "U"], "Watcher of the Spheres makes flying spells cheaper and grows when one is cast."),
    o("Favorable Winds", ["U"], "Favorable Winds gives your creatures with flying +1/+1."),
    o("Soulcatchers' Aerie", ["W"], "Soulcatchers' Aerie gets a counter whenever a Bird goes to the graveyard and anthems your Birds."),
    o("Skycat Sovereign", ["W", "U"], "Skycat Sovereign grows with your flying creatures and makes Bird tokens."),
    o("Jubilant Skybonder", ["W", "U"], "Jubilant Skybonder gives your creatures with flying ward."),
  ],
  Snake: [
    o("Seshiro the Anointed", ["G"], "Seshiro the Anointed gives your other Snakes +2/+2 and draws when one deals combat damage."),
    o("Sosuke, Son of Seshiro", ["G"], "Sosuke, Son of Seshiro pumps your Snakes and Warriors and fights when one becomes targeted."),
    o("Kaseto, Orochi Archmage", ["G", "U"], "Kaseto, Orochi Archmage makes a Snake unblockable and grows it."),
    o("Orochi Hatchery", [], "Orochi Hatchery makes Snake tokens."),
  ],
  Spider: [
    o("Ishkanah, Grafwidow", ["G"], "Ishkanah, Grafwidow makes Spider tokens when it enters if you have delirium, and it can drain for your Spiders."),
    o("Shelob, Child of Ungoliant", ["G"], "Shelob, Child of Ungoliant makes a Food and a copy when a Spider you control kills a creature."),
    o("Arasta of the Endless Web", ["G"], "Arasta of the Endless Web makes a Spider token whenever an opponent casts an instant or sorcery."),
    o("Spider Spawning", ["G"], "Spider Spawning makes a Spider token for each creature card in your graveyard, and flashback does it again."),
    o("Rotwidow Pack", ["B", "G"], "Rotwidow Pack makes a Spider token when it enters and drains when Spiders die."),
  ],
  Insect: [
    o("Zask, Skittering Swarmlord", ["B", "G"], "Zask, Skittering Swarmlord returns Insects from the graveyard and grows them when a land enters."),
    o("Mazirek, Kraul Death Priest", ["B", "G"], "Mazirek, Kraul Death Priest puts counters on your creatures whenever a player sacrifices something."),
    o("Scute Swarm", ["G"], "Scute Swarm copies itself whenever a land enters, once you have enough lands."),
    o("Hornet Queen", ["G"], "Hornet Queen makes four Insect tokens with flying and deathtouch."),
    o("Giant Adephage", ["G"], "Giant Adephage copies itself when it deals combat damage."),
    o("Ant Queen", ["G"], "Ant Queen makes an Insect token and can pump your Insects."),
  ],
  Saproling: [
    o("Mycoloth", ["G"], "Mycoloth devours creatures and makes that many Saprolings on your upkeep."),
    o("Tendershoot Dryad", ["G"], "Tendershoot Dryad makes a Saproling on each upkeep and anthems them if it is your turn."),
    o("Slimefoot, the Stowaway", ["B", "G"], "Slimefoot, the Stowaway makes a Saproling for mana and drains when a Saproling dies."),
    o("Verdant Force", ["G"], "Verdant Force makes a Saproling on each upkeep."),
    o("Sporemound", ["G"], "Sporemound makes a Saproling whenever a land enters."),
    o("Fungal Sprouting", ["G"], "Fungal Sprouting makes a Saproling for each creature you control."),
    o("Utopia Mycon", ["G"], "Utopia Mycon sacrifices a Saproling for any-color mana."),
  ],
  Fungus: [
    o("Thelon of Havenwood", ["B", "G"], "Thelon of Havenwood turns spore counters into +1/+1 counters and pumps Fungi."),
    o("Sporesower Thallid", ["G"], "Sporesower Thallid puts a spore counter on each Fungus at your upkeep."),
    o("Deathbloom Thallid", ["B"], "Deathbloom Thallid makes a Saproling when it dies and propagates spore counters."),
    o("Mycoloth", ["G"], "Mycoloth devours creatures and makes that many Saprolings on your upkeep."),
    o("Utopia Mycon", ["G"], "Utopia Mycon sacrifices a Saproling for any-color mana."),
  ],
  Construct: [
    o("Steel Overseer", [], "Steel Overseer taps to put a +1/+1 counter on each artifact creature you control."),
    o("Chief of the Foundry", [], "Chief of the Foundry gives your other artifact creatures +1/+1."),
    o("Adaptive Automaton", [], "Adaptive Automaton becomes the chosen creature type and anthems it."),
  ],
  Thopter: [
    o("Sai, Master Thopterist", ["U"], "Sai, Master Thopterist makes a Thopter whenever you cast an artifact and sacrifices one to draw."),
    o("Sharding Sphinx", ["U"], "Sharding Sphinx makes two Thopters whenever an artifact creature you control deals combat damage."),
    o("Thopter Spy Network", ["U"], "Thopter Spy Network makes a Thopter on your upkeep if you control an artifact and draws when a Thopter hits."),
    o("Efficient Construction", ["U"], "Efficient Construction makes a Thopter whenever you cast an artifact."),
    o("Whirler Rogue", ["U"], "Whirler Rogue makes two Thopters and can tap two to make a creature unblockable."),
    o("Thopter Assembly", [], "Thopter Assembly makes five Thopters if you control none on your upkeep."),
  ],
  Giant: [
    o("Sunrise Sovereign", ["R"], "Sunrise Sovereign gives your Giants vigilance, trample, and haste."),
    o("Quakebringer", ["R"], "Quakebringer deals damage on your upkeep and keeps coming back if you control a Giant."),
    o("Stinkdrinker Daredevil", ["R"], "Stinkdrinker Daredevil makes your Giant spells cost less."),
    o("Borderland Behemoth", ["R"], "Borderland Behemoth's power grows with the Giants you control."),
  ],
  Minotaur: [
    o("Sethron, Hurloon General", ["B", "R"], "Sethron, Hurloon General makes a Minotaur token when it or another Minotaur enters and anthems them."),
    o("Neheb, the Worthy", ["B", "R"], "Neheb, the Worthy discards when a Minotaur deals combat damage and pumps Minotaurs in the late game."),
    o("Ragemonger", ["B", "R"], "Ragemonger makes Minotaur spells cost less."),
    o("Deathbellow War Cry", ["B", "R"], "Deathbellow War Cry searches for Minotaurs and puts them onto the battlefield."),
    o("Kragma Warcaller", ["B", "R"], "Kragma Warcaller pumps your Minotaurs on your turn and on the opponent's turn."),
  ],
};

const THEMES: ThemeDef[] = [
  {
    id: "life",
    title: "Life gain",
    summary: "Trade a card that does not spend the life you gain for one that does.",
    play: "{count} cards here already gain life. Each switch takes out a card that does not use that life and brings in one that does.",
    thread: "life gain",
    threshold: 6,
    bit: THEME_LIFE,
    avoid: "bit",
    offers: [
      o("Heliod, Sun-Crowned", ["W"], "Heliod, Sun-Crowned gives a creature lifelink and puts a +1/+1 counter on your creatures whenever you gain life."),
      o("Aetherflux Reservoir", [], "Aetherflux Reservoir deals 50 damage, but only once your life total reaches 50. It does nothing with a small life gain."),
      o("Well of Lost Dreams", [], "Well of Lost Dreams draws cards from the life you gain."),
      o("Crested Sunmare", ["W"], "Crested Sunmare makes a Horse token whenever you gain life, and those Horses are indestructible."),
      o("Felidar Sovereign", ["W"], "Felidar Sovereign wins on your upkeep at 40 life. It needs the life you already gain to actually climb that high."),
      o("Vito, Thorn of the Dusk Rose", ["B"], "Vito, Thorn of the Dusk Rose drains an opponent whenever you gain life."),
      o("Ajani's Welcome", ["W"], "Ajani's Welcome gains 1 life whenever a creature enters."),
      o("Dina, Soul Steeper", ["B", "G"], "Dina, Soul Steeper drains an opponent whenever you gain life and can sacrifice a creature to draw."),
      o("Beacon of Immortality", ["W"], "Beacon of Immortality doubles a player's life total."),
      o("Rhox Faithmender", ["W"], "Rhox Faithmender doubles the life you gain."),
      o("Test of Endurance", ["W"], "Test of Endurance wins on your upkeep at 50 life. It needs the life you already gain to actually climb that high."),
    ],
  },
  {
    id: "token",
    title: "Token makers",
    summary: "Trade a card that does not multiply tokens for one that does.",
    play: "{count} cards here already make tokens. Each switch brings in a card that makes those tokens count for more.",
    thread: "tokens",
    threshold: 8,
    bit: THEME_TOKEN,
    avoid: "bit",
    offers: [
      o("Jadar, Ghoulcaller of Nephalia", ["B"], "Jadar, Ghoulcaller of Nephalia makes a decayed Zombie token on your upkeep."),
      o("Tormod, the Desecrator", ["B"], "Tormod, the Desecrator makes a Zombie whenever one or more cards leave your graveyard."),
      o("Anointed Procession", ["W"], "Anointed Procession doubles the tokens you create."),
      o("Mondrak, Glory Dominus", ["W"], "Mondrak, Glory Dominus doubles the tokens you create and can indestructible itself."),
      o("Doubling Season", ["G"], "Doubling Season doubles tokens and counters."),
      o("Parallel Lives", ["G"], "Parallel Lives doubles the tokens you create."),
      o("Second Harvest", ["G"], "Second Harvest copies every token you control."),
      o("Primal Vigor", ["G"], "Primal Vigor doubles tokens and counters for everyone, which favors the deck making the most of them."),
      o("Queen Allenal of Ruadach", ["W"], "Queen Allenal of Ruadach adds an extra Soldier token whenever you make tokens."),
    ],
  },
  {
    id: "treasure",
    title: "Treasures",
    summary: "Trade a card that ignores Treasures for one that makes them or spends them.",
    play: "{count} cards here already care about Treasure. Each switch pushes that mana further.",
    thread: "treasures",
    threshold: 3,
    bit: THEME_TREASURE,
    avoid: "bit",
    offers: [
      o("Goldspan Dragon", ["R"], "Goldspan Dragon makes a Treasure when it enters or attacks, and your Treasures tap for two mana."),
      o("Xorn", ["R"], "Xorn makes an extra Treasure whenever you make one."),
      o("Professional Face-Breaker", ["R"], "Professional Face-Breaker makes a Treasure when your creatures hit and lets you exile cards to cast with Treasure."),
      o("Storm-Kiln Artist", ["R"], "Storm-Kiln Artist makes a Treasure whenever you cast or copy an instant or sorcery."),
      o("Magda, Brazen Outlaw", ["R"], "Magda, Brazen Outlaw makes a Treasure whenever a Dwarf taps and tutors an artifact or Dragon with five Treasures."),
      o("Tireless Provisioner", ["G"], "Tireless Provisioner makes a Treasure or a Food whenever a land enters."),
      o("Jolene, the Plunder Queen", ["R", "G"], "Jolene, the Plunder Queen makes an extra Treasure when you attack and buffs creatures when you spend Treasure."),
      o("Reckless Fireweaver", ["R"], "Reckless Fireweaver deals damage whenever an artifact enters."),
      o("Bootleggers' Stash", ["G"], "Bootleggers' Stash makes a tapped Treasure at your upkeep for each land you control."),
    ],
  },
  {
    id: "sac",
    title: "Sacrifice",
    summary: "Trade a card that does not feed the sacrifice plan for one that does.",
    play: "{count} cards here already sacrifice permanents. Each switch adds a free sacrifice outlet or a payoff for it.",
    thread: "sacrifice",
    threshold: 6,
    bit: THEME_SAC,
    avoid: "bit",
    offers: [
      o("Ashnod's Altar", [], "Ashnod's Altar sacrifices a creature for two colorless mana."),
      o("Phyrexian Altar", [], "Phyrexian Altar sacrifices a creature for one mana of any color."),
      o("Viscera Seer", ["B"], "Viscera Seer sacrifices a creature to scry 1."),
      o("Carrion Feeder", ["B"], "Carrion Feeder sacrifices a creature to put a +1/+1 counter on itself."),
      o("Mayhem Devil", ["B", "R"], "Mayhem Devil deals 1 damage whenever a player sacrifices a permanent."),
      o("Pitiless Plunderer", ["B"], "Pitiless Plunderer makes a Treasure whenever a creature you control dies."),
      o("Yawgmoth, Thran Physician", ["B"], "Yawgmoth, Thran Physician sacrifices a creature to proliferate and draw, and it puts counters on dying creatures."),
      o("Warren Soultrader", ["B"], "Warren Soultrader sacrifices a creature for a Treasure and 1 life paid."),
      o("Braids, Arisen Nightmare", ["B"], "Braids, Arisen Nightmare sacrifices a permanent and makes each opponent give one up or you draw and lose life."),
    ],
  },
  {
    id: "counter",
    title: "+1/+1 counters",
    summary: "Trade a card that does not grow counters for one that adds more of them.",
    play: "{count} cards here already use +1/+1 counters. Each switch makes those counters multiply or protects the creatures wearing them.",
    thread: "counters",
    threshold: 8,
    bit: THEME_COUNTER,
    avoid: "bit",
    offers: [
      o("Hardened Scales", ["G"], "Hardened Scales adds an extra +1/+1 counter whenever you put counters on a creature."),
      o("Branching Evolution", ["G"], "Branching Evolution doubles the +1/+1 counters you put on creatures."),
      o("The Ozolith", [], "The Ozolith keeps the counters from your creatures that die and moves them on combat."),
      o("Kami of Whispered Hopes", ["G"], "Kami of Whispered Hopes adds mana for its counters and adds an extra counter whenever you put counters on a creature."),
      o("Inspiring Call", ["G"], "Inspiring Call draws for each creature you control with a counter and gives them indestructible."),
      o("Conclave Mentor", ["G", "W"], "Conclave Mentor adds an extra +1/+1 counter and buffs creatures that have them."),
      o("Ozolith, the Shattered Spire", ["G"], "Ozolith, the Shattered Spire adds an extra counter and can move counters onto a creature."),
      o("Uncivil Unrest", ["R"], "Uncivil Unrest doubles counters you put on creatures and gives creatures with counters trample and riot damage."),
      o("Cathars' Crusade", ["W"], "Cathars' Crusade puts a +1/+1 counter on each creature you control whenever a creature enters."),
    ],
  },
  {
    id: "spell",
    title: "Spellslinger",
    summary: "Trade a card that does not care about instants and sorceries for one that does.",
    play: "{count} cards here already pay off instants and sorceries. Each switch brings in another payoff for casting them.",
    thread: "spells",
    threshold: 5,
    bit: THEME_SPELL,
    avoid: "bit",
    offers: [
      o("Young Pyromancer", ["R"], "Young Pyromancer makes a Goblin whenever you cast an instant or sorcery."),
      o("Talrand, Sky Summoner", ["U"], "Talrand, Sky Summoner makes a Drake whenever you cast an instant or sorcery."),
      o("Guttersnipe", ["R"], "Guttersnipe deals 2 damage to each opponent whenever you cast an instant or sorcery."),
      o("Archmage Emeritus", ["U"], "Archmage Emeritus draws a card whenever you cast or copy an instant or sorcery."),
      o("Storm-Kiln Artist", ["R"], "Storm-Kiln Artist makes a Treasure whenever you cast or copy an instant or sorcery, and it gets bigger."),
      o("Murmuring Mystic", ["U"], "Murmuring Mystic makes a Bird whenever you cast an instant or sorcery."),
      o("Third Path Iconoclast", ["U", "R"], "Third Path Iconoclast makes a Monk token whenever you cast a noncreature spell."),
      o("Balmor, Battlemage Captain", ["U", "R"], "Balmor, Battlemage Captain pumps your team whenever you cast an instant or sorcery and gives one trample."),
      o("Haughty Djinn", ["U"], "Haughty Djinn makes your instants and sorceries cheaper and grows with the ones in your graveyard."),
      o("Veyran, Voice of Duality", ["U", "R"], "Veyran, Voice of Duality doubles magecraft triggers and grows when you cast instants or sorceries."),
      o("Aria of Flame", ["R"], "Aria of Flame deals damage to the table whenever you cast an instant or sorcery."),
    ],
  },
  {
    id: "yard",
    title: "Graveyard",
    summary: "Trade a card that leaves the graveyard alone for one that uses it.",
    play: "{count} cards here already use the graveyard. Each switch brings in a way to fill it or to cast from it.",
    thread: "the graveyard",
    threshold: 8,
    bit: THEME_YARD,
    avoid: "bit",
    offers: [
      o("Eternal Witness", ["G"], "Eternal Witness returns a card from your graveyard to your hand."),
      o("Animate Dead", ["B"], "Animate Dead returns a creature from a graveyard straight to the battlefield."),
      o("Reanimate", ["B"], "Reanimate returns a creature from a graveyard to the battlefield for one black mana."),
      o("Living Death", ["B"], "Living Death swaps the creatures on the battlefield for the ones in graveyards."),
      o("Regrowth", ["G"], "Regrowth returns a card from your graveyard to your hand."),
      o("Ramunap Excavator", ["G"], "Ramunap Excavator lets you play lands from your graveyard."),
      o("Victimize", ["B"], "Victimize sacrifices a creature and returns two creatures from your graveyard."),
      o("Sevinne's Reclamation", ["W"], "Sevinne's Reclamation returns a small permanent from your graveyard, and flashback does it twice."),
      o("Phyrexian Reclamation", ["B"], "Phyrexian Reclamation buys a creature back from your graveyard for mana and life."),
      o("Chainer, Nightmare Adept", ["B", "R"], "Chainer, Nightmare Adept lets you cast a creature from your graveyard each turn and gives it haste."),
    ],
  },
  {
    id: "mill",
    title: "Mill",
    summary: "Trade a card that does not mill for one that mills harder.",
    play: "{count} cards here already mill. Each switch adds another way to put libraries into the graveyard.",
    thread: "mill",
    threshold: 3,
    bit: THEME_MILL,
    avoid: "bit",
    offers: [
      o("Bruvac the Grandiloquent", ["U"], "Bruvac the Grandiloquent doubles the cards an opponent mills."),
      o("Maddening Cacophony", ["U"], "Maddening Cacophony mills half of each opponent's library if you kick it."),
      o("Fraying Sanity", ["U"], "Fraying Sanity mills an opponent for the number of cards already milled this turn."),
      o("Mindcrank", [], "Mindcrank mills an opponent whenever they lose life."),
      o("Ruin Crab", ["U"], "Ruin Crab mills each opponent whenever a land enters."),
      o("Psychic Corrosion", ["U"], "Psychic Corrosion mills each opponent for two cards whenever you draw."),
      o("Mesmeric Orb", [], "Mesmeric Orb mills a card whenever a permanent becomes untapped."),
      o("Altar of the Brood", [], "Altar of the Brood mills each opponent whenever a permanent enters."),
      o("Court of Cunning", ["U"], "Court of Cunning mills an opponent on your upkeep, and it mills more if you are the monarch."),
    ],
  },
  {
    id: "land",
    title: "Landfall",
    summary: "Trade a card that does not care about lands entering for one that does.",
    play: "{count} cards here already pay off lands entering. Each switch brings in another landfall payoff.",
    thread: "lands",
    threshold: 3,
    bit: THEME_LAND,
    avoid: "bit",
    offers: [
      o("Lotus Cobra", ["G"], "Lotus Cobra adds a mana whenever a land enters."),
      o("Scute Swarm", ["G"], "Scute Swarm copies itself whenever a land enters, once you control enough lands."),
      o("Avenger of Zendikar", ["G"], "Avenger of Zendikar makes Plant tokens and puts counters on them whenever a land enters."),
      o("Tireless Provisioner", ["G"], "Tireless Provisioner makes a Food or a Treasure whenever a land enters."),
      o("Ancient Greenwarden", ["G"], "Ancient Greenwarden doubles landfall triggers and lets you play lands from your graveyard."),
      o("Tireless Tracker", ["G"], "Tireless Tracker makes a Clue whenever a land enters and grows when you crack one."),
      o("Felidar Retreat", ["W"], "Felidar Retreat makes a Cat token or puts counters on your team whenever a land enters."),
      o("Moraug, Fury of Akoum", ["R"], "Moraug, Fury of Akoum gives you extra combats after a land enters on an opponent's turn."),
      o("Tatyova, Benthic Druid", ["G", "U"], "Tatyova, Benthic Druid draws and gains life whenever a land enters."),
      o("Aesi, Tyrant of Gyre Strait", ["G", "U"], "Aesi, Tyrant of Gyre Strait lets you play an extra land and draws whenever a land enters."),
      o("Retreat to Coralhelm", ["U"], "Retreat to Coralhelm taps or untaps a creature, or mills, whenever a land enters."),
    ],
  },
  {
    id: "blink",
    title: "Blink",
    summary: "Trade a card that does not flicker permanents for one that does.",
    play: "{count} cards here already exile and return permanents. Each switch adds another blink effect so those enter triggers happen again.",
    thread: "blinking",
    threshold: 3,
    bit: THEME_BLINK,
    avoid: "bit",
    offers: [
      o("Ephemerate", ["W"], "Ephemerate blinks a creature you control and rebounds to do it again."),
      o("Teleportation Circle", ["W"], "Teleportation Circle blinks a nonland permanent at your end step."),
      o("Thassa, Deep-Dwelling", ["U"], "Thassa, Deep-Dwelling blinks a creature at your end step and makes it unblockable."),
      o("Displacer Kitten", ["U"], "Displacer Kitten blinks a nonland permanent whenever you cast a noncreature spell."),
      o("Soulherder", ["W", "U"], "Soulherder blinks a creature at your end step and grows whenever a creature is blinked."),
      o("Conjurer's Closet", [], "Conjurer's Closet blinks a creature at your end step."),
      o("Ghostly Flicker", ["U"], "Ghostly Flicker blinks two artifacts, creatures, or lands."),
      o("Restoration Angel", ["W"], "Restoration Angel blinks a non-Angel creature when it enters."),
      o("Phelia, Exuberant Shepherd", ["W"], "Phelia, Exuberant Shepherd blinks a nonland permanent of yours on attack and can exile an opposing one."),
    ],
  },
  {
    id: "draw",
    title: "Draw the table",
    summary: "Trade a card that does not draw the table in for one that does.",
    play: "{count} cards here already draw extra cards for the table. Each switch leans further into that.",
    commanderPlay: "The commander wants cards moving. Each switch takes out a card that does not draw the table in and brings in one that does.",
    thread: "drawing together",
    threshold: 3,
    bit: THEME_DRAW,
    avoid: "bit",
    offers: [
      o("Temple Bell", [], "Temple Bell lets you tap it so each player draws a card."),
      o("Dictate of Kruphix", ["U"], "Dictate of Kruphix makes each player draw an extra card on their draw step, and it has flash."),
      o("Font of Mythos", [], "Font of Mythos makes each player draw two extra cards on their draw step."),
      o("Folio of Fancies", ["U"], "Folio of Fancies mills and then draws everyone in for the cards milled this turn."),
      o("Howling Mine", [], "Howling Mine makes the player whose turn it is draw an extra card."),
      o("Anvil of Bogardan", [], "Anvil of Bogardan makes each player draw and then discard on their turn."),
      o("Teferi's Puzzle Box", [], "Teferi's Puzzle Box tucks each player's hand and replaces it, which draws the table a new hand every turn."),
      o("Well of Ideas", ["U"], "Well of Ideas draws you a card whenever an opponent draws one, on top of an extra draw for everyone."),
      o("Prosperity", ["U"], "Prosperity draws X cards for each player."),
      o("Minds Aglow", ["U"], "Minds Aglow draws each player in, and join forces lets the table pay for a bigger draw."),
    ],
  },
  {
    id: "goad",
    title: "Goad",
    summary: "Trade a card that does not point creatures away for one that goads them.",
    play: "{count} cards here already goad or force attacks. Each switch adds another way to aim creatures at someone else.",
    commanderPlay: "The commander wants opposing creatures pointed away from you. Each switch brings in another way to goad.",
    thread: "goad",
    threshold: 2,
    bit: THEME_GOAD,
    avoid: "bit",
    offers: [
      o("Disrupt Decorum", ["R"], "Disrupt Decorum goads each creature you do not control."),
      o("Shiny Impetus", ["R"], "Shiny Impetus goads a creature and makes you a Treasure when it attacks."),
      o("Agitator Ant", ["R"], "Agitator Ant goads a creature whenever one or more creatures attack."),
      o("Geode Rager", ["R"], "Geode Rager goads each creature an opponent controls when a land enters."),
      o("Bloodthirsty Blade", [], "Bloodthirsty Blade equips a creature, goads it, and buffs it, and the equip is cheap."),
      o("Life of the Party", ["R"], "Life of the Party goads itself toward opponents and pumps for each goaded creature."),
      o("Popular Entertainer", ["R"], "Popular Entertainer goads a creature whenever one of yours deals combat damage."),
      o("Taunt from the Rampart", ["W", "R"], "Taunt from the Rampart goads every creature you do not control and buffs yours."),
      o("Vengeful Ancestor", ["R"], "Vengeful Ancestor goads a creature when it enters and deals damage when a goaded creature attacks."),
    ],
  },
  {
    id: "monarch",
    title: "The monarch",
    summary: "Trade a card that ignores the monarch for one that takes it or uses it.",
    play: "{count} cards here already care about the monarch. Each switch helps you become the monarch or rewards you for keeping it.",
    commanderPlay: "The commander wants the crown. Each switch helps you take the monarch or get paid for keeping it.",
    thread: "the monarch",
    threshold: 2,
    bit: THEME_MONARCH,
    avoid: "bit",
    offers: [
      o("Court of Grace", ["W"], "Court of Grace makes an Angel or a Spirit on your upkeep, and it makes more if you are the monarch."),
      o("Court of Cunning", ["U"], "Court of Cunning mills an opponent, and it mills more if you are the monarch."),
      o("Court of Locthwain", ["B"], "Court of Locthwain draws or drains if you are the monarch."),
      o("Court of Ire", ["R"], "Court of Ire deals damage to an opponent if you are the monarch."),
      o("Court of Bounty", ["G"], "Court of Bounty puts a permanent onto the battlefield if you are the monarch."),
      o("Emberwilde Captain", ["R"], "Emberwilde Captain makes you the monarch when it deals combat damage."),
      o("Skyline Despot", ["R"], "Skyline Despot makes you the monarch and makes a Dragon token on your upkeep if you still are."),
      o("Custodi Lich", ["B"], "Custodi Lich makes you the monarch and returns itself when you lose the crown."),
      o("Palace Jailer", ["W"], "Palace Jailer makes you the monarch and exiles a creature until you are not."),
      o("Protector of the Crown", ["W"], "Protector of the Crown makes you the monarch and protects you while you are."),
      o("Archon of Coronation", ["W"], "Archon of Coronation makes you the monarch and gives your spells flying protection while you are."),
    ],
  },
  {
    id: "wheel",
    title: "Wheels",
    summary: "Trade a card that does not refill hands for a wheel.",
    play: "{count} cards here already make players discard and draw. Each switch adds another wheel.",
    thread: "wheels",
    threshold: 2,
    bit: THEME_WHEEL,
    avoid: "bit",
    offers: [
      o("Windfall", ["R"], "Windfall makes each player discard their hand and draw that many cards."),
      o("Wheel of Fortune", ["R"], "Wheel of Fortune makes each player discard their hand and draw seven."),
      o("Magus of the Wheel", ["R"], "Magus of the Wheel is a creature that wheels the table."),
      o("Wheel of Misfortune", ["R"], "Wheel of Misfortune makes each player bid life, then the losers draw seven and discard."),
      o("Reforge the Soul", ["R"], "Reforge the Soul wheels the table, and miracle makes it cheap."),
      o("Whispering Madness", ["U"], "Whispering Madness wheels the table and ciphers onto a creature so it can happen again."),
      o("Dark Deal", ["B"], "Dark Deal makes each player discard their hand and draw one less than they discarded."),
      o("Echo of Eons", ["U"], "Echo of Eons shuffles graveyards and hands back in and draws seven, and flashback does it from the graveyard."),
    ],
  },
  {
    id: "donate",
    title: "Give them away",
    summary: "Trade a card that never changes hands for one you can give away.",
    play: "{count} cards here already hand permanents to someone else. Each switch brings in a gift, or a cleaner way to give one.",
    commanderPlay: "The commander wants a permanent to change hands. Each switch takes out a card that does not do that and brings in one you can give away.",
    thread: "giving cards away",
    threshold: 2,
    bit: THEME_DONATE,
    avoid: "bit",
    offers: [
      o("Harmless Offering", ["R"], "Harmless Offering gives an opponent a permanent you control. You choose the gift."),
      o("Bazaar Trader", ["R"], "Bazaar Trader taps to give a permanent you control to another player."),
      o("Wrong Turn", ["U"], "Wrong Turn gives a creature to another player. It is a cheap way to move something."),
      o("Akroan Horse", [], "Akroan Horse enters under an opponent's control and makes you a Soldier on their upkeep."),
      o("Illusions of Grandeur", ["U"], "Illusions of Grandeur gains a pile of life, and the player who controls it loses that life when it leaves. Give it away after the life."),
      o("Nine Lives", ["W"], "Nine Lives prevents the next nine damage dealt to you, then you lose the game. An opponent can hold it instead."),
      o("Puca's Mischief", ["U"], "Puca's Mischief trades a permanent you control for one an opponent controls with a lower mana value."),
      o("Role Reversal", ["U", "R"], "Role Reversal swaps control of two permanents and two cards in hand."),
      o("Humble Defector", ["R"], "Humble Defector draws two cards and then goes to an opponent. They will want to give it back."),
      o("Transcendence", ["W"], "Transcendence makes its controller lose if they have 20 or more life. That is a gift, once your own life is planned for."),
      o("Statecraft", ["W"], "Statecraft stops creatures you control from dealing damage, which is useful on the turn you give them away."),
      o("Steel Golem", [], "Steel Golem stops its controller from casting creature spells. Hand it over."),
      o("Grid Monitor", [], "Grid Monitor stops its controller from casting creature spells. It is another gift they do not want."),
      o("Aggressive Mining", ["R"], "Aggressive Mining lets its controller sacrifice lands to draw, which most opponents will not enjoy."),
      o("Xantcha, Sleeper Agent", ["B", "R"], "Xantcha, Sleeper Agent enters under an opponent's control, draws you cards, and can be pointed at them."),
    ],
  },
  {
    id: "death",
    title: "When creatures die",
    summary: "Trade a card that ignores deaths for one that gets paid when creatures die.",
    play: "{count} cards here already care when a creature dies. Each switch adds another payoff for that.",
    thread: "creature deaths",
    threshold: 3,
    bit: THEME_DEATH,
    avoid: "bit",
    offers: [
      o("Blood Artist", ["B"], "Blood Artist drains an opponent whenever a creature dies."),
      o("Zulaport Cutthroat", ["B"], "Zulaport Cutthroat drains each opponent whenever a creature you control dies."),
      o("Cruel Celebrant", ["W", "B"], "Cruel Celebrant drains an opponent whenever a creature you control dies."),
      o("Bastion of Remembrance", ["B"], "Bastion of Remembrance drains an opponent whenever a creature you control dies and makes a token when it enters."),
      o("Syr Konrad, the Grim", ["B"], "Syr Konrad, the Grim deals damage whenever a creature dies or leaves a graveyard."),
      o("Poison-Tip Archer", ["B", "G"], "Poison-Tip Archer drains an opponent whenever a creature dies and has reach and deathtouch."),
      o("Morbid Opportunist", ["B"], "Morbid Opportunist draws a card the first time a creature dies each turn."),
      o("Elas il-Kor, Sadistic Pilgrim", ["W", "B"], "Elas il-Kor, Sadistic Pilgrim gains life when a creature enters and drains when one dies."),
      o("The Meathook Massacre", ["B"], "The Meathook Massacre wipes small creatures and drains whenever a creature dies."),
    ],
  },
  {
    id: "poison",
    title: "Poison",
    summary: "Trade a card that does not poison for one that does.",
    play: "{count} cards here already give poison or infect. Each switch adds another way to get opponents to ten poison.",
    commanderPlay: "The commander is already a poison card. Each switch adds another way to get opponents to ten poison.",
    thread: "poison",
    threshold: 2,
    bit: THEME_POISON,
    avoid: "bit",
    offers: [
      o("Triumph of the Hordes", ["G"], "Triumph of the Hordes gives your team trample and infect for one attack."),
      o("Fynn, the Fangbearer", ["G"], "Fynn, the Fangbearer gives two poison whenever a deathtouch creature hits a player."),
      o("Venerated Rotpriest", ["G"], "Venerated Rotpriest gives an opponent a poison counter whenever a creature you control becomes the target of a spell."),
      o("Prologue to Phyresis", ["U"], "Prologue to Phyresis gives an opponent a poison counter and proliferates."),
      o("Infectious Inquiry", ["B"], "Infectious Inquiry draws two cards and gives each opponent a poison counter."),
      o("Ichor Rats", ["B"], "Ichor Rats gives each player a poison counter when it enters and has infect."),
      o("Necrogen Rotpriest", ["B", "G"], "Necrogen Rotpriest gives an opponent a poison counter whenever a creature you control is sacrificed."),
      o("Skrelv's Hive", ["W"], "Skrelv's Hive makes a toxic Mite token on your upkeep."),
      o("Phyresis Outbreak", ["B"], "Phyresis Outbreak gives each creature a poison counter and drains its controller."),
    ],
  },
  {
    id: "energy",
    title: "Energy",
    summary: "Trade a card that does not use energy for one that makes it or spends it.",
    play: "{count} cards here already use energy counters. Each switch adds another energy card so the counters add up.",
    thread: "energy",
    threshold: 3,
    bit: THEME_ENERGY,
    avoid: "bit",
    offers: [
      o("Aetherworks Marvel", [], "Aetherworks Marvel makes energy when an artifact enters and spends six to cast a card from the top of your library."),
      o("Aether Hub", [], "Aether Hub taps for colorless or spends energy for one mana of any color, and it starts you with energy."),
      o("Decoction Module", [], "Decoction Module makes energy when a creature enters and can bounce a creature."),
      o("Fabrication Module", [], "Fabrication Module puts a counter on a creature whenever you get energy, and it makes energy itself."),
      o("Whirler Virtuoso", ["U", "R"], "Whirler Virtuoso spends energy to make a Thopter."),
      o("Aethertorch Renegade", ["R"], "Aethertorch Renegade makes energy when it enters and when you cast spells, and it spends energy to deal damage."),
      o("Gonti's Aether Heart", [], "Gonti's Aether Heart makes energy when an artifact enters and spends eight for an extra turn."),
      o("Dynavolt Tower", [], "Dynavolt Tower makes energy when you cast an instant or sorcery and spends it to deal damage."),
      o("Architect of the Untamed", ["G"], "Architect of the Untamed makes energy on landfall and spends it to make a Beast."),
    ],
  },
  {
    id: "food",
    title: "Food",
    summary: "Trade a card that ignores Food for one that makes it or spends it.",
    play: "{count} cards here already use Food. Each switch brings in another Food payoff.",
    thread: "Food",
    threshold: 3,
    bit: THEME_FOOD,
    avoid: "bit",
    offers: [
      o("Academy Manufactor", [], "Academy Manufactor turns a Clue, Food, or Treasure into one of each."),
      o("Night of the Sweets' Revenge", ["G"], "Night of the Sweets' Revenge taps Foods for mana and can turn them into a huge attack."),
      o("Peregrin Took", ["G"], "Peregrin Took makes an extra Food whenever you make a token and can sacrifice Foods to draw."),
      o("Samwise Gamgee", ["W", "G"], "Samwise Gamgee makes a Food when a nontoken creature enters and can bring a historic card back with Foods."),
      o("Gyome, Master Chef", ["B", "G"], "Gyome, Master Chef makes a Food on attack and taps Foods to protect creatures."),
      o("Savvy Hunter", ["B", "G"], "Savvy Hunter makes a Food when it attacks and sacrifices Foods to draw."),
      o("The Underworld Cookbook", [], "The Underworld Cookbook makes a Food and discards, which is a way to fill the graveyard and the board."),
      o("Trail of Crumbs", ["G"], "Trail of Crumbs draws a card whenever you sacrifice a Food."),
    ],
  },
  {
    id: "clue",
    title: "Clues",
    summary: "Trade a card that ignores Clues for one that makes them or draws from them.",
    play: "{count} cards here already use Clues. Each switch brings in another investigate payoff.",
    thread: "Clues",
    threshold: 3,
    bit: THEME_CLUE,
    avoid: "bit",
    offers: [
      o("Tireless Tracker", ["G"], "Tireless Tracker makes a Clue whenever a land enters and grows when you crack one."),
      o("Lonis, Cryptozoologist", ["G", "U"], "Lonis, Cryptozoologist makes a Clue whenever a nontoken creature enters and can trade Clues for exiled cards."),
      o("Academy Manufactor", [], "Academy Manufactor turns a Clue, Food, or Treasure into one of each."),
      o("Knowledge Is Power", ["W", "U"], "Knowledge Is Power pumps a creature for the cards in your hand, which Clues refill."),
      o("Thorough Investigation", ["W"], "Thorough Investigation makes a Clue on your upkeep and whenever you attack."),
      o("Ulvenwald Mysteries", ["G"], "Ulvenwald Mysteries makes a Clue when a creature dies and a Soldier when you sacrifice a Clue."),
      o("Confirm Suspicions", ["U"], "Confirm Suspicions counters a spell and makes three Clues."),
      o("Ongoing Investigation", ["G", "U"], "Ongoing Investigation makes Clues when you attack and when a creature dies after you paid mana."),
    ],
  },
  {
    id: "combat",
    title: "Extra combats",
    summary: "Trade a card that does not add a combat for one that does.",
    play: "{count} cards here already add combat steps. Each switch brings in another way to take an extra combat.",
    commanderPlay: "The commander already takes extra combats. Each switch brings in another way to do that again.",
    thread: "extra combats",
    threshold: 1,
    bit: THEME_COMBAT,
    avoid: "bit",
    offers: [
      o("Aggravated Assault", ["R"], "Aggravated Assault untaps your creatures and gives you another combat for five mana."),
      o("Combat Celebrant", ["R"], "Combat Celebrant exerts to untap your creatures and give you another combat."),
      o("Hellkite Charger", ["R"], "Hellkite Charger offers another combat whenever it attacks, if you pay or sacrifice a Treasure."),
      o("Savage Beating", ["R"], "Savage Beating gives double strike, an extra combat, or both if you entwine it."),
      o("Relentless Assault", ["R"], "Relentless Assault untaps your attackers and gives you another combat."),
      o("Waves of Aggression", ["R"], "Waves of Aggression gives an extra combat, and raid makes the flashback cheap."),
      o("Seize the Day", ["R"], "Seize the Day untaps a creature and gives an extra combat, and flashback does it again."),
      o("Aurelia, the Warleader", ["R", "W"], "Aurelia, the Warleader untaps your attackers and gives you another combat the first time she attacks."),
      o("Karlach, Fury of Avernus", ["R"], "Karlach, Fury of Avernus gives you an extra combat on each of your turns and gives attacking creatures first strike then haste."),
      o("Scourge of the Throne", ["R"], "Scourge of the Throne gives an extra combat when it attacks the player with the most life."),
    ],
  },
  {
    id: "copy",
    title: "Copy spells",
    summary: "Trade a card that does not copy spells for one that does.",
    play: "{count} cards here already copy spells. Each switch adds another copy effect.",
    thread: "copying spells",
    threshold: 2,
    bit: THEME_COPY,
    avoid: "bit",
    offers: [
      o("Swarm Intelligence", ["U"], "Swarm Intelligence copies the first instant or sorcery you cast each turn."),
      o("Double Vision", ["R"], "Double Vision copies the first instant or sorcery you cast on your turn."),
      o("Twinning Staff", [], "Twinning Staff copies a spell or an ability that copies a spell, and it adds an extra copy."),
      o("Thousand-Year Storm", ["U", "R"], "Thousand-Year Storm copies your instants and sorceries once for each one you have cast this turn."),
      o("Dualcaster Mage", ["R"], "Dualcaster Mage copies a spell when it enters."),
      o("Naru Meha, Master Wizard", ["U"], "Naru Meha, Master Wizard copies an instant or sorcery when it enters and pumps your Wizards."),
      o("Increasing Vengeance", ["R"], "Increasing Vengeance copies a spell, and from the graveyard it makes two copies."),
      o("Reverberate", ["R"], "Reverberate copies an instant or sorcery."),
      o("Twincast", ["U"], "Twincast copies an instant or sorcery."),
    ],
  },
  {
    id: "modified",
    title: "Modified",
    summary: "Trade a card that does not modify creatures for one that rewards it.",
    play: "{count} cards here already care about modified creatures. Each switch brings in another payoff for equipped, enchanted, or countered creatures.",
    thread: "modified creatures",
    threshold: 3,
    bit: THEME_MODIFIED,
    avoid: "bit",
    offers: [
      o("Kodama of the West Tree", ["G"], "Kodama of the West Tree ramps whenever a modified creature deals combat damage and gives them trample."),
      o("Unnatural Growth", ["G"], "Unnatural Growth doubles the power and toughness of your creatures on each combat."),
      o("Invigorating Hot Spring", ["R"], "Invigorating Hot Spring puts a counter on a creature when it enters or attacks, which modifies it."),
      o("Chishiro, the Shattered Blade", ["R", "G"], "Chishiro, the Shattered Blade makes a Spirit when you modify a creature and puts counters on your modified creatures."),
      o("Akki Battle Squad", ["R"], "Akki Battle Squad lets a modified creature attack again whenever it attacks alone."),
      o("All Will Be One", ["R"], "All Will Be One deals damage whenever you put counters on a permanent or a player."),
    ],
  },
  {
    id: "crime",
    title: "Crimes",
    summary: "Trade a card that does not commit crimes for one that pays you for them.",
    play: "{count} cards here already commit crimes or pay off crimes. Each switch adds another crime payoff.",
    thread: "crimes",
    threshold: 3,
    bit: THEME_CRIME,
    avoid: "bit",
    offers: [
      o("Gisa, the Hellraiser", ["B"], "Gisa, the Hellraiser makes Zombies when you commit a crime and buffs them."),
      o("Marchesa, Dealer of Death", ["U", "B", "R"], "Marchesa, Dealer of Death surveils and recurs a cheap spell whenever you commit a crime."),
      o("Magda, the Hoardmaster", ["R"], "Magda, the Hoardmaster makes a Treasure when you commit a crime on an opponent's turn and can turn Treasures into a Dragon."),
      o("Forsaken Miner", ["B"], "Forsaken Miner comes back from the graveyard when you commit a crime."),
      o("Deepmuck Desperado", ["U"], "Deepmuck Desperado draws when it enters if you committed a crime this turn, and it commits one itself."),
      o("Hardbristle Bandit", ["G"], "Hardbristle Bandit ramps or fights when it enters if you committed a crime."),
      o("Crime Novelist", ["R"], "Crime Novelist makes a Treasure and gets +1/+1 whenever you sacrifice an artifact."),
      o("Kaervek, the Punisher", ["B"], "Kaervek, the Punisher casts a crime spell from your graveyard whenever you commit a crime."),
    ],
  },
  {
    id: "plot",
    title: "Plot",
    summary: "Trade a card that does not use plot for one that does.",
    play: "{count} cards here already plot. Each switch brings in another plot payoff so those delayed spells are worth the wait.",
    thread: "plot",
    threshold: 3,
    bit: THEME_PLOT,
    avoid: "bit",
    offers: [
      o("Doc Aurlock, Grizzled Genius", ["G", "U"], "Doc Aurlock, Grizzled Genius makes plotted spells and foretold spells cheaper."),
      o("Slickshot Show-Off", ["R"], "Slickshot Show-Off plots for cheap and gives your next spell a damage bonus."),
      o("Outcaster Trailblazer", ["G"], "Outcaster Trailblazer ramps when it enters and draws when you cast a plotted spell."),
      o("Return the Favor", ["R"], "Return the Favor copies a spell or redirects it, and spree lets you do both."),
      o("Honest Rutstein", ["B", "G"], "Honest Rutstein makes creature spells cheaper and returns a creature when it enters."),
      o("Fblthp, Lost on the Range", ["U"], "Fblthp, Lost on the Range lets you plot the top card of your library if it is a spell."),
      o("Kellan, the Kid", ["G", "W", "U"], "Kellan, the Kid puts a permanent onto the battlefield when you cast a spell from anywhere but your hand."),
      o("Smuggler's Surprise", ["G"], "Smuggler's Surprise protects creatures, cheats them in, or draws, and it is a plot spell."),
    ],
  },
  {
    id: "cascade",
    title: "Cascade",
    summary: "Trade a card that does not cascade for one that does.",
    play: "{count} cards here already cascade. Each switch adds another cascade spell so the chain keeps going.",
    commanderPlay: "The commander already cascades. Each switch adds another cascade spell so the chain keeps going.",
    thread: "cascade",
    threshold: 3,
    bit: THEME_CASCADE,
    avoid: "bit",
    offers: [
      o("Apex Devastator", ["G"], "Apex Devastator cascades four times."),
      o("Imoti, Celebrant of Bounty", ["G", "U"], "Imoti, Celebrant of Bounty gives your big spells cascade."),
      o("Wild-Magic Sorcerer", ["R"], "Wild-Magic Sorcerer cascades a smaller spell the first time you cast a spell each turn."),
      o("Averna, the Chaos Bloom", ["R", "G"], "Averna, the Chaos Bloom puts the land you hit while cascading onto the battlefield."),
      o("Throes of Chaos", ["R"], "Throes of Chaos cascades and rebounds."),
      o("Bloodbraid Elf", ["R", "G"], "Bloodbraid Elf cascades when you cast it and has haste."),
      o("Shardless Agent", ["G", "U"], "Shardless Agent cascades when you cast it."),
      o("Etherium-Horn Sorcerer", ["U", "R"], "Etherium-Horn Sorcerer cascades when you cast it."),
      o("Call Forth the Tempest", ["R"], "Call Forth the Tempest cascades and deals damage for the mana values of the spells you cascaded into."),
    ],
  },
  {
    id: "storm",
    title: "Storm",
    summary: "Trade a card that does not grow with storm for one that does.",
    play: "{count} cards here already use storm. Each switch adds a payoff that copies itself for the spells you cast this turn.",
    commanderPlay: "The commander already counts storm. Each switch adds a payoff that copies itself for the spells you cast.",
    thread: "storm",
    threshold: 2,
    bit: THEME_STORM,
    avoid: "bit",
    offers: [
      o("Grapeshot", ["R"], "Grapeshot deals 1 damage, then copies itself for each other spell you cast this turn."),
      o("Empty the Warrens", ["R"], "Empty the Warrens makes Goblins, then more for each other spell you cast this turn."),
      o("Brain Freeze", ["U"], "Brain Freeze mills, then mills again for each other spell you cast this turn."),
      o("Tendrils of Agony", ["B"], "Tendrils of Agony drains, then copies itself for each other spell you cast this turn."),
      o("Storm-Kiln Artist", ["R"], "Storm-Kiln Artist makes a Treasure whenever you cast or copy a spell and grows with storm."),
      o("Runaway Steam-Kin", ["R"], "Runaway Steam-Kin gets a counter whenever you cast a red spell and spends three counters for three red mana."),
      o("Goblin Electromancer", ["U", "R"], "Goblin Electromancer makes your instants and sorceries cost less, which is how a storm turn starts."),
      o("Past in Flames", ["R"], "Past in Flames casts instants and sorceries from your graveyard, and flashback does it again."),
      o("Sentinel Tower", [], "Sentinel Tower deals damage whenever you cast a spell, equal to the number of spells you have cast this turn."),
    ],
  },
  {
    id: "mutate",
    title: "Mutate",
    summary: "Trade a card that does not mutate for one that does.",
    play: "{count} cards here already mutate. Each switch adds another mutate creature so the pile gets another trigger.",
    commanderPlay: "The commander already mutates. Each switch adds another mutate creature so the pile gets another trigger.",
    thread: "mutate",
    threshold: 3,
    bit: THEME_MUTATE,
    avoid: "bit",
    offers: [
      o("Auspicious Starrix", ["G"], "Auspicious Starrix puts a permanent from the top of your library onto the battlefield whenever it mutates."),
      o("Migratory Greathorn", ["G"], "Migratory Greathorn ramps whenever it mutates."),
      o("Gemrazer", ["G"], "Gemrazer destroys an artifact or enchantment whenever it mutates and gives the pile trample and reach."),
      o("Sawtusk Demolisher", ["G"], "Sawtusk Demolisher destroys an artifact or enchantment whenever it mutates."),
      o("Illuna, Apex of Wishes", ["U", "R", "G"], "Illuna, Apex of Wishes exiles cards and puts a permanent onto the battlefield whenever it mutates."),
      o("Parcelbeast", ["G", "U"], "Parcelbeast draws and ramps whenever it mutates."),
      o("Sea-Dasher Octopus", ["U"], "Sea-Dasher Octopus draws when the pile deals combat damage and flashes in."),
      o("Boneyard Lurker", ["W", "B"], "Boneyard Lurker returns a permanent card from your graveyard whenever it mutates."),
      o("Lore Drakkis", ["U", "R"], "Lore Drakkis returns an instant or sorcery from your graveyard whenever it mutates."),
    ],
  },
  {
    id: "ninja",
    title: "Ninjutsu",
    summary: "Trade a card that does not ninjutsu for one that does.",
    play: "{count} cards here already use ninjutsu. Each switch adds another Ninja so combat damage keeps replacing attackers.",
    commanderPlay: "The commander already wants Ninjas. Each switch adds another Ninja so a hit can replace the attacker.",
    thread: "ninjutsu",
    threshold: 3,
    bit: THEME_NINJA,
    avoid: "bit",
    offers: [
      o("Silver-Fur Master", ["U", "B"], "Silver-Fur Master makes Ninjutsu and Ninja spells cheaper and pumps your Ninjas and Rogues."),
      o("Moon-Circuit Hacker", ["U"], "Moon-Circuit Hacker draws when it deals combat damage and reduces the cost of the next ninjutsu."),
      o("Ingenious Infiltrator", ["U", "B"], "Ingenious Infiltrator draws and drains whenever a Ninja you control deals combat damage."),
      o("Satoru Umezawa", ["U", "B"], "Satoru Umezawa gives your unblocked attackers ninjutsu and draws when a creature enters that way."),
      o("Thousand-Faced Shadow", ["U"], "Thousand-Faced Shadow copies an attacking creature when it ninjutsus in, once you have enough attackers."),
      o("Ninja of the Deep Hours", ["U"], "Ninja of the Deep Hours draws a card when it deals combat damage."),
      o("Ink-Eyes, Servant of Oni", ["B"], "Ink-Eyes, Servant of Oni returns a creature from an opponent's graveyard when it deals combat damage."),
      o("Prosperous Thief", ["U"], "Prosperous Thief makes a Treasure when a Ninja or Rogue deals combat damage."),
      o("Satoru, the Infiltrator", ["U", "B"], "Satoru, the Infiltrator draws whenever a creature enters without being cast or whenever you ninjutsu."),
    ],
  },
  {
    id: "alliance",
    title: "Alliance",
    summary: "Trade a card that ignores alliance for one that pays off creatures entering together.",
    play: "{count} cards here already have alliance. Each switch adds another payoff for the second creature that enters on a turn.",
    thread: "alliance",
    threshold: 3,
    bit: THEME_ALLIANCE,
    avoid: "bit",
    offers: [
      o("Devilish Valet", ["R"], "Devilish Valet doubles its power whenever another creature enters."),
      o("Queen Allenal of Ruadach", ["W"], "Queen Allenal of Ruadach adds a Soldier whenever you create tokens."),
      o("Squee, Dubious Monarch", ["R"], "Squee, Dubious Monarch makes Goblins on attack and comes back from the graveyard with alliance."),
      o("Lagomos, Hand of Hatred", ["B", "R"], "Lagomos, Hand of Hatred makes a token on attack and sacrifices a creature to draw when another creature enters."),
      o("General Ferrous Rokiric", ["R", "W"], "General Ferrous Rokiric makes a Golem whenever you cast a multicolored spell."),
      o("Ognis, the Dragon's Lash", ["R", "G"], "Ognis, the Dragon's Lash makes a Treasure whenever a hasty creature attacks."),
      o("Baird, Argivian Recruiter", ["W"], "Baird, Argivian Recruiter makes a Soldier when it enters and whenever another creature enters on a later turn."),
      o("Jinnie Fay, Jetmir's Second", ["R", "G", "W"], "Jinnie Fay, Jetmir's Second lets your tokens enter as Cats or Dogs."),
    ],
  },
  {
    id: "descend",
    title: "Descend",
    summary: "Trade a card that ignores descend for one that fills the graveyard or pays off descend.",
    play: "{count} cards here already descend. Each switch adds a card that wants a full graveyard.",
    thread: "descend",
    threshold: 3,
    bit: THEME_DESCEND,
    avoid: "bit",
    offers: [
      o("The Mycotyrant", ["B", "G"], "The Mycotyrant makes a Saproling for your descend and grows for the creatures in your graveyard."),
      o("The Ancient One", ["U", "B"], "The Ancient One is a huge creature that costs less once you have descended."),
      o("Akawalli, the Seething Tower", ["B", "G"], "Akawalli, the Seething Tower grows and comes back once you have descended enough."),
      o("Souls of the Lost", ["B"], "Souls of the Lost's power and toughness grow with the permanents in your graveyard."),
      o("Starving Revenant", ["B"], "Starving Revenant draws and drains, and descend makes the life loss smaller."),
      o("Squirming Emergence", ["B", "G"], "Squirming Emergence puts a creature from your graveyard onto the battlefield if you have descended enough."),
      o("Abuelo's Awakening", ["W"], "Abuelo's Awakening returns an artifact or a big creature from your graveyard as a Spirit."),
      o("Deep-Cavern Bat", ["B"], "Deep-Cavern Bat takes a card from an opponent's hand until it leaves."),
    ],
  },
  {
    id: "aura",
    title: "Auras",
    summary: "Trade a card that is not an Aura payoff for one that draws or protects your Auras.",
    play: "{count} Auras are already in this list. Each switch brings in a card that draws from them or makes them hit harder.",
    thread: "auras",
    threshold: 6,
    avoid: "aura",
    offers: [
      o("Sram, Senior Edificer", ["W"], "Sram, Senior Edificer draws a card whenever you cast an Aura, Equipment, or Vehicle."),
      o("Kor Spiritdancer", ["W"], "Kor Spiritdancer draws a card whenever you cast an Aura and gets bigger for each Aura on it."),
      o("Light-Paws, Emperor's Voice", ["W"], "Light-Paws, Emperor's Voice tutors an Aura whenever you cast an Aura."),
      o("Ethereal Armor", ["W"], "Ethereal Armor pumps a creature for each enchantment you control and gives it first strike."),
      o("All That Glitters", ["W"], "All That Glitters pumps a creature for each artifact and enchantment you control."),
      o("Sage's Reverie", ["W"], "Sage's Reverie draws a card for each Aura you control when it enters and pumps the enchanted creature."),
      o("Mantle of the Ancients", ["W"], "Mantle of the Ancients returns every Aura and Equipment from your graveyard onto the enchanted creature."),
      o("Ancestral Mask", ["G"], "Ancestral Mask pumps a creature for each enchantment you control."),
      o("Daybreak Coronet", ["W"], "Daybreak Coronet is a huge Aura as long as the creature is already enchanted."),
    ],
  },
  {
    id: "equipment",
    title: "Equipment",
    summary: "Trade a card that does not help Equipment for one that tutors or swings with it.",
    play: "{count} Equipment cards are already in this list. Each switch brings in a card that finds them or attaches them for free.",
    thread: "equipment",
    threshold: 4,
    avoid: "equipment",
    offers: [
      o("Sigarda's Aid", ["W"], "Sigarda's Aid gives Equipment flash and attaches it for free when it enters."),
      o("Puresteel Paladin", ["W"], "Puresteel Paladin draws when you cast an Equipment and attaches your Equipment for free once you have enough."),
      o("Stoneforge Mystic", ["W"], "Stoneforge Mystic tutors an Equipment and can put it onto the battlefield attached."),
      o("Hammer of Nazahn", [], "Hammer of Nazahn attaches itself and your other Equipment for free and gives indestructible."),
      o("Brass Squire", [], "Brass Squire taps to attach an Equipment for free."),
      o("Fighter Class", ["W"], "Fighter Class tutors an Equipment and makes equipping cheaper."),
      o("Ardenn, Intrepid Archaeologist", ["W"], "Ardenn, Intrepid Archaeologist attaches every Aura and Equipment you control when it attacks."),
      o("Koll, the Forgemaster", ["R", "W"], "Koll, the Forgemaster returns equipped or enchanted creatures from the graveyard and buffs them."),
      o("Armored Skyhunter", ["W"], "Armored Skyhunter searches out an Equipment whenever it deals combat damage."),
      o("Stonehewer Giant", ["W"], "Stonehewer Giant tutors an Equipment and attaches it whenever it attacks."),
    ],
  },
  {
    id: "enchant",
    title: "Enchantments",
    summary: "Trade a card that does not draw from enchantments for one that does.",
    play: "{count} enchantments are already in this list. Each switch brings in a card that draws when you cast another one.",
    thread: "enchantments",
    threshold: 12,
    avoid: "enchant",
    offers: [
      o("Enchantress's Presence", ["G"], "Enchantress's Presence draws a card whenever you cast an enchantment."),
      o("Eidolon of Blossoms", ["G"], "Eidolon of Blossoms draws a card whenever you cast an enchantment."),
      o("Setessan Champion", ["G"], "Setessan Champion draws a card and gets a counter whenever you cast an enchantment."),
      o("Sythis, Harvest's Hand", ["G", "W"], "Sythis, Harvest's Hand gains life and draws whenever you cast an enchantment."),
      o("Argothian Enchantress", ["G"], "Argothian Enchantress draws a card whenever you cast an enchantment and has shroud."),
      o("Mesa Enchantress", ["W"], "Mesa Enchantress draws a card whenever you cast an enchantment."),
      o("Verduran Enchantress", ["G"], "Verduran Enchantress draws a card whenever you cast an enchantment."),
      o("Sterling Grove", ["G", "W"], "Sterling Grove tutors an enchantment and gives your enchantments shroud."),
      o("Satyr Enchanter", ["G"], "Satyr Enchanter draws a card whenever you cast an enchantment."),
      o("Verity Circle", ["U"], "Verity Circle taps a creature an opponent controls or draws for each tapped creature they control."),
    ],
  },
  {
    id: "artifact",
    title: "Artifacts",
    summary: "Trade a card that ignores your artifacts for one that pays them off.",
    play: "{count} artifacts are already in this list. Each switch brings in a card that draws, untaps, or cheats them in.",
    thread: "artifacts",
    threshold: 16,
    avoid: "artifact",
    offers: [
      o("Sai, Master Thopterist", ["U"], "Sai, Master Thopterist makes a Thopter whenever you cast an artifact and sacrifices one to draw."),
      o("Emry, Lurker of the Loch", ["U"], "Emry, Lurker of the Loch mills and casts artifacts from your graveyard, and it costs less if you have artifacts."),
      o("Urza, Lord High Artificer", ["U"], "Urza, Lord High Artificer taps your artifacts for blue mana, makes a Construct, and casts the top of your library."),
      o("Jhoira, Weatherlight Captain", ["U", "R"], "Jhoira, Weatherlight Captain draws a card whenever you cast a historic spell."),
      o("Unwinding Clock", [], "Unwinding Clock untaps your artifacts on each opponent's untap step."),
      o("Padeem, Consul of Innovation", ["U"], "Padeem, Consul of Innovation draws when you control the biggest artifact and gives your artifacts hexproof."),
      o("Mystic Forge", [], "Mystic Forge lets you look at and cast the top of your library if it is an artifact or a colorless card."),
      o("Thought Monitor", ["U"], "Thought Monitor draws two cards and affinity for artifacts makes it cheap."),
      o("Whir of Invention", ["U"], "Whir of Invention tutors an artifact and puts it onto the battlefield, and improvise taps your artifacts."),
      o("Etherium Sculptor", ["U"], "Etherium Sculptor makes your artifact spells cost less."),
    ],
  },
  {
    id: "vehicle",
    title: "Vehicles",
    summary: "Trade a card that does not crew or cheat Vehicles for one that does.",
    play: "{count} Vehicles are already in this list. Each switch brings in a pilot payoff or a way to crew them.",
    thread: "Vehicles",
    threshold: 3,
    avoid: "vehicle",
    offers: [
      o("Greasefang, Okiba Boss", ["W", "B"], "Greasefang, Okiba Boss returns a Vehicle from your graveyard when it attacks and gives it haste."),
      o("Depala, Pilot Exemplar", ["R", "W"], "Depala, Pilot Exemplar pumps Dwarves and Vehicles and looks at the top of your library for more when it attacks."),
      o("Kotori, Pilot Prodigy", ["W", "U"], "Kotori, Pilot Prodigy crews Vehicles by tapping herself and untaps them after combat."),
      o("Mobilizer Mech", [], "Mobilizer Mech crews Vehicles for free when it attacks."),
      o("Peacewalker Colossus", [], "Peacewalker Colossus animates a Vehicle for mana and animates itself when a Vehicle attacks."),
      o("Parhelion II", ["W"], "Parhelion II crews into a flying vigilant attacker that makes Angel tokens when it hits."),
      o("Unlicensed Hearse", ["B"], "Unlicensed Hearse exiles graveyards and becomes a huge attacker."),
      o("Veteran Motorist", ["R", "W"], "Veteran Motorist scryes when it crews a Vehicle and pumps the team."),
      o("Toolcraft Exemplar", ["W"], "Toolcraft Exemplar gets bigger and first strike when you control an artifact."),
    ],
  },
  {
    id: "legend",
    title: "Legends",
    summary: "Trade a card that ignores your legends for one that pays them off.",
    play: "{count} legendary cards are already in this list. Each switch brings in a card that anthems them or finds them.",
    thread: "legends",
    threshold: 12,
    avoid: "legend",
    offers: [
      o("Heroes' Podium", [], "Heroes' Podium taps to tutor a legend and pumps your legends for each legend you control."),
      o("Flowering of the White Tree", ["W"], "Flowering of the White Tree pumps your legends and gives your other creatures +1/+1."),
      o("Day of Destiny", ["W"], "Day of Destiny pumps your legendary creatures and draws when one enters if you have enough."),
      o("Rising of the Day", ["R"], "Rising of the Day gives your legends haste and +1/+0."),
      o("Reki, the History of Kamigawa", ["G"], "Reki, the History of Kamigawa draws a card whenever you cast a legend."),
      o("Kethis, the Hidden Hand", ["W", "B", "G"], "Kethis, the Hidden Hand casts legends from the graveyard and grows when you cast one."),
      o("Shanid, Sleepers' Scourge", ["W", "B", "R"], "Shanid, Sleepers' Scourge draws and loses life whenever you cast a legend or a land."),
      o("Sisay, Weatherlight Captain", ["W", "U", "B", "R", "G"], "Sisay, Weatherlight Captain tutors a legend with mana value up to her power."),
      o("Jodah, the Unifier", ["W", "U", "B", "R", "G"], "Jodah, the Unifier cascades when you cast a legend and pumps your legends."),
      o("Primevals' Glorious Rebirth", ["W", "B"], "Primevals' Glorious Rebirth returns every legend from your graveyard to the battlefield."),
      o("Urza's Ruinous Blast", ["W"], "Urza's Ruinous Blast destroys every nonland permanent that is not legendary."),
      o("Arvad the Cursed", ["W", "B"], "Arvad the Cursed gives your other legends +2/+2 and deathtouch and lifelink."),
    ],
  },
];

type Scan = {
  tribe: { type: string; count: number } | null;
  /** Leading creature type. Protected from side-plan cuts once the deck has a real pack of them. */
  anchor: { type: string; count: number } | null;
  themes: { def: ThemeDef; count: number; forced: boolean }[];
};

function bump(counts: Map<string, number>, id: string, amount: number) {
  counts.set(id, (counts.get(id) ?? 0) + amount);
}

function scanDeck(deck: Deck): Scan {
  const tribeCounts = new Map<string, number>();
  const themeCounts = new Map<string, number>();
  let auras = 0;
  let equipment = 0;
  let enchantments = 0;
  let artifacts = 0;
  let vehicles = 0;
  let legends = 0;
  let commanderMask = 0;

  const consider = (name: string, quantity: number, commander: boolean) => {
    const tag = tagOf(name);
    if (!tag) return;
    if (commander) commanderMask |= tag.themes;
    if (tag.types & TYPE_CREATURE) {
      for (const sub of tag.sub) tribeCounts.set(sub, (tribeCounts.get(sub) ?? 0) + quantity);
    }
    for (const def of THEMES) {
      if (def.bit && tag.themes & def.bit) bump(themeCounts, def.id, quantity);
    }
    if (tag.types & TYPE_AURA) auras += quantity;
    if (tag.types & TYPE_EQUIPMENT) equipment += quantity;
    if (tag.types & TYPE_ENCHANTMENT) enchantments += quantity;
    if (tag.types & TYPE_ARTIFACT && !(tag.types & TYPE_LAND)) artifacts += quantity;
    if (tag.types & TYPE_VEHICLE) vehicles += quantity;
    if (tag.types & TYPE_LEGENDARY && !(tag.types & TYPE_LAND)) legends += quantity;
  };

  for (const card of deck.commanders) consider(card.name, card.quantity, true);
  for (const card of deck.cards) consider(card.name, card.quantity, false);

  for (const commander of deck.commanders) {
    const tag = tagOf(commander.name);
    if (!tag || !(tag.types & TYPE_CREATURE)) continue;
    for (const sub of tag.sub) tribeCounts.set(sub, (tribeCounts.get(sub) ?? 0) + 2);
  }

  for (const def of THEMES) {
    if (!def.bit || !COMMANDER_FORCE.has(def.id)) continue;
    if (commanderMask & def.bit) bump(themeCounts, def.id, 2);
  }

  const synthetic: [string, number][] = [
    ["aura", auras],
    ["equipment", equipment],
    ["enchant", enchantments],
    ["artifact", artifacts],
    ["vehicle", vehicles],
    ["legend", legends],
  ];
  for (const [id, count] of synthetic) themeCounts.set(id, count);

  const ranked = [...tribeCounts.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
  let chosen: { type: string; count: number } | null = null;
  if (ranked.length) {
    let [type, count] = ranked[0];
    if (type === "Human" && ranked[1] && ranked[1][1] >= 6 && count - ranked[1][1] <= 4) {
      type = ranked[1][0];
      count = ranked[1][1];
    }
    chosen = { type, count };
  }
  const anchor = chosen && chosen.count >= 6 ? chosen : null;
  const tribe = chosen && chosen.count >= 8 ? chosen : null;

  const themes = THEMES.map((def) => {
    const count = themeCounts.get(def.id) ?? 0;
    const forced = Boolean(def.bit && COMMANDER_FORCE.has(def.id) && commanderMask & def.bit);
    return { def, count, forced };
  })
    .filter((hit) => hit.count >= hit.def.threshold || hit.forced)
    .sort((a, b) => Number(b.forced) - Number(a.forced) || b.count - a.count || a.def.title.localeCompare(b.def.title));

  if (themes.some((hit) => hit.def.id === "aura")) {
    const enchant = themes.findIndex((hit) => hit.def.id === "enchant");
    if (enchant >= 0) themes.splice(enchant, 1);
  }

  return { tribe, anchor, themes };
}

const joinNames = joinList;
const andMore = (n: number) => (n > 0 ? say(", and {n} more", { n }) : "");

function cardsWithTheme(deck: Deck, bit: number): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const card of [...deck.commanders, ...deck.cards]) {
    const key = canonicalizeName(card.name);
    if (seen.has(key) || !supportsTheme(card.name, bit)) continue;
    seen.add(key);
    out.push(card.name);
  }
  return out;
}

/** Repeatable life, not a few lifelink attackers. A 50-life win needs one of these or a deep life package. */
const LIFE_ENGINE = /soul warden|soul's attendant|essence warden|heliod, sun-crowned|ajani's welcome|rhox faithmender|crested sunmare|sanguine bond|exquisite blood/i;

const LIFE_TOTAL_BAR: Record<string, number> = {
  "aetherflux reservoir": 10,
  "test of endurance": 10,
  "beacon of immortality": 10,
  "felidar sovereign": 8,
};

function hasLifeEngine(deck: Deck): boolean {
  return [...deck.commanders, ...deck.cards].some((card) => LIFE_ENGINE.test(card.name));
}

/** A 50-life or 40-life card is only worth suggesting when the deck can actually get there. */
export function allowsLifeTotalCard(deck: Deck, name: string): boolean {
  const bar = LIFE_TOTAL_BAR[canonicalizeName(name)];
  if (bar == null) return true;
  return hasLifeEngine(deck) || cardsWithTheme(deck, THEME_LIFE).length >= bar;
}

export function lifeAlreadyLine(deck: Deck): string {
  const names = cardsWithTheme(deck, THEME_LIFE);
  const named = joinNames(names.slice(0, 3));
  if (!named) return "";
  return say("Life already comes from {named}{extra}.", { named, extra: andMore(names.length - 3) });
}

function lifeOffers(deck: Deck, count: number): Offer[] {
  const engine = hasLifeEngine(deck);
  const life = THEMES.find((theme) => theme.id === "life");
  if (!life) return [];
  return life.offers.filter((offer) => {
    const bar = LIFE_TOTAL_BAR[canonicalizeName(offer.name)];
    if (bar == null) return true;
    return engine || count >= bar;
  });
}

function protectsAnchor(name: string, anchor: Scan["anchor"]): boolean {
  return Boolean(anchor && supportsTribe(name, anchor.type));
}

function tribePayoffNames(tribe: string): Set<string> {
  return new Set(
    [...(TRIBE_OFFERS[tribe] ?? []), ...UNIVERSAL, ...COLOR_TRIBAL].map((offer) => canonicalizeName(offer.name)),
  );
}

function protectsTribePayoff(name: string, tribe: string | null | undefined): boolean {
  if (!tribe) return false;
  return tribePayoffNames(tribe).has(canonicalizeName(name));
}

function protectsEstablished(name: string, themes: Scan["themes"]): boolean {
  return themes.some((hit) => avoidCut(hit.def, name));
}

function protectsStrongerTheme(
  name: string,
  currentId: string,
  currentCount: number,
  themes: Scan["themes"],
): boolean {
  for (const other of themes) {
    if (other.def.id === currentId || other.count <= currentCount || !other.def.bit) continue;
    if (supportsTheme(name, other.def.bit)) return true;
  }
  return false;
}

function avoidCut(def: ThemeDef, name: string): boolean {
  if (def.avoid === "bit" && def.bit && supportsTheme(name, def.bit)) return true;
  if (def.avoid === "aura" && hasType(name, TYPE_AURA)) return true;
  if (def.avoid === "equipment" && hasType(name, TYPE_EQUIPMENT)) return true;
  if (def.avoid === "enchant" && hasType(name, TYPE_ENCHANTMENT)) return true;
  if (def.avoid === "artifact" && hasType(name, TYPE_ARTIFACT)) return true;
  if (def.avoid === "vehicle" && hasType(name, TYPE_VEHICLE)) return true;
  if (def.avoid === "legend" && hasType(name, TYPE_LEGENDARY)) return true;
  if ((def.id === "land" || def.id === "artifact") && hasType(name, TYPE_LAND)) return true;
  if (def.id === "donate" && hasType(name, TYPE_AURA)) return true;
  return false;
}

function takeOffers(
  planId: string,
  offers: Offer[],
  deck: Deck,
  identity: ColorIdentity[],
  usedAdds: Set<string>,
  usedCuts: Set<string>,
  avoid: (name: string) => boolean,
  limit: number,
  reasonFor: (cut: string, offer: Offer) => string,
): Suggestion[] {
  const out: Suggestion[] = [];
  const localUsed = new Set(usedCuts);
  for (const offer of offers) {
    if (out.length >= limit) break;
    const key = canonicalizeName(offer.name);
    if (usedAdds.has(key) || inDeck(deck, offer.name) || isGameChanger(offer.name)) continue;
    if (!fits(offer.colors, identity)) continue;
    const cuts = pickDisposableCuts(deck, 1, localUsed, (name) => {
      if (canonicalizeName(name) === key) return true;
      return avoid(name);
    });
    if (!cuts.length) continue;
    const cut = cuts[0];
    localUsed.add(canonicalizeName(cut));
    usedCuts.add(canonicalizeName(cut));
    usedAdds.add(key);
    out.push({
      id: `${planId}-${key.replace(/[^a-z0-9]+/g, "-")}`,
      type: "swap",
      cut: { name: cut, quantity: 1 },
      add: { name: offer.name, quantity: 1 },
      reason: reasonFor(cut, offer),
      signals: ["high-synergy"],
    });
  }
  return out;
}

function tribalOfferList(tribe: string): Offer[] {
  const specific = TRIBE_OFFERS[tribe] ?? [];
  return [
    ...specific.slice(0, 2),
    UNIVERSAL[0],
    UNIVERSAL[1],
    ...specific.slice(2),
    ...COLOR_TRIBAL,
    ...UNIVERSAL.slice(2),
  ];
}

function asAdapt(
  id: string,
  title: string,
  summary: string,
  play: string,
  suggestions: Suggestion[],
): AdaptPlan | null {
  if (!suggestions.length) return null;
  return { id, title, summary, play, suggestions };
}

export function adaptPlans(
  deck: Deck,
  identity: ColorIdentity[],
  usedAdds: Set<string>,
  usedCuts: Set<string>,
  skip: Set<string>,
): AdaptPlan[] {
  const scan = scanDeck(deck);
  const plans: AdaptPlan[] = [];

  if (scan.tribe && !skip.has(scan.tribe.type)) {
    const tribe = scan.tribe.type;
    const plural = pluralType(tribe, scan.tribe.count);
    const tribeReason = (cut: string, offer: Offer) =>
      say("{cut} is not {a} {tribe}. {because}", { cut, a: article(tribe), tribe, because: fill(offer.because, tribe, plural, scan.tribe?.count ?? 0) });
    const tribeArgs = [
      `adapt-${tribe.toLowerCase()}`,
      tribalOfferList(tribe),
      deck,
      identity,
      usedAdds,
      usedCuts,
    ] as const;
    const keepTribe = (name: string) =>
      supportsTribe(name, tribe) || protectsTribePayoff(name, tribe) || protectsEstablished(name, scan.themes);
    let offers = takeOffers(...tribeArgs, keepTribe, 4, tribeReason);
    if (!offers.length) {
      offers = takeOffers(...tribeArgs, (name) => supportsTribe(name, tribe) || protectsTribePayoff(name, tribe), 4, tribeReason);
    }
    const plan = asAdapt(
      `adapt-${tribe.toLowerCase()}`,
      say("{tribe} switches", { tribe }),
      say("Trade a card that is not {a} {tribe} for one that helps the {plural}.", { a: article(tribe), tribe, plural }),
      say("This list has {count} {plural}. Each switch takes out a card that is not {a} {tribe} and brings in a card that makes that type better.",
        { count: scan.tribe.count, plural, a: article(tribe), tribe }),
      offers,
    );
    if (plan) plans.push(plan);
  }

  for (const hit of scan.themes) {
    if (plans.length >= 4) break;
    if (skip.has(hit.def.id)) continue;
    const anchor = scan.anchor;
    const sources = hit.def.bit ? cardsWithTheme(deck, hit.def.bit) : [];
    const named = joinNames(sources.slice(0, 3));
    const extra = andMore(sources.length - 3);
    let playText = say(hit.forced && hit.def.commanderPlay ? hit.def.commanderPlay : hit.def.play).replaceAll(
      "{count}",
      String(hit.count),
    );
    if (hit.def.id === "life" && named) {
      const spare = anchor ? say(" It does not take out {a} {type}.", { a: article(anchor.type), type: anchor.type }) : "";
      playText = say("Life already comes from {named}{extra}. A switch has to spend that life. It does not add a new way to gain it.{spare}",
        { named, extra, spare });
    } else if (named) {
      playText = say("{play} Already in the list: {named}{extra}.", { play: playText, named, extra });
    }
    const pool = hit.def.id === "life" ? lifeOffers(deck, hit.count) : hit.def.offers;
    const offers = takeOffers(
      `adapt-${hit.def.id}`,
      pool,
      deck,
      identity,
      usedAdds,
      usedCuts,
      (name) =>
        avoidCut(hit.def, name) ||
        protectsAnchor(name, anchor) ||
        protectsTribePayoff(name, anchor?.type) ||
        protectsStrongerTheme(name, hit.def.id, hit.count, scan.themes),
      3,
      (cut, offer) => {
        if (hit.def.id === "life") {
          const typeNote = anchor ? say(", and it is not {a} {type}", { a: article(anchor.type), type: anchor.type }) : "";
          const from = named ? say(" Life already comes from {named}{extra}.", { named, extra }) : "";
          return say("{cut} does not gain or spend that life{typeNote}. {because}{from}", { cut, typeNote, because: say(offer.because), from });
        }
        const typeNote = anchor ? say(" It is also not {a} {type}.", { a: article(anchor.type), type: anchor.type }) : "";
        return say("{cut} does not support this direction.{typeNote} {because}", { cut, typeNote, because: say(offer.because) });
      },
    );
    const plan = asAdapt(`adapt-${hit.def.id}`, hit.def.title, hit.def.summary, playText, offers);
    if (plan) plans.push(plan);
  }

  return plans;
}

export type DeckPlan = {
  id: string;
  /** Stored on the deck, for example "angels", "lifegain", "+1/+1 counters". */
  tag: string;
  title: string;
};

const PLAN_TAG: Record<string, string> = {
  "life gain": "lifegain",
  counters: "+1/+1 counters",
};

/** Game plans this list already leans on. These are the tags a deck should carry. */
export function deckPlans(deck: Deck): DeckPlan[] {
  const scan = scanDeck(deck);
  const plans: DeckPlan[] = [];
  if (scan.tribe) {
    const title = pluralType(scan.tribe.type, 2);
    plans.push({
      id: `tribe:${scan.tribe.type}`,
      tag: title.toLowerCase(),
      title,
    });
  }
  for (const hit of scan.themes.slice(0, 4)) {
    plans.push({
      id: hit.def.id,
      tag: PLAN_TAG[hit.def.thread] ?? hit.def.thread.toLowerCase(),
      title: hit.def.title,
    });
  }
  return plans;
}

/** Cards that push one plan. Tribe plans include the shared tribal tools. */
export function offersForPlan(planId: string, deck?: Deck): Offer[] {
  if (planId.startsWith("tribe:")) {
    const tribe = planId.slice("tribe:".length);
    const plural = pluralType(tribe, 2);
    return [...(TRIBE_OFFERS[tribe] ?? []), ...UNIVERSAL, ...COLOR_TRIBAL].map((offer) => ({
      ...offer,
      // English articles only; translations do not use "a {tribe}".
      because: translating()
        ? fill(offer.because, tribe, plural, 0)
        : fill(offer.because, tribe, plural, 0).replaceAll(`a ${tribe}`, `${article(tribe)} ${tribe}`),
    }));
  }
  const theme = THEMES.find((item) => item.id === planId);
  if (!theme) return [];
  const offers =
    theme.id === "life" && deck ? lifeOffers(deck, cardsWithTheme(deck, THEME_LIFE).length) : theme.offers;
  return offers.map((offer) => ({ ...offer }));
}

/** True when this card is already doing the plan's job, so it should not be the cut. */
export function protectsPlan(planId: string, name: string, deck?: Deck): boolean {
  const scan = deck ? scanDeck(deck) : null;
  if (planId.startsWith("tribe:")) {
    const tribe = planId.slice("tribe:".length);
    if (supportsTribe(name, tribe) || protectsTribePayoff(name, tribe)) return true;
    return Boolean(scan && protectsEstablished(name, scan.themes));
  }
  const theme = THEMES.find((item) => item.id === planId);
  if (theme && avoidCut(theme, name)) return true;
  if (!scan) return false;
  if (protectsAnchor(name, scan.anchor) || protectsTribePayoff(name, scan.anchor?.type)) return true;
  const current = scan.themes.find((hit) => hit.def.id === planId);
  return Boolean(current && protectsStrongerTheme(name, planId, current.count, scan.themes));
}

/** Short labels for the reading at the top of Improve. */
export function deckLeanThreads(deck: Deck): string[] {
  const scan = scanDeck(deck);
  const threads: string[] = [];
  if (scan.tribe) threads.push(pluralType(scan.tribe.type, scan.tribe.count));
  for (const hit of scan.themes.slice(0, 3)) threads.push(hit.def.thread);
  return threads;
}
