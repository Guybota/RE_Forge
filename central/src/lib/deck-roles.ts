import type { ColorIdentity, Deck } from "./types";
import type { CardVisual } from "./scryfall";

export type RoleKey = "lands" | "ramp" | "draw" | "removal" | "wipes" | "protection";

export type RoleCount = {
  key: RoleKey;
  label: string;
  count: number;
};

export type PipBalance = {
  color: ColorIdentity;
  pips: number;
  sources: number;
  thin: boolean;
};

export type DeckRoles = {
  roles: RoleCount[];
  pips: PipBalance[];
  /** Cards whose text or basic-land name we could classify. */
  loaded: number;
  total: number;
};

const ROLE_LABELS: Record<RoleKey, string> = {
  lands: "Lands",
  ramp: "Ramp",
  draw: "Draw",
  removal: "Removal",
  wipes: "Wipes",
  protection: "Protection",
};

const COLOR_NAME: Record<ColorIdentity, string> = {
  W: "White",
  U: "Blue",
  B: "Black",
  R: "Red",
  G: "Green",
};

const BASIC =
  /^(snow-covered )?(plains|island|swamp|mountain|forest|wastes)$/i;

const BASIC_COLOR: Record<string, ColorIdentity | null> = {
  plains: "W",
  island: "U",
  swamp: "B",
  mountain: "R",
  forest: "G",
  wastes: null,
};

function basicColor(name: string): ColorIdentity | null | undefined {
  const match = name.trim().toLowerCase().match(/^(?:snow-covered )?(plains|island|swamp|mountain|forest|wastes)$/);
  if (!match) return undefined;
  return BASIC_COLOR[match[1]];
}

function isLand(name: string, type: string): boolean {
  if (type.includes("land")) return true;
  return BASIC.test(name);
}

function isWipe(text: string): boolean {
  const mass =
    /destroy all|exile all|all creatures|all permanents|all nonland|each creature|each nonland permanent|each permanent/.test(
      text,
    );
  const answer = /destroy|exile|damage|return .{0,30}to (their|its) owner|gets? -\d+\/-\d+/.test(text);
  return mass && answer;
}

function isRemoval(text: string): boolean {
  if (isWipe(text)) return false;
  return (
    /destroy target|exile target/.test(text) ||
    /deals? \d+ damage to (any target|target)/.test(text) ||
    /target (creature|permanent|artifact|enchantment|planeswalker).{0,50}(destroy|exile)/.test(text) ||
    /gets? -\d+\/-\d+ until/.test(text)
  );
}

function isRamp(text: string, land: boolean): boolean {
  if (land) return false;
  if (/search your library for .{0,60}\bland\b/.test(text)) return true;
  if (/put .{0,50}land (card|cards).{0,50}onto the battlefield/.test(text)) return true;
  if (/\badd\b/.test(text) && (/\{[cwubrg]/.test(text) || /mana of any (one )?color/.test(text))) return true;
  return false;
}

function isDraw(text: string): boolean {
  return /\bdraw (a|an|one|two|three|four|five|x|that many|\d+) cards?\b/.test(text);
}

function isProtection(text: string): boolean {
  return (
    /\bhexproof\b|\bshroud\b|\bindestructible\b|\bward \{/.test(text) ||
    /protection from/.test(text) ||
    /can't be the targets? of|can't be countered/.test(text)
  );
}

function producedColors(name: string, type: string, text: string, identity: ColorIdentity[]): ColorIdentity[] {
  const colors = new Set<ColorIdentity>();
  const basic = basicColor(name);
  if (basic) colors.add(basic);
  if (/\bplains\b/.test(type)) colors.add("W");
  if (/\bisland\b/.test(type)) colors.add("U");
  if (/\bswamp\b/.test(type)) colors.add("B");
  if (/\bmountain\b/.test(type)) colors.add("R");
  if (/\bforest\b/.test(type)) colors.add("G");
  if (/mana of any (one )?color/.test(text)) {
    for (const color of identity.length ? identity : (["W", "U", "B", "R", "G"] as const)) colors.add(color);
  }
  if (/\badd\b/.test(text)) {
    for (const match of text.matchAll(/\{([wubrg])\}/g)) {
      colors.add(match[1].toUpperCase() as ColorIdentity);
    }
  }
  return [...colors];
}

function addPips(cost: string, tally: Record<ColorIdentity, number>) {
  const symbols = cost.match(/\{[^}]+\}/g) ?? [];
  for (const symbol of symbols) {
    const inner = symbol.slice(1, -1).toUpperCase();
    if (/^[WUBRG]$/.test(inner)) tally[inner as ColorIdentity] += 1;
    else if (/^[WUBRG]\/P$/.test(inner)) tally[inner[0] as ColorIdentity] += 1;
  }
}

function thinSource(pips: number, sources: number): boolean {
  if (pips >= 15) return sources < 10;
  if (pips >= 8) return sources < 7;
  return false;
}

/** Jobs one card fills, from the same text rules as the deck counts. */
export function cardJobs(name: string, visual: CardVisual | undefined): RoleKey[] {
  const type = (visual?.typeLine ?? "").toLowerCase();
  const text = (visual?.oracleText ?? "").toLowerCase();
  const jobs: RoleKey[] = [];
  const land = isLand(name, type);
  if (land) jobs.push("lands");
  if (isRamp(text, land)) jobs.push("ramp");
  if (isDraw(text)) jobs.push("draw");
  if (isWipe(text)) jobs.push("wipes");
  else if (isRemoval(text)) jobs.push("removal");
  if (isProtection(text)) jobs.push("protection");
  return jobs;
}

/**
 * Lands, ramp, draw, removal, wipes, protection, and whether colored pips have sources.
 * Counts come from Scryfall type lines and oracle text. A card can fill more than one job.
 * Lands are not also counted as ramp.
 */
export function readDeckRoles(
  deck: Deck,
  get: (name: string) => CardVisual | undefined,
): DeckRoles {
  const identity = (deck.colorIdentity ?? []) as ColorIdentity[];
  const counts: Record<RoleKey, number> = {
    lands: 0,
    ramp: 0,
    draw: 0,
    removal: 0,
    wipes: 0,
    protection: 0,
  };
  const sources: Record<ColorIdentity, number> = { W: 0, U: 0, B: 0, R: 0, G: 0 };
  const pips: Record<ColorIdentity, number> = { W: 0, U: 0, B: 0, R: 0, G: 0 };
  let loaded = 0;
  let total = 0;

  for (const card of [...deck.commanders, ...deck.cards]) {
    total += card.quantity;
    const visual = get(card.name);
    const type = (visual?.typeLine ?? "").toLowerCase();
    const text = (visual?.oracleText ?? "").toLowerCase();
    const known = Boolean(type || text || BASIC.test(card.name));
    if (!known) continue;
    loaded += card.quantity;

    const land = isLand(card.name, type);
    if (land) counts.lands += card.quantity;
    if (isRamp(text, land)) counts.ramp += card.quantity;
    if (isDraw(text)) counts.draw += card.quantity;
    if (isWipe(text)) counts.wipes += card.quantity;
    else if (isRemoval(text)) counts.removal += card.quantity;
    if (isProtection(text)) counts.protection += card.quantity;

    for (const color of producedColors(card.name, type, text, identity)) {
      sources[color] += card.quantity;
    }
    if (!land && visual?.manaCost) addPips(visual.manaCost, pips);
  }

  const colors = (["W", "U", "B", "R", "G"] as const).filter(
    (color) => identity.includes(color) || pips[color] > 0 || sources[color] > 0,
  );

  return {
    roles: (Object.keys(ROLE_LABELS) as RoleKey[]).map((key) => ({
      key,
      label: ROLE_LABELS[key],
      count: counts[key],
    })),
    pips: colors.map((color) => ({
      color,
      pips: pips[color],
      sources: sources[color],
      thin: thinSource(pips[color], sources[color]),
    })),
    loaded,
    total,
  };
}

/** Short observations. Empty when the list is in a normal range, or when text has barely loaded. */
export function weakSlotLines(roles: DeckRoles): string[] {
  if (roles.total > 0 && roles.loaded < roles.total * 0.6) {
    return ["Card text is still loading, so the job counts are incomplete."];
  }
  const count = (key: RoleKey) => roles.roles.find((role) => role.key === key)?.count ?? 0;
  const lines: string[] = [];
  const lands = count("lands");
  const ramp = count("ramp");
  const draw = count("draw");
  const removal = count("removal");
  const wipes = count("wipes");
  if (lands > 0 && lands < 34) lines.push(`Lands are light at ${lands}. A Commander list often sits in the mid 30s.`);
  if (ramp < 7) lines.push(`Ramp is light at ${ramp}.`);
  if (draw < 7) lines.push(`Card draw is light at ${draw}.`);
  if (removal < 5) lines.push(`Single-target removal is light at ${removal}.`);
  if (wipes === 0) lines.push("No board wipe turned up in the card text.");
  for (const pip of roles.pips) {
    if (!pip.thin) continue;
    lines.push(
      `${COLOR_NAME[pip.color]} asks for ${pip.pips} pips and the list has ${pip.sources} sources of it.`,
    );
  }
  return lines;
}

export function colorLabel(color: ColorIdentity): string {
  return COLOR_NAME[color];
}
