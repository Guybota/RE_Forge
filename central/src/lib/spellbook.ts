import type { Deck } from "./types";

export type SpellbookCombo = {
  id: string;
  cardNames: string[];
  description?: string;
  produce?: string[];
};

export type SpellbookResult =
  | { ok: true; combos: SpellbookCombo[] }
  | { ok: false; error: string };

type SpellbookCardUse = {
  card?: { name?: string };
  quantity?: number;
};

type SpellbookVariant = {
  id?: string;
  uses?: SpellbookCardUse[];
  produces?: Array<{ feature?: { name?: string }; quantity?: number }>;
  description?: string;
  easy?: boolean;
};

/**
 * Find combos in a deck via the public Commander Spellbook API.
 * Honest failure — never invents combos.
 */
export async function findCombosInDeck(deck: Deck): Promise<SpellbookResult> {
  const main = deck.cards.map((c) => ({ card: c.name }));
  const commanders = deck.commanders.map((c) => ({ card: c.name }));

  try {
    const res = await fetch("/api/combos", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json",
      },
      body: JSON.stringify({ main, commanders }),
    });

    if (!res.ok) {
      return {
        ok: false,
        error: `Commander Spellbook returned HTTP ${res.status}. Try again later.`,
      };
    }

    const json = (await res.json()) as {
      results?: { included?: SpellbookVariant[] };
    };
    const included = json.results?.included ?? [];
    const combos: SpellbookCombo[] = included.slice(0, 24).map((v, i) => {
      const cardNames = (v.uses ?? [])
        .map((u) => u.card?.name)
        .filter((n): n is string => Boolean(n));
      const produce = (v.produces ?? [])
        .map((p) => p.feature?.name)
        .filter((n): n is string => Boolean(n));
      return {
        id: v.id ?? `combo-${i}`,
        cardNames,
        description: produce.length ? produce.slice(0, 4).join(" · ") : undefined,
        produce,
      };
    });

    return { ok: true, combos };
  } catch (err) {
    return {
      ok: false,
      error:
        err instanceof Error
          ? `Could not reach Commander Spellbook: ${err.message}`
          : "Could not reach Commander Spellbook.",
    };
  }
}
