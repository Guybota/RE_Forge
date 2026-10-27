import type { CardVisual } from "./cardVisual.ts";
import type { DeckCard } from "./types.ts";

export type CardGroup = {
  key: string;
  label: string;
  cards: DeckCard[];
};

const ORDER = [
  "commander",
  "planeswalker",
  "creature",
  "instant",
  "sorcery",
  "artifact",
  "enchantment",
  "battle",
  "land",
  "other",
] as const;

function bucketFromTypeLine(typeLine?: string): (typeof ORDER)[number] {
  if (!typeLine) return "other";
  const t = typeLine.toLowerCase();
  // Planeswalkers before creatures (gallery order: commander → PW → creatures).
  if (t.includes("planeswalker")) return "planeswalker";
  if (t.includes("creature")) return "creature";
  if (t.includes("instant")) return "instant";
  if (t.includes("sorcery")) return "sorcery";
  if (t.includes("artifact") && t.includes("land")) return "land";
  if (t.includes("land")) return "land";
  if (t.includes("artifact")) return "artifact";
  if (t.includes("enchantment")) return "enchantment";
  if (t.includes("battle")) return "battle";
  return "other";
}

const LABELS: Record<(typeof ORDER)[number], string> = {
  commander: "Commander",
  creature: "Creatures",
  planeswalker: "Planeswalkers",
  instant: "Instants",
  sorcery: "Sorceries",
  artifact: "Artifacts",
  enchantment: "Enchantments",
  battle: "Battles",
  land: "Lands",
  other: "Other",
};

export function groupDeckCards(
  cards: DeckCard[],
  getVisual: (name: string) => CardVisual | undefined,
  commanders: DeckCard[] = [],
): CardGroup[] {
  const buckets = new Map<(typeof ORDER)[number], DeckCard[]>();
  for (const key of ORDER) buckets.set(key, []);

  if (commanders.length) {
    buckets.get("commander")!.push(...commanders);
  }

  for (const card of cards) {
    const visual = getVisual(card.name);
    const key = bucketFromTypeLine(visual?.typeLine);
    buckets.get(key)!.push(card);
  }

  for (const list of buckets.values()) {
    list.sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: "base" }));
  }

  return ORDER.filter((key) => (buckets.get(key)?.length ?? 0) > 0).map((key) => ({
    key,
    label: LABELS[key],
    cards: buckets.get(key)!,
  }));
}
