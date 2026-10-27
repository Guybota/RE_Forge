import catalog from "@/data/precons.json";
import type { ColorIdentity, Deck, DeckCard } from "@/lib/types";

export type PreconCard = { name: string; quantity: number };

export type Precon = {
  id: string;
  name: string;
  setCode: string;
  setName: string;
  releaseDate: string;
  commanders: PreconCard[];
  colorIdentity: ColorIdentity[];
  cards: PreconCard[];
};

const PRECONS = catalog as Precon[];

export function listPrecons(): readonly Precon[] {
  return PRECONS;
}

export function preconDeckId(precon: Precon): string {
  return `precon-${precon.id}`;
}

export function findPrecon(id: string): Precon | undefined {
  const key = decodeURIComponent(id).replace(/^precon-/, "");
  return PRECONS.find((precon) => precon.id === key);
}

export function preconYear(precon: Precon): string {
  return precon.releaseDate.slice(0, 4);
}

export function preconToDeck(precon: Precon): Deck {
  const stamp = `${precon.releaseDate}T00:00:00.000Z`;
  const line = (card: PreconCard, zone: "command" | "main"): DeckCard => ({
    name: card.name,
    quantity: card.quantity,
    zone,
  });
  return {
    id: preconDeckId(precon),
    name: precon.name,
    commanders: precon.commanders.map((card) => line(card, "command")),
    cards: precon.cards.map((card) => line(card, "main")),
    format: "commander",
    colorIdentity: precon.colorIdentity,
    tags: ["precon", precon.setCode],
    notes: `Official ${precon.setName} precon, ${preconYear(precon)}.`,
    createdAt: stamp,
    updatedAt: stamp,
    source: "import",
  };
}
