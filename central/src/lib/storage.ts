import { z } from "zod";
import { deckPlans } from "./improve-adapt";
import { deckLibrarySchema, deckSchema } from "./schemas";
import { createSeedDecks } from "./seed-decks";
import type { Deck, DeckLibrary } from "./types";

export const STORAGE_KEY = "mtg-central-deck-library:v1";

export function emptyLibrary(): DeckLibrary {
  return { version: 1, decks: [] };
}

export function libraryWithSeeds(): DeckLibrary {
  const seeds = createSeedDecks();
  return {
    version: 1,
    decks: seeds,
    lastOpenedDeckId: seeds[0]?.id,
  };
}

export function readLibrary(): DeckLibrary {
  if (typeof window === "undefined") return emptyLibrary();
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) {
      const seeded = ensurePlanTags(libraryWithSeeds());
      writeLibrary(seeded);
      return seeded;
    }
    const parsed = JSON.parse(raw) as unknown;
    const result = deckLibrarySchema.safeParse(parsed);
    if (!result.success) {
      throw new Error("Corrupt deck library");
    }
    return ensurePlanTags(ensureSeedTags(result.data));
  } catch {
    throw new Error("Failed to read local deck library");
  }
}

export function writeLibrary(library: DeckLibrary): void {
  if (typeof window === "undefined") return;
  const payload = JSON.stringify(library);
  window.localStorage.setItem(STORAGE_KEY, payload);
}

export function upsertDeck(library: DeckLibrary, deck: Deck): DeckLibrary {
  const idx = library.decks.findIndex((d) => d.id === deck.id);
  const decks = [...library.decks];
  if (idx >= 0) decks[idx] = deck;
  else decks.unshift(deck);
  return {
    ...library,
    decks,
    lastOpenedDeckId: deck.id,
  };
}

export function deleteDeck(library: DeckLibrary, id: string): DeckLibrary {
  const decks = library.decks.filter((d) => d.id !== id);
  return {
    ...library,
    decks,
    lastOpenedDeckId:
      library.lastOpenedDeckId === id ? decks[0]?.id : library.lastOpenedDeckId,
  };
}

/** Keep seed Angel decks tagged for My Decks filter even on older local libraries. */
function ensureSeedTags(library: DeckLibrary): DeckLibrary {
  let changed = false;
  const decks = library.decks.map((deck) => {
    if (deck.id === "seed-giada-precon") {
      const want = ["angels", "precon"];
      if (!want.every((t) => (deck.tags ?? []).includes(t))) {
        changed = true;
        const tags = Array.from(new Set([...(deck.tags ?? []), ...want, "seed"]));
        return { ...deck, tags };
      }
    }
    if (deck.id === "seed-bruna-upgraded") {
      const want = ["angels", "upgraded"];
      if (!want.every((t) => (deck.tags ?? []).includes(t))) {
        changed = true;
        const tags = Array.from(new Set([...(deck.tags ?? []), ...want, "seed"]));
        return { ...deck, tags };
      }
    }
    return deck;
  });
  if (!changed) return library;
  const next = { ...library, decks };
  try {
    writeLibrary(next);
  } catch {
    // ignore
  }
  return next;
}

/** Add missing game-plan tags (angels, lifegain, +1/+1 counters, and the rest) without restamping the deck. */
export function ensurePlanTags(library: DeckLibrary): DeckLibrary {
  let changed = false;
  const decks = library.decks.map((deck) => {
    const want = deckPlans(deck).map((plan) => plan.tag);
    const have = new Set((deck.tags ?? []).map((tag) => tag.toLowerCase()));
    const add = want.filter((tag) => !have.has(tag.toLowerCase()));
    if (!add.length) return deck;
    changed = true;
    return { ...deck, tags: [...(deck.tags ?? []), ...add] };
  });
  if (!changed) return library;
  const next = { ...library, decks };
  try {
    writeLibrary(next);
  } catch {
    // ignore
  }
  return next;
}

export function markDeckOpened(library: DeckLibrary, id: string): DeckLibrary {
  if (library.lastOpenedDeckId === id) return library;
  if (!library.decks.some((deck) => deck.id === id)) return library;
  return { ...library, lastOpenedDeckId: id };
}

export function exportLibraryJson(library: DeckLibrary): string {
  return JSON.stringify(library, null, 2);
}

export type ImportLibraryResult =
  | { ok: true; library: DeckLibrary; added: number; updated: number }
  | { ok: false; error: string };

/** Merge a library export, a deck array, or one deck into the current library. Same ids are replaced. */
export function importLibraryJson(current: DeckLibrary, raw: string): ImportLibraryResult {
  let data: unknown;
  try {
    data = JSON.parse(raw) as unknown;
  } catch {
    return { ok: false, error: "That file is not valid JSON." };
  }

  const incoming = coerceDecks(data);
  if (!incoming) {
    return { ok: false, error: "JSON does not look like an MTG Central library or deck." };
  }
  if (incoming.length === 0) {
    return { ok: false, error: "That file has no decks." };
  }

  const existingIds = new Set(current.decks.map((deck) => deck.id));
  const seenFresh = new Set<string>();
  const seenUpdated = new Set<string>();
  const byId = new Map(current.decks.map((deck) => [deck.id, deck]));
  for (const deck of incoming) {
    if (existingIds.has(deck.id)) seenUpdated.add(deck.id);
    else seenFresh.add(deck.id);
    byId.set(deck.id, deck);
  }
  const added = seenFresh.size;
  const updated = seenUpdated.size;

  const kept = current.decks.map((deck) => byId.get(deck.id) ?? deck);
  const freshDecks = [...seenFresh].map((id) => byId.get(id)!);
  return {
    ok: true,
    added,
    updated,
    library: { ...current, decks: [...freshDecks, ...kept] },
  };
}

function coerceDecks(data: unknown): Deck[] | null {
  const lib = deckLibrarySchema.safeParse(data);
  if (lib.success) return lib.data.decks;

  const wrapped = z.object({ decks: z.array(deckSchema) }).safeParse(data);
  if (wrapped.success) return wrapped.data.decks;

  if (Array.isArray(data)) {
    const arr = z.array(deckSchema).safeParse(data);
    return arr.success ? arr.data : null;
  }

  const one = deckSchema.safeParse(data);
  return one.success ? [one.data] : null;
}

export function tryRecoverRaw(): string | null {
  if (typeof window === "undefined") return null;
  return window.localStorage.getItem(STORAGE_KEY);
}
