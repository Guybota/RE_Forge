export type EdhrecComboPiece = {
  /** A role, not a specific card. For example "Any creature with Persist". */
  label: string;
};

export type EdhrecCombo = {
  id: string;
  cardNames: string[];
  results: string[];
  decks: number;
  href: string;
  commander: string;
  /** Extra pieces that are a kind of card, not one named card. */
  pieces: EdhrecComboPiece[];
};

export type EdhrecCommanderCombos = {
  name: string;
  total: number;
  url: string;
  combos: EdhrecCombo[];
};

export type EdhrecComboExplanation = {
  prerequisites: string[];
  steps: string[];
};

export type EdhrecComboExplanationResult =
  | ({ ok: true } & EdhrecComboExplanation)
  | { ok: false; error: string };

export type EdhrecComboResult =
  | { ok: true; commanders: EdhrecCommanderCombos[] }
  | { ok: false; error: string };

/** How many combos to show before See more. */
export const EDHREC_COMBO_PAGE = 12;

/** /combos/mono-black/628-2034 or the same id with a template suffix, 628-2034--5. */
const COMBO_PATH = /^\/combos\/[a-z0-9-]+\/[0-9]+(?:-[0-9]+)+(?:--[0-9]+)?$/;

type EdhrecCardList = {
  href?: string;
  combo?: {
    comboId?: string;
    count?: number;
    results?: string[];
  };
  cardviews?: { name?: string }[];
};

type EdhrecComboPage = {
  header?: string;
  container?: {
    json_dict?: {
      cardlists?: EdhrecCardList[];
    };
  };
};

/** EDHREC commander slugs: lowercase, punctuation dropped, words joined by hyphens. */
export function edhrecCommanderSlug(name: string): string {
  return name
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/['’]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

export function parseEdhrecComboPage(commander: string, json: unknown): EdhrecCommanderCombos {
  const page = (json ?? {}) as EdhrecComboPage;
  const slug = edhrecCommanderSlug(commander);
  const header = page.header ?? "";
  const totalMatch = header.match(/\(([\d,]+)\s+Combos\)/i);
  const lists = page.container?.json_dict?.cardlists ?? [];
  const total = totalMatch
    ? Number(totalMatch[1].replace(/,/g, ""))
    : lists.length;

  const combos: EdhrecCombo[] = [];
  for (const list of lists) {
    const cardNames = (list.cardviews ?? [])
      .map((card) => card.name?.trim() ?? "")
      .filter(Boolean);
    if (cardNames.length === 0) continue;
    const id = list.combo?.comboId ?? list.href ?? cardNames.join("+");
    combos.push({
      id,
      cardNames,
      results: (list.combo?.results ?? []).filter(Boolean).slice(0, 4),
      decks: list.combo?.count ?? 0,
      href: list.href ? `https://edhrec.com${list.href}` : `https://edhrec.com/combos/${slug}`,
      commander,
      pieces: [],
    });
  }

  return {
    name: commander,
    total: Number.isFinite(total) ? total : combos.length,
    url: `https://edhrec.com/combos/${slug}`,
    combos,
  };
}

/** Path of one combo on EDHREC, or null when the link is not a combo page. */
export function edhrecComboPath(href: string): string | null {
  let pathname = href;
  try {
    pathname = new URL(href, "https://edhrec.com").pathname;
  } catch {
    return null;
  }
  if (!COMBO_PATH.test(pathname)) return null;
  return pathname;
}

function explanationLines(text: string): string[] {
  return text
    .split(/\n+/)
    .map((line) => line.trim())
    .filter(Boolean);
}

/** Prerequisites and steps from one EDHREC combo page. */
export function parseEdhrecComboDetail(json: unknown): EdhrecComboExplanation | null {
  const combo = (json as { combo?: { prerequisites?: { description?: string }[]; steps?: unknown } } | null)
    ?.combo;
  if (!combo) return null;
  const prerequisites = (combo.prerequisites ?? []).flatMap((item) =>
    explanationLines(item.description ?? ""),
  );
  const steps = Array.isArray(combo.steps)
    ? combo.steps.flatMap((step) => (typeof step === "string" ? explanationLines(step) : []))
    : [];
  if (prerequisites.length === 0 && steps.length === 0) return null;
  return { prerequisites, steps };
}

const explanationCache = new Map<string, EdhrecComboExplanation>();

/** How this combo plays, from its EDHREC page. */
export async function findEdhrecComboExplanation(href: string): Promise<EdhrecComboExplanationResult> {
  const path = edhrecComboPath(href);
  if (!path) return { ok: false, error: "This combo has no EDHREC page." };
  const cached = explanationCache.get(path);
  if (cached) return { ok: true, ...cached };

  try {
    const res = await fetch(`/api/edhrec-combo?path=${encodeURIComponent(path)}`, {
      headers: { Accept: "application/json" },
    });
    const json = (await res.json()) as EdhrecComboExplanationResult & { error?: string };
    if (!res.ok || !("ok" in json) || json.ok !== true) {
      return {
        ok: false,
        error: json.error || `EDHREC returned HTTP ${res.status}. Try again later.`,
      };
    }
    explanationCache.set(path, {
      prerequisites: json.prerequisites,
      steps: json.steps,
    });
    return json;
  } catch (err) {
    return {
      ok: false,
      error:
        err instanceof Error
          ? `Could not reach EDHREC: ${err.message}`
          : "Could not reach EDHREC.",
    };
  }
}

/** Combos from each commander's EDHREC combo tab. */
export async function findEdhrecCombos(commanders: string[]): Promise<EdhrecComboResult> {
  const names = commanders.map((name) => name.trim()).filter(Boolean);
  if (names.length === 0) {
    return { ok: false, error: "This deck has no commander to look up." };
  }

  const params = new URLSearchParams();
  for (const name of names) params.append("commander", name);

  try {
    const res = await fetch(`/api/edhrec-combos?${params.toString()}`, {
      headers: { Accept: "application/json" },
    });
    const json = (await res.json()) as EdhrecComboResult & { error?: string };
    if (!res.ok || !("ok" in json) || json.ok !== true) {
      return {
        ok: false,
        error: json.error || `EDHREC returned HTTP ${res.status}. Try again later.`,
      };
    }
    return json;
  } catch (err) {
    return {
      ok: false,
      error:
        err instanceof Error
          ? `Could not reach EDHREC: ${err.message}`
          : "Could not reach EDHREC.",
    };
  }
}
