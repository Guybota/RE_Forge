import type { Deck } from "./types";
import type { CardVisual } from "./scryfall";

export type DeckStats = {
  landCount: number;
  averageCmc: number | null;
  curve: { mv: number; count: number }[];
  typeCounts: { key: string; label: string; count: number }[];
  colorIdentity: string[];
  cardsWithCmc: number;
};

function typeKey(typeLine?: string): string {
  if (!typeLine) return "other";
  const t = typeLine.toLowerCase();
  if (t.includes("creature")) return "creature";
  if (t.includes("planeswalker")) return "planeswalker";
  if (t.includes("instant")) return "instant";
  if (t.includes("sorcery")) return "sorcery";
  if (t.includes("land")) return "land";
  if (t.includes("artifact")) return "artifact";
  if (t.includes("enchantment")) return "enchantment";
  if (t.includes("battle")) return "battle";
  return "other";
}

const TYPE_LABELS: Record<string, string> = {
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

export function computeDeckStats(
  deck: Deck,
  get: (name: string) => CardVisual | undefined,
): DeckStats {
  const main = deck.cards;
  const colors = new Set<string>();
  for (const c of deck.commanders) {
    for (const col of get(c.name)?.colorIdentity ?? deck.colorIdentity ?? []) {
      colors.add(col);
    }
  }

  const curveMap = new Map<number, number>();
  const typeMap = new Map<string, number>();
  let landCount = 0;
  let cmcSum = 0;
  let cardsWithCmc = 0;

  for (const card of main) {
    const v = get(card.name);
    const key = typeKey(v?.typeLine);
    typeMap.set(key, (typeMap.get(key) ?? 0) + card.quantity);
    if (key === "land") landCount += card.quantity;

    if (v?.cmc != null && Number.isFinite(v.cmc) && key !== "land") {
      const mv = Math.min(7, Math.floor(v.cmc));
      curveMap.set(mv, (curveMap.get(mv) ?? 0) + card.quantity);
      cmcSum += v.cmc * card.quantity;
      cardsWithCmc += card.quantity;
    }
  }

  const curve = Array.from({ length: 8 }, (_, mv) => ({
    mv,
    count: curveMap.get(mv) ?? 0,
  }));

  const typeOrder = [
    "creature",
    "planeswalker",
    "instant",
    "sorcery",
    "artifact",
    "enchantment",
    "battle",
    "land",
    "other",
  ];

  return {
    landCount,
    averageCmc: cardsWithCmc > 0 ? cmcSum / cardsWithCmc : null,
    curve,
    typeCounts: typeOrder
      .filter((k) => (typeMap.get(k) ?? 0) > 0)
      .map((k) => ({ key: k, label: TYPE_LABELS[k] ?? k, count: typeMap.get(k)! })),
    colorIdentity: Array.from(colors),
    cardsWithCmc,
  };
}
