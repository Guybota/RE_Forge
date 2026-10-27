import {
  adaptPlans,
  allowsLifeTotalCard,
  deckLeanThreads,
  lifeAlreadyLine,
  offersForPlan,
  pickDisposableCuts,
  protectsPlan,
} from "./improve-adapt";
import { estimateBracket } from "./bracket";
import { isGameChanger } from "./game-changers";
import { canonicalizeName } from "./parse-decklist";
import type { ColorIdentity, Deck, SignalTag, Suggestion } from "./types";

export type GamePlan = {
  id: string;
  title: string;
  /** One line on the closed row. */
  summary: string;
  /** How the deck would try to win if you take this plan. */
  play: string;
  suggestions: Suggestion[];
};

type Offer = {
  name: string;
  colors: ColorIdentity[];
  reason: string;
  signals: SignalTag[];
  /** Cut the first of these that is actually in the deck. A suggestion is a switch, so this is required. */
  replaces: string[];
};

type Profile = {
  id: string;
  title: string;
  summary: string;
  play: string | ((deck: Deck) => string);
  limit: number;
  detect: (deck: Deck) => boolean;
  offers: Offer[];
};

/** A small synergy or a loop, swapped in as one set. */
type Package = {
  id: string;
  title: string;
  summary: string;
  /** What the cards do together. */
  play: string;
  /** Shown on the row. */
  blurb: string;
  colors: ColorIdentity[];
  /** Every card in the set. Cards already in the deck stay; the rest are added. */
  cards: string[];
  /** Weak cards to trade away, best cut first. One cut per card still missing. */
  cutFrom: string[];
  /**
   * "free" replaces its own cost. "resource" repeats only while mana or life is paid to fuel each pass.
   * Omit this when the set is not a loop.
   */
  loop?: "free" | "resource";
  detect: (deck: Deck) => boolean;
};

const WEAK_LIFE = [
  "Cathedral Sanctifier",
  "Blessed Spirits",
  "Herald of Faith",
  "Luminarch Aspirant",
  "Luminarch Ascension",
  "Sigarda's Splendor",
];

const PACKAGES: Package[] = [
  {
    id: "heliod-ballista",
    title: "Life gain loop",
    summary: "Heliod and Walking Ballista turn life gain into repeating damage.",
    play: "Heliod, Sun-Crowned gives Walking Ballista lifelink. Ballista removes a counter to deal 1, the life puts that counter back, and the damage repeats. The life this deck already gains is what starts the loop.",
    blurb:
      "Heliod gives Walking Ballista lifelink. Each ping gains the life back as a counter, so the damage repeats.",
    colors: ["W"],
    cards: ["Heliod, Sun-Crowned", "Walking Ballista"],
    cutFrom: WEAK_LIFE,
    loop: "free",
    detect: (deck) => countMatching(deck, LIFE) >= 2,
  },
  {
    id: "blink-life",
    title: "Blink loop",
    summary: "Two blink creatures, plus a way to spend the infinite life.",
    play: "Felidar Guardian and Restoration Angel blink each other. A creature already in the list that gains life when another creature enters (Soul Warden or Soul's Attendant) turns that loop into infinite life. Aetherflux Reservoir spends 50 of that life to deal 50 damage. The blink creatures are not Angels, so Bishop of Wings does not trigger.",
    blurb:
      "Felidar Guardian and Restoration Angel blink each other. The life-gain creature already in the list gains a life on each enter, and Aetherflux Reservoir turns 50 life into 50 damage.",
    colors: ["W"],
    cards: ["Felidar Guardian", "Restoration Angel", "Aetherflux Reservoir"],
    cutFrom: ["Segovian Angel", "Angelic Page", "Angelic Protector", "Loyal Unicorn", "Spirited Companion"],
    loop: "free",
    detect: (deck) => countMatching(deck, /soul warden|soul's attendant|essence warden|impassioned orator/i) >= 1,
  },
  {
    id: "token-doublers",
    title: "Double the tokens",
    summary: "Two doublers for tokens the deck already makes.",
    play: "Anointed Procession and Mondrak, Glory Dominus double tokens. One token from Court of Grace, Resplendent Angel, or a similar card becomes two, then four if both are out.",
    blurb: "Both cards double tokens, so the token makers already in the list go twice as wide.",
    colors: ["W"],
    cards: ["Anointed Procession", "Mondrak, Glory Dominus"],
    cutFrom: ["Loyal Unicorn", "Spirited Companion", "Authority of the Consuls", "Angelic Gift", "Thraben Watcher", "Burnished Hart"],
    detect: (deck) => countMatching(deck, TOKENS) >= 2,
  },
  {
    id: "bond-blood",
    title: "Life drain loop",
    summary: "Sanguine Bond and Exquisite Blood drain the table once life starts moving.",
    play: "Sanguine Bond drains an opponent whenever you gain life. Exquisite Blood gains you that much life whenever an opponent loses life. The first life gain or drain repeats until the table is gone.",
    blurb: "The first life gain or life loss repeats between these two until the table is gone.",
    colors: ["B"],
    cards: ["Sanguine Bond", "Exquisite Blood"],
    cutFrom: ["Sign in Blood", "Read the Bones", "Night's Whisper", "Phyrexian Arena"],
    loop: "free",
    detect: (deck) => countMatching(deck, LIFE) >= 2,
  },
  {
    id: "isochron-reversal",
    title: "Rock loop",
    summary: "Isochron Scepter and Dramatic Reversal untap mana rocks forever.",
    play: "Imprint Dramatic Reversal on Isochron Scepter. With mana rocks that can make at least 3 mana, copying Reversal untaps the rocks and the Scepter, and you can copy it again.",
    blurb:
      "Copying Dramatic Reversal untaps the rocks and the Scepter. The loop needs rocks that tap for 3 or more mana together.",
    colors: ["U"],
    cards: ["Isochron Scepter", "Dramatic Reversal"],
    cutFrom: ["Unsummon", "Into the Roil", "Think Twice", "Catalog"],
    loop: "resource",
    detect: (deck) => countMatching(deck, ROCKS) >= 3,
  },
  {
    id: "earthcraft-nest",
    title: "Token mana loop",
    summary: "Earthcraft and Squirrel Nest make infinite tokens and mana.",
    play: "Squirrel Nest puts a token on a land each upkeep. Earthcraft taps a creature to untap a basic land. The token taps to untap the enchanted land, Nest makes another token, and it repeats.",
    blurb: "A token untaps the land with the Nest, the Nest makes another token, and both mana and tokens repeat.",
    colors: ["G"],
    cards: ["Earthcraft", "Squirrel Nest"],
    cutFrom: ["Fertile Ground", "Wild Growth", "Overgrowth", "Rampant Growth"],
    loop: "free",
    detect: (deck) => countMatching(deck, TOKENS) >= 1,
  },
];

const ANGELS: Offer[] = [
  {
    name: "Angel of Destiny",
    colors: ["W"],
    reason: "The Angel coming out does not grow. Angel of Destiny gets larger when your Angels hit, and it can exile what it damages.",
    signals: ["high-synergy"],
    replaces: ["Serra Angel", "Angelic Protector"],
  },
  {
    name: "Youthful Valkyrie",
    colors: ["W"],
    reason: "The card coming out pumps one creature, or does nothing for the tribe. Youthful Valkyrie gets a counter every time you cast an Angel.",
    signals: ["high-synergy"],
    replaces: ["Angelic Page", "Segovian Angel"],
  },
  {
    name: "Archangel of Thune",
    colors: ["W"],
    reason: "The card coming out only gains a little life. Archangel of Thune turns the life the deck already gains into +1/+1 counters on every creature.",
    signals: ["high-synergy"],
    replaces: ["Herald of Faith", "Cathedral Sanctifier"],
  },
  {
    name: "Speaker of the Heavens",
    colors: ["W"],
    reason: "The card coming out does not spend the life this deck gains. Speaker of the Heavens turns that life into Angel tokens.",
    signals: ["high-synergy"],
    replaces: ["Segovian Angel", "Luminarch Ascension", "Blessed Spirits"],
  },
  {
    name: "Vanquisher's Banner",
    colors: [],
    reason: "The card coming out does not draw when you cast an Angel. Vanquisher's Banner anthems the tribe and draws a card when you cast one.",
    signals: ["high-synergy"],
    replaces: ["The Immortal Sun", "Thraben Watcher", "Angelic Gift"],
  },
  {
    name: "Akroma's Will",
    colors: ["W"],
    reason: "The card coming out protects one creature, or fogs for a turn. Akroma's Will protects the Angel team and gives them a turn where they all hit.",
    signals: ["high-synergy"],
    replaces: ["Angelsong", "Angelic Destiny", "Angelic Gift"],
  },
  {
    name: "Gisela, the Broken Blade",
    colors: ["W"],
    reason: "The Angel coming out prevents one hit, then does nothing else. Gisela, the Broken Blade is a larger Angel that can meld with Bruna.",
    signals: ["high-synergy"],
    replaces: ["Angelic Protector"],
  },
  {
    name: "Emeria, the Sky Ruin",
    colors: ["W"],
    reason: "The land coming out does not bring Angels back. Emeria, the Sky Ruin returns an Angel when you have enough Plains.",
    signals: ["high-synergy"],
    replaces: ["Temple of the False God", "New Benalia"],
  },
  {
    name: "Starnheim Unleashed",
    colors: ["W"],
    reason: "Brilliant Restoration is a huge reanimation spell. Starnheim Unleashed makes Angels now, or more of them if it was foretold.",
    signals: ["high-synergy"],
    replaces: ["Brilliant Restoration"],
  },
  {
    name: "Moonshaker Cavalry",
    colors: ["W"],
    reason: "The card coming out does not care about Angels. Moonshaker Cavalry gives the whole board +X/+X and flying for one attack.",
    signals: ["high-synergy"],
    replaces: ["Portal to Phyrexia"],
  },
];

const LIFE_PAYOFFS: Offer[] = [
  {
    name: "Aetherflux Reservoir",
    colors: [],
    reason:
      "Aetherflux Reservoir deals 50 damage, but only once your life total reaches 50. Keep the card that gains the life. This only replaces a small life-gain card that does not spend it.",
    signals: ["high-synergy"],
    replaces: ["Cathedral Sanctifier", "Blessed Spirits"],
  },
  {
    name: "Well of Lost Dreams",
    colors: [],
    reason: "Life gain that only changes your total does not find the next card. Well of Lost Dreams draws from that life.",
    signals: ["high-synergy"],
    replaces: ["Dawn of Hope", "Sigarda's Splendor"],
  },
];

const REMOVAL: Offer[] = [
  {
    name: "Swords to Plowshares",
    colors: ["W"],
    reason: "The answer coming out takes a whole turn and leaves a permanent. Swords to Plowshares removes any creature for one mana.",
    signals: ["staple"],
    replaces: ["Faith's Fetters", "Pacifism", "Arrest", "Condemn"],
  },
  {
    name: "Get Lost",
    colors: ["W"],
    reason: "The answer coming out is a slow exile enchantment. Get Lost exiles a creature, enchantment, or planeswalker for two mana.",
    signals: ["staple"],
    replaces: ["Banishing Light", "Cast Out", "Oblivion Ring", "Journey to Nowhere"],
  },
  {
    name: "Path to Exile",
    colors: ["W"],
    reason: "A second cheap exile spell, for the enchantment removal that is still sitting in the list.",
    signals: ["staple"],
    replaces: ["Cast Out", "Banishing Light", "Faith's Fetters"],
  },
];

const MANA: Offer[] = [
  {
    name: "Arcane Signet",
    colors: [],
    reason: "The rock coming out costs more than it makes, or it asks you to untap it. Arcane Signet comes down on turn two and taps for your colors.",
    signals: ["staple"],
    replaces: ["Commander's Sphere", "Marble Diamond", "Basalt Monolith", "Burnished Hart"],
  },
  {
    name: "Fellwar Stone",
    colors: [],
    reason: "Another two-mana rock, in place of a rock that enters tapped or costs more to untap.",
    signals: ["staple"],
    replaces: ["Marble Diamond", "Commander's Sphere", "Basalt Monolith"],
  },
];

const PUSH: Offer[] = [
  {
    name: "Teferi's Protection",
    colors: ["W"],
    reason: "Official Game Changer. The card coming out saves you for a turn. Teferi's Protection phases out your board and your life total.",
    signals: ["game-changer", "bracket-up"],
    replaces: ["Angelsong", "Make a Stand", "Unbreakable Formation"],
  },
  {
    name: "Farewell",
    colors: ["W"],
    reason: "Official Game Changer. The card coming out deals with one creature, or sweeps less cleanly. Farewell exiles several card types and resets the board.",
    signals: ["game-changer", "bracket-up"],
    replaces: ["Angelic Ascension", "Day of Judgment", "Wrath of God"],
  },
  {
    name: "Ancient Tomb",
    colors: [],
    reason: "Official Game Changer. The land coming out is slow. Ancient Tomb makes two mana the turn it comes down.",
    signals: ["game-changer", "bracket-up"],
    replaces: ["Temple of the False God", "New Benalia", "Secluded Steppe"],
  },
  {
    name: "Enlightened Tutor",
    colors: ["W"],
    reason: "Official Game Changer. A slower tutor finds the same artifact or enchantment a turn later. Enlightened Tutor costs one.",
    signals: ["game-changer", "bracket-up"],
    replaces: ["Idyllic Tutor", "Open the Armory", "Steelshaper's Gift"],
  },
  {
    name: "Drannith Magistrate",
    colors: ["W"],
    reason: "Official Game Changer. A quieter hate piece becomes a card that stops commanders from being cast out of the command zone.",
    signals: ["game-changer", "bracket-up"],
    replaces: ["Grand Abolisher", "Deafening Silence"],
  },
  {
    name: "Smothering Tithe",
    colors: ["W"],
    reason: "Official Game Changer. A smaller tax effect becomes treasures whenever an opponent draws and does not pay.",
    signals: ["game-changer", "bracket-up"],
    replaces: ["Monologue Tax", "Smuggler's Share"],
  },
  {
    name: "Rhystic Study",
    colors: ["U"],
    reason: "Official Game Changer. A smaller draw enchantment becomes a card on almost every opposing spell.",
    signals: ["game-changer", "bracket-up"],
    replaces: ["Mystic Remora", "Insight"],
  },
  {
    name: "Cyclonic Rift",
    colors: ["U"],
    reason: "Official Game Changer. A one-sided bounce spell, overloaded, in place of a bounce that hits one permanent.",
    signals: ["game-changer", "bracket-up"],
    replaces: ["Aetherize", "Evacuation", "Into the Roil"],
  },
  {
    name: "Fierce Guardianship",
    colors: ["U"],
    reason: "Official Game Changer. A free counterspell while your commander is out, in place of a counter you have to leave mana for.",
    signals: ["game-changer", "bracket-up"],
    replaces: ["Counterspell", "Arcane Denial", "Negate"],
  },
  {
    name: "Demonic Tutor",
    colors: ["B"],
    reason: "Official Game Changer. A four-mana tutor becomes a two-mana tutor that finds any card.",
    signals: ["game-changer", "bracket-up"],
    replaces: ["Diabolic Tutor", "Increasing Ambition"],
  },
  {
    name: "Necropotence",
    colors: ["B"],
    reason: "Official Game Changer. A slow draw enchantment becomes life paid for as many cards as you can take.",
    signals: ["game-changer", "bracket-up"],
    replaces: ["Phyrexian Arena", "Greed", "Erebos, God of the Dead"],
  },
  {
    name: "Jeska's Will",
    colors: ["R"],
    reason: "Official Game Changer. A mana or card burst in place of a treasure or impulse effect that does only one of those.",
    signals: ["game-changer", "bracket-up"],
    replaces: ["Professional Face-Breaker", "Light Up the Stage"],
  },
  {
    name: "Worldly Tutor",
    colors: ["G"],
    reason: "Official Game Changer. A creature tutor that costs one, in place of a tutor that costs more.",
    signals: ["game-changer", "bracket-up"],
    replaces: ["Elvish Tutor", "Shared Summons"],
  },
  {
    name: "The One Ring",
    colors: [],
    reason: "Official Game Changer. Protection and a growing draw, in place of a draw rock that does less.",
    signals: ["game-changer", "bracket-up"],
    replaces: ["Mind's Eye", "Sensei's Divining Top"],
  },
];

/** Softer stand-in when switching a Game Changer out. */
const SOFTER: Record<string, { name: string; colors: ColorIdentity[] }> = {
  "Smothering Tithe": { name: "Monologue Tax", colors: ["W"] },
  "Teferi's Protection": { name: "Dawn's Truce", colors: ["W"] },
  Farewell: { name: "Austere Command", colors: ["W"] },
  "Enlightened Tutor": { name: "Idyllic Tutor", colors: ["W"] },
  "Drannith Magistrate": { name: "Grand Abolisher", colors: ["W"] },
  "Rhystic Study": { name: "Mystic Remora", colors: ["U"] },
  "Cyclonic Rift": { name: "Aetherize", colors: ["U"] },
  "Mystical Tutor": { name: "Personal Tutor", colors: ["U"] },
  "Fierce Guardianship": { name: "Counterspell", colors: ["U"] },
  "Force of Will": { name: "Arcane Denial", colors: ["U"] },
  "Demonic Tutor": { name: "Diabolic Tutor", colors: ["B"] },
  Necropotence: { name: "Phyrexian Arena", colors: ["B"] },
  "Jeska's Will": { name: "Professional Face-Breaker", colors: ["R"] },
  "The One Ring": { name: "Mind's Eye", colors: [] },
  "Ancient Tomb": { name: "Command Tower", colors: [] },
};

const LIFE = /soul warden|soul's attendant|essence warden|righteous valkyrie|resplendent angel|heliod|speaker of the heavens|bishop of wings|angelic accord|dawn of hope|well of lost dreams|aetherflux reservoir/i;
const TOKENS = /court of grace|divine visitation|resplendent angel|angelic accord|speaker of the heavens|anointed procession|mondrak|secure the wastes|young pyromancer|talrand|squirrel nest/i;
const ROCKS = /sol ring|arcane signet|mind stone|marble diamond|fellwar stone|commander's sphere|basalt monolith|talisman of|signet|thought vessel|worn powerstone|guardian idol/i;

function identityOf(deck: Deck): ColorIdentity[] {
  return deck.colorIdentity ?? [];
}

function inDeck(deck: Deck, name: string): boolean {
  const key = canonicalizeName(name);
  return (
    deck.cards.some((card) => canonicalizeName(card.name) === key) ||
    deck.commanders.some((card) => canonicalizeName(card.name) === key)
  );
}

function fits(colors: ColorIdentity[], identity: ColorIdentity[]): boolean {
  if (!identity.length) return colors.length === 0;
  return colors.every((color) => identity.includes(color));
}

function countMatching(deck: Deck, pattern: RegExp): number {
  return [...deck.commanders, ...deck.cards].filter((card) => pattern.test(card.name)).length;
}

function angelDeck(deck: Deck): boolean {
  const names = [...deck.commanders, ...deck.cards].map((card) => card.name);
  if (names.some((name) => /giada|bruna|gisela|aurelia|sigarda/i.test(name))) return true;
  return names.filter((name) => /angel/i.test(name)).length >= 8;
}

function fromOffer(
  planId: string,
  offer: Offer,
  deck: Deck,
  usedCuts: Set<string>,
): Suggestion | null {
  if (inDeck(deck, offer.name)) return null;
  const cutName = offer.replaces.find((name) => {
    const key = canonicalizeName(name);
    return inDeck(deck, name) && !usedCuts.has(key) && !isGameChanger(name);
  });
  if (!cutName) return null;
  usedCuts.add(canonicalizeName(cutName));
  return {
    id: `${planId}-${canonicalizeName(offer.name)}`,
    type: "swap",
    add: { name: offer.name, quantity: 1 },
    cut: { name: cutName, quantity: 1 },
    reason: offer.reason,
    signals: offer.signals,
  };
}

function take(
  planId: string,
  offers: Offer[],
  deck: Deck,
  identity: ColorIdentity[],
  usedAdds: Set<string>,
  usedCuts: Set<string>,
  limit: number,
): Suggestion[] {
  const out: Suggestion[] = [];
  for (const offer of offers) {
    if (out.length >= limit) break;
    const key = canonicalizeName(offer.name);
    if (usedAdds.has(key)) continue;
    if (!fits(offer.colors, identity)) continue;
    const suggestion = fromOffer(planId, offer, deck, usedCuts);
    if (!suggestion) continue;
    usedAdds.add(key);
    out.push(suggestion);
  }
  return out;
}

function asPlan(
  id: string,
  title: string,
  summary: string,
  play: string,
  suggestions: Suggestion[],
): GamePlan | null {
  if (!suggestions.length) return null;
  return { id, title, summary, play, suggestions };
}

function pickCuts(
  deck: Deck,
  candidates: string[],
  count: number,
  usedCuts: Set<string>,
  avoidNames: string[],
): string[] | null {
  const found: string[] = [];
  const blocked = new Set(usedCuts);
  for (const name of candidates) {
    if (found.length >= count) break;
    const key = canonicalizeName(name);
    if (blocked.has(key)) continue;
    if (!inDeck(deck, name) || isGameChanger(name)) continue;
    if (deck.commanders.some((card) => canonicalizeName(card.name) === key)) continue;
    found.push(name);
    blocked.add(key);
  }
  if (found.length < count) {
    const more = pickDisposableCuts(deck, count - found.length, blocked, (name) =>
      avoidNames.some((avoid) => canonicalizeName(avoid) === canonicalizeName(name)),
    );
    found.push(...more);
  }
  return found.length === count ? found : null;
}

function packagePlan(
  pkg: Package,
  deck: Deck,
  identity: ColorIdentity[],
  usedAdds: Set<string>,
  usedCuts: Set<string>,
): GamePlan | null {
  if (!pkg.detect(deck) || !fits(pkg.colors, identity)) return null;
  const owned = pkg.cards.filter((name) => inDeck(deck, name));
  const missing = pkg.cards.filter((name) => !inDeck(deck, name));
  if (!missing.length) return null;
  if (missing.some((name) => usedAdds.has(canonicalizeName(name)))) return null;
  const cuts = pickCuts(deck, pkg.cutFrom, missing.length, usedCuts, pkg.cards);
  if (!cuts) return null;
  for (const name of cuts) usedCuts.add(canonicalizeName(name));
  for (const name of missing) usedAdds.add(canonicalizeName(name));
  const ownedLine = owned.length
    ? ` ${joinList(owned)} ${owned.length === 1 ? "is" : "are"} already in this deck, shown with the switch, and ${owned.length === 1 ? "stays" : "stay"}. The switch is the only change.`
    : "";
  return {
    id: pkg.id,
    title: pkg.title,
    summary: owned.length ? `Finish this with ${joinList(missing)}.` : pkg.summary,
    play: `${pkg.play}${ownedLine}`,
    suggestions: [
      {
        id: pkg.id,
        type: "swap",
        title: pkg.title,
        adds: missing.map((name) => ({ name, quantity: 1 })),
        cuts: cuts.map((name) => ({ name, quantity: 1 })),
        keeps: owned.map((name) => ({ name, quantity: 1 })),
        reason: pkg.blurb,
        signals:
          pkg.loop === "resource"
            ? ["infinite-resource", "high-synergy"]
            : pkg.loop === "free"
              ? ["infinite", "high-synergy"]
              : ["high-synergy"],
      },
    ],
  };
}

const PROFILES: Profile[] = [
  {
    id: "angels",
    title: "Angel switches",
    summary: "Trade a card that is not helping the Angels for one that does.",
    play: "The Angels already in the list get better when the cards around them are Angels, anthems, or life-gain payoffs. Each switch takes out a card that does not do that.",
    limit: 5,
    detect: angelDeck,
    offers: ANGELS,
  },
  {
    id: "life",
    title: "Life gain payoffs",
    summary: "Trade a small life-gain card for one that wins or draws from that life.",
    play: (deck) => {
      const from = lifeAlreadyLine(deck);
      const spend =
        "These switches spend that life on cards or damage instead of leaving it as a higher total. They do not add a new way to gain life.";
      return from ? `${from} ${spend}` : spend;
    },
    limit: 3,
    detect: (deck) => countMatching(deck, LIFE) >= 2,
    offers: LIFE_PAYOFFS,
  },
  {
    id: "removal",
    title: "Faster answers",
    summary: "Trade a slow enchantment answer for a spell that deals with the threat now.",
    play: (deck) =>
      angelDeck(deck)
        ? "The deck's removal is mostly auras and Oblivion Ring effects. A spell that exiles on the spot keeps the Angels attacking instead of spending a turn to answer one creature."
        : "Several answers here are auras that sit until your next turn. A spell that exiles on the spot deals with the threat before it gets another attack.",
    limit: 3,
    detect: () => true,
    offers: REMOVAL,
  },
  {
    id: "mana",
    title: "Smoother mana",
    summary: "Trade a clumsy rock for one that comes down on turn two.",
    play: (deck) =>
      angelDeck(deck)
        ? "The Angels need mana on time. A rock that costs more than it makes, or that enters tapped, is the card to switch."
        : "The commander wants mana on time. A rock that costs more than it makes, or that enters tapped, is the card to switch.",
    limit: 2,
    detect: (deck) => countMatching(deck, ROCKS) >= 1,
    offers: MANA,
  },
];

export function buildGamePlans(deck: Deck): {
  plans: GamePlan[];
  identityKnown: boolean;
} {
  const identity = identityOf(deck);
  const usedAdds = new Set<string>();
  const usedCuts = new Set<string>();
  const plans: GamePlan[] = [];

  for (const pkg of PACKAGES) {
    const plan = packagePlan(pkg, deck, identity, usedAdds, usedCuts);
    if (plan) plans.push(plan);
  }

  const focused = new Set(["angels", "life"]);
  for (const profile of PROFILES) {
    if (!focused.has(profile.id) || !profile.detect(deck)) continue;
    const play = typeof profile.play === "string" ? profile.play : profile.play(deck);
    const offers =
      profile.id === "life" ? profile.offers.filter((offer) => allowsLifeTotalCard(deck, offer.name)) : profile.offers;
    const plan = asPlan(
      profile.id,
      profile.title,
      profile.summary,
      play,
      take(profile.id, offers, deck, identity, usedAdds, usedCuts, profile.limit),
    );
    if (plan) plans.push(plan);
  }

  const skip = new Set<string>();
  if (angelDeck(deck)) skip.add("Angel");
  if (plans.some((plan) => plan.id === "life")) skip.add("life");
  if (plans.some((plan) => plan.id === "token-doublers")) skip.add("token");
  if (plans.some((plan) => plan.id === "blink-life")) skip.add("blink");
  plans.push(...adaptPlans(deck, identity, usedAdds, usedCuts, skip));

  for (const profile of PROFILES) {
    if (focused.has(profile.id) || !profile.detect(deck)) continue;
    const play = typeof profile.play === "string" ? profile.play : profile.play(deck);
    const plan = asPlan(
      profile.id,
      profile.title,
      profile.summary,
      play,
      take(profile.id, profile.offers, deck, identity, usedAdds, usedCuts, profile.limit),
    );
    if (plan) plans.push(plan);
  }

  return { plans, identityKnown: identity.length > 0 };
}

/**
 * Optional switches for a chosen bracket and a game plan the deck already has.
 * Nothing here is required. The caller decides which ideas to keep.
 */
export function bracketAdjustments(
  deck: Deck,
  planId: string,
  target: 1 | 2 | 3 | 4 | 5,
): { toward: Suggestion[]; plan: Suggestion[] } {
  const identity = identityOf(deck);
  const current = estimateBracket(deck).bracket;
  const usedCuts = new Set<string>();
  const usedAdds = new Set<string>();
  const toward: Suggestion[] = [];
  const gameChangers = deck.cards.filter((card) => isGameChanger(card.name));
  const cap = target <= 2 ? 0 : target === 3 ? 3 : null;
  const planCards = planCardsFor(deck, planId);

  const rememberAdd = (name: string) => usedAdds.add(canonicalizeName(name));
  const alreadyQueued = (name: string) =>
    inDeck(deck, name) || usedAdds.has(canonicalizeName(name));

  if (cap !== null && gameChangers.length > cap) {
    for (const card of gameChangers) {
      const softer = SOFTER[card.name];
      const fallback = planCards.find(
        (offer) =>
          fits(offer.colors, identity) &&
          !isGameChanger(offer.name) &&
          !alreadyQueued(offer.name),
      );
      const sameJob = Boolean(softer && fits(softer.colors, identity) && !alreadyQueued(softer.name));
      const addName = sameJob ? softer?.name : fallback?.name;
      if (!addName) continue;
      rememberAdd(addName);
      const job = sameJob
        ? `${addName} keeps a similar job and does not count as one.`
        : `${addName} supports this plan and does not count as one.`;
      toward.push({
        id: `bracket-${target}-ease-${canonicalizeName(card.name)}`,
        type: "swap",
        title: "Ease a Game Changer",
        cut: { name: card.name, quantity: 1 },
        add: { name: addName, quantity: 1 },
        reason: `${card.name} is an official Game Changer. ${job} Bracket ${target} usually stays at ${cap === 0 ? "no Game Changers" : `${cap} or fewer`}.`,
        signals: ["bracket-down", "game-changer"],
      });
    }
  }

  const wantMore =
    (target === 3 && gameChangers.length < 3) ||
    (target === 4 && gameChangers.length < 4) ||
    target === 5;
  if (wantMore && target > current) {
    for (const offer of PUSH) {
      if (!fits(offer.colors, identity) || alreadyQueued(offer.name)) continue;
      if (isGameChanger(offer.name) && target <= 2) continue;
      const preferred = offer.replaces.find(
        (name) => inDeck(deck, name) && !usedCuts.has(canonicalizeName(name)) && !isGameChanger(name),
      );
      if (!preferred) continue;
      usedCuts.add(canonicalizeName(preferred));
      rememberAdd(offer.name);
      toward.push({
        id: `bracket-${target}-push-${canonicalizeName(offer.name)}`,
        type: "swap",
        title: "Add a Game Changer",
        cut: { name: preferred, quantity: 1 },
        add: { name: offer.name, quantity: 1 },
        reason: `${offer.reason} Optional, and only if you want the list to read closer to Bracket ${target}.`,
        signals: ["bracket-up", "game-changer"],
      });
    }
  }

  const planCuts = new Set<string>();
  const planAdds = new Set<string>();
  const takePlanCut = (avoidName: string): string | null => {
    const found = pickDisposableCuts(deck, 1, planCuts, (name) => {
      if (canonicalizeName(name) === canonicalizeName(avoidName)) return true;
      return protectsPlan(planId, name, deck);
    });
    if (!found.length) return null;
    planCuts.add(canonicalizeName(found[0]));
    return found[0];
  };
  const plan: Suggestion[] = [];
  for (const offer of planCards) {
    if (plan.length >= 8) break;
    if (!fits(offer.colors, identity) || inDeck(deck, offer.name) || planAdds.has(canonicalizeName(offer.name)))
      continue;
    if (isGameChanger(offer.name) && target <= 3) continue;
    const preferred = offer.replaces?.find(
      (name) => inDeck(deck, name) && !planCuts.has(canonicalizeName(name)) && !isGameChanger(name),
    );
    const cutName = preferred ?? takePlanCut(offer.name);
    if (!cutName) continue;
    if (preferred) planCuts.add(canonicalizeName(preferred));
    planAdds.add(canonicalizeName(offer.name));
    plan.push({
      id: `bracket-${target}-plan-${planId}-${canonicalizeName(offer.name)}`,
      type: "swap",
      title: "Plan card",
      cut: { name: cutName, quantity: 1 },
      add: { name: offer.name, quantity: 1 },
      reason: offer.because,
      signals: ["high-synergy"],
    });
  }

  return { toward, plan };
}

function planCardsFor(
  deck: Deck,
  planId: string,
): { name: string; colors: ColorIdentity[]; because: string; replaces?: string[] }[] {
  const fromThemes = offersForPlan(planId, deck).map((offer) => ({
    name: offer.name,
    colors: offer.colors,
    because: offer.because,
  }));
  if (planId !== "tribe:Angel" && planId !== "life") return fromThemes;
  const extra = (planId === "tribe:Angel" ? ANGELS : LIFE_PAYOFFS)
    .filter((offer) => allowsLifeTotalCard(deck, offer.name))
    .map((offer) => ({
      name: offer.name,
      colors: offer.colors,
      because: offer.reason,
      replaces: offer.replaces,
    }));
  const seen = new Set(extra.map((offer) => canonicalizeName(offer.name)));
  return [...extra, ...fromThemes.filter((offer) => !seen.has(canonicalizeName(offer.name)))];
}

const COLOR_WORDS: Record<ColorIdentity, string> = {
  W: "white",
  U: "blue",
  B: "black",
  R: "red",
  G: "green",
};

export type DeckReading = {
  headline: string;
  body: string;
  threads: string[];
};

function joinList(items: string[]): string {
  if (items.length <= 1) return items[0] ?? "";
  if (items.length === 2) return `${items[0]} and ${items[1]}`;
  return `${items.slice(0, -1).join(", ")}, and ${items[items.length - 1]}`;
}

/** A short reading of the deck as it is, before any suggestions. */
export function readDeck(deck: Deck): DeckReading {
  const commanders = deck.commanders.map((card) => card.name);
  const names = [...deck.commanders, ...deck.cards].map((card) => card.name);
  const threads = deckLeanThreads(deck);
  const gameChangers = names.filter((name) => isGameChanger(name));
  if (gameChangers.length === 1) threads.push("one Game Changer");
  else if (gameChangers.length > 1) threads.push(`${gameChangers.length} Game Changers`);
  if (!threads.some((thread) => thread !== "one Game Changer" && !thread.endsWith("Game Changers"))) {
    if (names.filter((name) => /angel/i.test(name)).length >= 8) threads.push("Angels");
    if (countMatching(deck, LIFE) >= 2) threads.push("life gain");
    if (countMatching(deck, ROCKS) >= 1) threads.push("ramp");
    if (
      names.some((name) =>
        /swords to plowshares|path to exile|generous gift|chaos warp|beast within|counterspell|wrath of god/i.test(
          name,
        ),
      )
    ) {
      threads.push("removal");
    }
  }

  const colors = (deck.colorIdentity ?? [])
    .map((color) => COLOR_WORDS[color])
    .filter(Boolean);
  const who = commanders.length ? joinList(commanders) : "";
  const lean = threads.length
    ? `The list already leans on ${joinList(threads)}.`
    : "The list does not lean on one package yet, so there is room to look around.";
  const colorLine = colors.length ? ` The colors are ${joinList(colors)}.` : "";

  const body = who
    ? `${who} is the card the rest of this list is built around.${colorLine} ${lean}`
    : "This list has no commander yet. Add one on the deck page, then come back.";

  return {
    headline: who || deck.name,
    body,
    threads,
  };
}

const BASIC = /^(snow-covered )?(plains|island|swamp|mountain|forest|wastes)$/i;

/** Optional set-asides, only if someone wants a printed copy to stay at 100. */
export function roomCutSuggestions(
  deck: Deck,
  alreadyCutting: Set<string>,
): Suggestion[] {
  return deck.cards
    .filter((card) => !alreadyCutting.has(canonicalizeName(card.name)))
    .filter((card) => !BASIC.test(card.name.trim()))
    .map((card) => ({
      id: `room-${canonicalizeName(card.name)}`,
      type: "cut" as const,
      cut: { name: card.name, quantity: 1 },
      reason: "Set aside on the copy only, and only if you want that copy to stay at 100.",
      signals: [],
    }));
}
