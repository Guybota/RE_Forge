import type { EdhrecCombo, EdhrecCommanderCombos } from "./edhrec-combos";

type SpellbookTemplate = {
  name: string;
  scryfallQuery: string;
};

const cache = new Map<number, SpellbookTemplate | null>();

/** Template ids live after the card ids: 628-2034--5, or 628-2034--5-12. */
export function templateIdsFromCombo(combo: Pick<EdhrecCombo, "id" | "href">): number[] {
  const source = `${combo.href} ${combo.id}`;
  const match = source.match(/--(\d+(?:-\d+)*)(?:\s|$)/);
  if (!match) return [];
  return match[1]
    .split("-")
    .map((part) => Number(part))
    .filter((id) => Number.isInteger(id) && id > 0);
}

/** "Persist Creature" becomes "Any creature with Persist". */
export function anyPieceLabel(name: string): string {
  const trimmed = name.trim().replace(/\s+/g, " ");
  const keywordCreature = trimmed.match(/^([A-Za-z][\w'-]*) Creature$/);
  if (keywordCreature) return `Any creature with ${keywordCreature[1]}`;
  return `Any ${trimmed.charAt(0).toLowerCase()}${trimmed.slice(1)}`;
}

function isCardPiece(template: SpellbookTemplate): boolean {
  const query = template.scryfallQuery;
  if (/\bt:(creature|artifact|enchantment|instant|sorcery|planeswalker|land|equipment|aura)\b/i.test(query)) {
    return true;
  }
  return /\b(creature|artifact|enchantment|equipment|instant|sorcery|planeswalker|aura|land)\b/i.test(
    template.name,
  );
}

async function loadTemplate(id: number): Promise<SpellbookTemplate | null> {
  if (cache.has(id)) return cache.get(id) ?? null;
  try {
    const res = await fetch(`https://backend.commanderspellbook.com/templates/${id}/`, {
      headers: {
        Accept: "application/json",
        "User-Agent": "MTG-Central/1.0",
      },
      cache: "no-store",
    });
    if (!res.ok) {
      cache.set(id, null);
      return null;
    }
    const json = (await res.json()) as { name?: string; scryfallQuery?: string };
    const name = json.name?.trim() ?? "";
    if (!name) {
      cache.set(id, null);
      return null;
    }
    const template = { name, scryfallQuery: json.scryfallQuery ?? "" };
    cache.set(id, template);
    return template;
  } catch {
    return null;
  }
}

/** Fill combo.pieces from the template ids already in the EDHREC combo link. */
export async function attachComboPieces(group: EdhrecCommanderCombos): Promise<EdhrecCommanderCombos> {
  const ids = new Set<number>();
  for (const combo of group.combos) {
    for (const id of templateIdsFromCombo(combo)) ids.add(id);
  }
  const loaded = new Map<number, SpellbookTemplate | null>();
  await Promise.all(
    [...ids].map(async (id) => {
      loaded.set(id, await loadTemplate(id));
    }),
  );

  return {
    ...group,
    combos: group.combos.map((combo) => {
      const pieces = templateIdsFromCombo(combo).flatMap((id) => {
        const template = loaded.get(id);
        if (!template || !isCardPiece(template)) return [];
        return [{ label: anyPieceLabel(template.name) }];
      });
      return { ...combo, pieces };
    }),
  };
}
