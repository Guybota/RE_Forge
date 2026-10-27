"use client";

import { useCallback, useSyncExternalStore } from "react";
import { v4 as uuidv4 } from "uuid";
import type { Deck, DeckLibrary } from "@/lib/types";
import {
  deleteDeck as removeDeck,
  emptyLibrary,
  exportLibraryJson,
  importLibraryJson,
  libraryWithSeeds,
  ensurePlanTags,
  markDeckOpened,
  readLibrary,
  tryRecoverRaw,
  upsertDeck,
  writeLibrary,
  type ImportLibraryResult,
} from "@/lib/storage";

type LibraryState =
  | { status: "loading" }
  | { status: "ready"; library: DeckLibrary }
  | { status: "error"; message: string; raw: string | null };

let cache: LibraryState = { status: "loading" };
const listeners = new Set<() => void>();

function emit() {
  listeners.forEach((l) => l());
}

function ensureHydrated(): LibraryState {
  if (cache.status !== "loading") return cache;
  if (typeof window === "undefined") return cache;
  try {
    cache = { status: "ready", library: readLibrary() };
  } catch (err) {
    cache = {
      status: "error",
      message: err instanceof Error ? err.message : "Storage error",
      raw: tryRecoverRaw(),
    };
  }
  return cache;
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

function getSnapshot(): LibraryState {
  return ensureHydrated();
}

const SERVER_SNAPSHOT: LibraryState = { status: "loading" };

function getServerSnapshot(): LibraryState {
  return SERVER_SNAPSHOT;
}

function setLibraryState(next: LibraryState) {
  cache = next;
  emit();
}

export function useDeckLibrary() {
  const state = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);

  const persist = useCallback((library: DeckLibrary) => {
    try {
      writeLibrary(library);
      setLibraryState({ status: "ready", library });
    } catch {
      setLibraryState({
        status: "error",
        message: "Could not save - storage quota may be full.",
        raw: tryRecoverRaw(),
      });
    }
  }, []);

  const saveDeck = useCallback(
    (deck: Deck) => {
      if (state.status !== "ready") return;
      const next = upsertDeck(state.library, {
        ...deck,
        updatedAt: new Date().toISOString(),
      });
      persist(next);
    },
    [persist, state],
  );

  const createDeck = useCallback(
    (partial: Omit<Deck, "id" | "createdAt" | "updatedAt" | "format">) => {
      if (state.status !== "ready") return null;
      const now = new Date().toISOString();
      const deck: Deck = {
        ...partial,
        id: uuidv4(),
        format: "commander",
        createdAt: now,
        updatedAt: now,
      };
      persist(upsertDeck(state.library, deck));
      return deck;
    },
    [persist, state],
  );

  const deleteDeck = useCallback(
    (id: string) => {
      if (state.status !== "ready") return;
      persist(removeDeck(state.library, id));
    },
    [persist, state],
  );

  const resetLibrary = useCallback(() => {
    persist(libraryWithSeeds());
  }, [persist]);

  const clearLibrary = useCallback(() => {
    persist(emptyLibrary());
  }, [persist]);

  const exportJson = useCallback(() => {
    if (state.status !== "ready") return null;
    return exportLibraryJson(state.library);
  }, [state]);

  const importJson = useCallback(
    (raw: string): ImportLibraryResult => {
      if (state.status !== "ready") {
        return { ok: false, error: "Library is not ready." };
      }
      const result = importLibraryJson(state.library, raw);
      if (result.ok) persist(result.library);
      return result;
    },
    [persist, state],
  );

  const ensureDeckPlanTags = useCallback(() => {
    if (state.status !== "ready") return;
    const next = ensurePlanTags(state.library);
    if (next !== state.library) persist(next);
  }, [persist, state]);

  const markOpened = useCallback(
    (id: string) => {
      if (state.status !== "ready") return;
      const next = markDeckOpened(state.library, id);
      if (next !== state.library) persist(next);
    },
    [persist, state],
  );

  return {
    state,
    decks: state.status === "ready" ? state.library.decks : [],
    lastOpenedDeckId: state.status === "ready" ? state.library.lastOpenedDeckId : undefined,
    saveDeck,
    createDeck,
    deleteDeck,
    resetLibrary,
    clearLibrary,
    exportJson,
    importJson,
    markOpened,
    ensureDeckPlanTags,
  };
}
