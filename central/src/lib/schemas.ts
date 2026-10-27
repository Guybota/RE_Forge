import { z } from "zod";

export const deckCardSchema = z.object({
  oracleId: z.string().optional(),
  scryfallId: z.string().optional(),
  setCode: z.string().optional(),
  name: z.string().min(1),
  quantity: z.number().int().min(1),
  zone: z.enum(["command", "main", "sideboard"]).optional(),
});

export const deckSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  commanders: z.array(deckCardSchema),
  cards: z.array(deckCardSchema),
  sideboard: z.array(deckCardSchema).optional(),
  format: z.literal("commander"),
  colorIdentity: z.array(z.enum(["W", "U", "B", "R", "G"])).optional(),
  bracketIntent: z.union([z.literal(1), z.literal(2), z.literal(3), z.literal(4), z.literal(5)]).optional(),
  calculatedBracket: z.union([z.literal(1), z.literal(2), z.literal(3), z.literal(4), z.literal(5)]).optional(),
  notes: z.string().optional(),
  tags: z.array(z.string()).optional(),
  createdAt: z.string(),
  updatedAt: z.string(),
  source: z.enum(["manual", "paste", "import", "seed"]).optional(),
});

export const deckLibrarySchema = z.object({
  version: z.literal(1),
  decks: z.array(deckSchema),
  lastOpenedDeckId: z.string().optional(),
});
