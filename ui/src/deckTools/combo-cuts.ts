import { cardJobs, readDeckRoles, type RoleKey } from "./deck-roles.ts";
import { isGameChanger } from "./game-changers.ts";
import { canonicalizeName } from "./parse-decklist.ts";
import type { CardVisual } from "./cardVisual.ts";
import type { ColorIdentity, Deck } from "./types.ts";

export type ComboCut = {
  name: string;
  reason: string;
};

const BASIC = /^(snow-covered )?(plains|island|swamp|mountain|forest|wastes)$/i;

const SURPLUS: Record<RoleKey, number> = {
  lands: 40,
  ramp: 10,
  draw: 12,
  removal: 9,
  wipes: 2,
  protection: 5,
};

const JOB_WORD: Record<RoleKey, string> = {
  lands: "lands",
  ramp: "ramp",
  draw: "card draw",
  removal: "removal",
  wipes: "board wipes",
  protection: "protection",
};

function subtypes(typeLine: string | undefined): string[] {
  if (!typeLine) return [];
  const tail = typeLine.split(/—| - /)[1] ?? "";
  return tail
    .split(/\/\//)
    .flatMap((part) => part.split(/\s+/))
    .map((part) => part.trim())
    .filter((part) => part.length > 1);
}

function outsideColors(visual: CardVisual | undefined, identity: ColorIdentity[]): boolean {
  const colors = visual?.colorIdentity ?? [];
  if (colors.length === 0 || identity.length === 0) return false;
  return colors.some((color) => !identity.includes(color as ColorIdentity));
}

/**
 * Main-deck cards that are easier to take out for a combo, best suggestion first.
 * Commanders, basics, and the combo's own cards are left out.
 */
export function rankComboCuts(
  deck: Deck,
  get: (name: string) => CardVisual | undefined,
  keepNames: string[],
): ComboCut[] {
  const keep = new Set(keepNames.map((name) => canonicalizeName(name)));
  for (const commander of deck.commanders) keep.add(canonicalizeName(commander.name));

  const roles = readDeckRoles(deck, get);
  const countOf = (key: RoleKey) => roles.roles.find((role) => role.key === key)?.count ?? 0;
  const commanderTypes = new Set(
    deck.commanders.flatMap((commander) => subtypes(get(commander.name)?.typeLine)),
  );
  const identity = (deck.colorIdentity ?? []) as ColorIdentity[];

  const ranked: { name: string; score: number; reason: string }[] = [];

  for (const card of deck.cards) {
    const key = canonicalizeName(card.name);
    if (!key || keep.has(key) || BASIC.test(card.name)) continue;
    if (ranked.some((item) => canonicalizeName(item.name) === key)) continue;

    const visual = get(card.name);
    const jobs = cardJobs(card.name, visual);
    const sharesType = subtypes(visual?.typeLine).some((type) => commanderTypes.has(type));
    const mv = visual?.cmc ?? null;
    let score = 0;
    let reason = "A spare slot. Nothing else in the list is a clearer cut.";

    if (outsideColors(visual, identity)) {
      score += 80;
      reason = "It sits outside the commander's colors.";
    } else if (isGameChanger(card.name)) {
      score -= 40;
      reason = "It is a Game Changer, so taking it out also changes the bracket.";
    } else {
      const surplusJob = jobs.find((job) => job !== "lands" && countOf(job) >= SURPLUS[job]);
      const onlyThin =
        (jobs.includes("wipes") && countOf("wipes") <= 1) ||
        (jobs.includes("ramp") && countOf("ramp") < 7) ||
        (jobs.includes("draw") && countOf("draw") < 7) ||
        (jobs.includes("removal") && countOf("removal") < 5);
      if (surplusJob) {
        score += 18;
        reason = `The list already has plenty of ${JOB_WORD[surplusJob]}.`;
      } else if (mv != null && mv >= 6 && !sharesType) {
        score += 12;
        reason = "It is a high mana value card that does not share the commander's types.";
      } else if (!sharesType && jobs.length === 0 && !visual?.typeLine?.toLowerCase().includes("land")) {
        score += 8;
        reason = "It does not share the commander's types, and it is not holding up a thin job.";
      }
      if (sharesType) score -= 20;
      if (jobs.includes("lands")) score -= 30;
      if (onlyThin) score -= 25;
    }

    ranked.push({ name: card.name, score, reason });
  }

  ranked.sort((a, b) => b.score - a.score || a.name.localeCompare(b.name));
  return ranked.map(({ name, reason }) => ({ name, reason }));
}
