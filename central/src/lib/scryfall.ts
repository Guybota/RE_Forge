import { canonicalizeName } from "./parse-decklist";

export type CardVisual = {
  name: string;
  artCrop?: string;
  small?: string;
  normal?: string;
  large?: string;
  manaCost?: string;
  typeLine?: string;
  oracleText?: string;
  scryfallId?: string;
  oracleId?: string;
  setCode?: string;
  /** Converted mana cost / mana value from Scryfall `cmc`. */
  cmc?: number | null;
  /** Color identity letters, e.g. ["W","U"]. */
  colorIdentity?: string[];
  /** Scryfall `legalities.commander` — legal | not_legal | banned | restricted | … */
  commanderLegality?: string | null;
  /** Cardmarket EUR from Scryfall `prices.eur` (non-foil). null = known missing. */
  eur?: number | null;
  /** Cheapest non-foil EUR across printings (filled on demand). */
  cheapestEur?: number | null;
  cheapestSet?: string | null;
  cheapestScryfallId?: string | null;
  failed?: boolean;
};

type CacheFile = {
  version: 4;
  cards: Record<string, CardVisual>;
};

type ScryfallCard = {
  id?: string;
  oracle_id?: string;
  name?: string;
  mana_cost?: string;
  type_line?: string;
  oracle_text?: string;
  set?: string;
  set_name?: string;
  rarity?: string;
  cmc?: number;
  color_identity?: string[];
  legalities?: { commander?: string };
  prices?: {
    eur?: string | null;
    eur_foil?: string | null;
    usd?: string | null;
  };
  image_uris?: {
    art_crop?: string;
    small?: string;
    normal?: string;
    large?: string;
  };
  card_faces?: Array<{
    image_uris?: {
      art_crop?: string;
      small?: string;
      normal?: string;
      large?: string;
    };
    mana_cost?: string;
    type_line?: string;
    oracle_text?: string;
  }>;
};

const CACHE_KEY = "mtg-central-scryfall-cards:v4";
const LEGACY_KEYS = [
  "mtg-central-scryfall-cards:v3",
  "mtg-central-scryfall-cards:v2",
  "mtg-central-scryfall-images:v1",
];
const memory = new Map<string, CardVisual>();
let persistTimer: ReturnType<typeof setTimeout> | null = null;
let diskLoaded = false;

function parseEur(raw: string | null | undefined): number | null {
  if (raw == null || raw === "") return null;
  const n = Number.parseFloat(raw);
  return Number.isFinite(n) ? n : null;
}

function loadDiskCache(): void {
  if (typeof window === "undefined" || diskLoaded) return;
  diskLoaded = true;
  try {
    const raw = window.localStorage.getItem(CACHE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as CacheFile;
      if (parsed.version === 4 && parsed.cards) {
        for (const [key, value] of Object.entries(parsed.cards)) {
          memory.set(key, value);
        }
      }
    }
    // v3 and older could alias a requested name onto a different card.
    for (const key of LEGACY_KEYS) window.localStorage.removeItem(key);
  } catch {
    // ignore
  }
}

function schedulePersist(): void {
  if (typeof window === "undefined") return;
  if (persistTimer) clearTimeout(persistTimer);
  persistTimer = setTimeout(() => {
    const cards: Record<string, CardVisual> = {};
    for (const [key, value] of memory.entries()) {
      cards[key] = value;
    }
    try {
      window.localStorage.setItem(CACHE_KEY, JSON.stringify({ version: 4, cards }));
    } catch {
      // ignore quota
    }
  }, 400);
}

function pickCard(card: ScryfallCard): CardVisual {
  const face = card.image_uris ?? card.card_faces?.[0]?.image_uris;
  return {
    name: card.name ?? "Unknown",
    artCrop: face?.art_crop,
    small: face?.small,
    normal: face?.normal,
    large: face?.large,
    manaCost: card.mana_cost ?? card.card_faces?.[0]?.mana_cost,
    typeLine: card.type_line ?? card.card_faces?.[0]?.type_line,
    oracleText: card.oracle_text ?? card.card_faces?.map((face) => face.oracle_text).filter(Boolean).join("\n\n"),
    scryfallId: card.id,
    oracleId: card.oracle_id,
    setCode: card.set?.toUpperCase(),
    cmc: typeof card.cmc === "number" ? card.cmc : null,
    colorIdentity: Array.isArray(card.color_identity) ? card.color_identity : [],
    commanderLegality: card.legalities?.commander ?? null,
    eur: parseEur(card.prices?.eur),
  };
}

/** True when a Scryfall printing is the requested card, including either face of a DFC. */
export function cardNamesMatch(requested: string, returned: string): boolean {
  const req = canonicalizeName(requested);
  const got = canonicalizeName(returned);
  if (!req || !got) return false;
  if (req === got) return true;
  const faces = got
    .split(" // ")
    .map((part) => part.trim())
    .filter(Boolean);
  return faces.some((face) => face === req);
}

function storeVisual(keyName: string, visual: CardVisual) {
  memory.set(canonicalizeName(keyName), visual);
  memory.set(canonicalizeName(visual.name), visual);
}

function collectionHit(
  requested: string,
  byCanonical: Map<string, CardVisual>,
): CardVisual | undefined {
  const key = canonicalizeName(requested);
  const exact = byCanonical.get(key);
  if (exact) return exact;
  for (const visual of byCanonical.values()) {
    if (cardNamesMatch(requested, visual.name)) return visual;
  }
  return undefined;
}

function needsFetch(name: string): boolean {
  const cached = memory.get(canonicalizeName(name));
  if (!cached) return true;
  if (cached.failed) return false;
  return cached.eur === undefined || cached.cmc === undefined;
}

async function fetchCollection(names: string[]): Promise<void> {
  const chunks: string[][] = [];
  for (let i = 0; i < names.length; i += 75) {
    chunks.push(names.slice(i, i + 75));
  }

  for (let i = 0; i < chunks.length; i++) {
    const chunk = chunks[i];
    if (i > 0) await new Promise((r) => setTimeout(r, 120));

    try {
      const res = await fetch("https://api.scryfall.com/cards/collection", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          identifiers: chunk.map((name) => ({ name })),
        }),
      });

      if (!res.ok) {
        for (const name of chunk) {
          if (!memory.has(canonicalizeName(name))) {
            storeVisual(name, {
              name,
              failed: true,
              eur: null,
              cmc: null,
              commanderLegality: null,
            });
          }
        }
        schedulePersist();
        continue;
      }

      const json = (await res.json()) as {
        data?: ScryfallCard[];
        not_found?: Array<{ name?: string }>;
      };

      const byCanonical = new Map<string, CardVisual>();
      for (const card of json.data ?? []) {
        const visual = pickCard(card);
        byCanonical.set(canonicalizeName(visual.name), visual);
        storeVisual(visual.name, visual);
      }

      for (const requested of chunk) {
        const key = canonicalizeName(requested);
        const existing = memory.get(key);
        if (existing && !existing.failed && existing.eur !== undefined && existing.cmc !== undefined) {
          continue;
        }
        const hit = collectionHit(requested, byCanonical);
        if (hit) storeVisual(requested, hit);
      }

      for (const miss of json.not_found ?? []) {
        if (!miss.name) continue;
        const key = canonicalizeName(miss.name);
        if (!memory.has(key)) {
          storeVisual(miss.name, {
            name: miss.name,
            failed: true,
            eur: null,
            cmc: null,
            commanderLegality: null,
          });
        }
      }

      for (const requested of chunk) {
        if (!memory.has(canonicalizeName(requested))) {
          storeVisual(requested, {
            name: requested,
            failed: true,
            eur: null,
            cmc: null,
            commanderLegality: null,
          });
        }
      }

      schedulePersist();
    } catch {
      for (const name of chunk) {
        if (!memory.has(canonicalizeName(name))) {
          storeVisual(name, {
            name,
            failed: true,
            eur: null,
            cmc: null,
            commanderLegality: null,
          });
        }
      }
      schedulePersist();
    }
  }
}

async function fuzzyLookup(name: string): Promise<void> {
  try {
    await new Promise((r) => setTimeout(r, 100));
    const res = await fetch(
      `https://api.scryfall.com/cards/named?fuzzy=${encodeURIComponent(name)}`,
    );
    if (!res.ok) return;
    const visual = pickCard((await res.json()) as ScryfallCard);
    if (!cardNamesMatch(name, visual.name)) return;
    storeVisual(name, visual);
    schedulePersist();
  } catch {
    // keep failed
  }
}

/** Resolve card visuals + EUR + cmc/legalities for a list of names. */
export async function resolveCardVisuals(names: string[]): Promise<Map<string, CardVisual>> {
  loadDiskCache();
  const unique = Array.from(new Set(names.map((n) => n.trim()).filter(Boolean)));
  const toFetch = unique.filter((n) => needsFetch(n));

  if (toFetch.length) {
    await fetchCollection(toFetch);
  }

  const failed = unique
    .filter((n) => memory.get(canonicalizeName(n))?.failed)
    .slice(0, 10);

  for (const name of failed) {
    await fuzzyLookup(name);
  }

  const result = new Map<string, CardVisual>();
  for (const name of unique) {
    const key = canonicalizeName(name);
    result.set(
      key,
      memory.get(key) ?? {
        name,
        failed: true,
        eur: null,
        cmc: null,
        commanderLegality: null,
      },
    );
  }
  return result;
}

export function getCachedVisual(name: string): CardVisual | undefined {
  loadDiskCache();
  return memory.get(canonicalizeName(name));
}

export function getCachedEur(name: string): number | null | undefined {
  return getCachedVisual(name)?.eur;
}

/** Scryfall name suggestions. Empty when the query is too short or the request fails. */
export async function suggestCardNames(query: string): Promise<string[]> {
  const q = query.trim();
  if (q.length < 2) return [];
  try {
    const res = await fetch(
      `https://api.scryfall.com/cards/autocomplete?q=${encodeURIComponent(q)}`,
    );
    if (!res.ok) return [];
    const json = (await res.json()) as { data?: string[] };
    return (json.data ?? []).slice(0, 8);
  } catch {
    return [];
  }
}

export type ScryfallRuling = { publishedAt: string; comment: string };

/** Published rulings for a card (by Scryfall id or exact / face name). */
export async function fetchCardRulings(nameOrId: string): Promise<{
  rulings: ScryfallRuling[];
  error?: string;
}> {
  try {
    let id = nameOrId;
    if (!/^[0-9a-f-]{36}$/i.test(nameOrId)) {
      await resolveCardVisuals([nameOrId]);
      const cached = getCachedVisual(nameOrId);
      if (!cached?.scryfallId) {
        const named = await fetch(
          `https://api.scryfall.com/cards/named?fuzzy=${encodeURIComponent(nameOrId)}`,
        );
        if (!named.ok) return { rulings: [], error: "Card not found on Scryfall." };
        const card = (await named.json()) as ScryfallCard;
        const visual = pickCard(card);
        if (!card.id || !cardNamesMatch(nameOrId, visual.name)) {
          return { rulings: [], error: "Card not found on Scryfall." };
        }
        id = card.id;
        storeVisual(nameOrId, visual);
        schedulePersist();
      } else {
        id = cached.scryfallId;
      }
    }

    await new Promise((r) => setTimeout(r, 80));
    const res = await fetch(`https://api.scryfall.com/cards/${id}/rulings`);
    if (!res.ok) return { rulings: [], error: `Scryfall rulings HTTP ${res.status}` };
    const json = (await res.json()) as {
      data?: Array<{ published_at?: string; comment?: string }>;
    };
    const rulings = (json.data ?? [])
      .filter((r) => r.comment)
      .map((r) => ({
        publishedAt: r.published_at ?? "",
        comment: r.comment!,
      }));
    return { rulings };
  } catch (err) {
    return {
      rulings: [],
      error: err instanceof Error ? err.message : "Failed to load rulings",
    };
  }
}

/**
 * Cheapest non-foil Cardmarket EUR across printings.
 * Caches on the CardVisual; never invents a price.
 */
export async function resolveCheapestEur(
  names: string[],
): Promise<Map<string, { eur: number | null; set: string | null }>> {
  loadDiskCache();
  const unique = Array.from(new Set(names.map((n) => n.trim()).filter(Boolean)));
  const out = new Map<string, { eur: number | null; set: string | null }>();

  for (let i = 0; i < unique.length; i++) {
    const name = unique[i];
    const key = canonicalizeName(name);
    const cached = memory.get(key);
    if (cached && cached.cheapestEur !== undefined) {
      out.set(key, { eur: cached.cheapestEur, set: cached.cheapestSet ?? null });
      continue;
    }

    if (i > 0) await new Promise((r) => setTimeout(r, 100));

    try {
      const q = `!"${name.replace(/"/g, "")}" unique:prints`;
      const res = await fetch(
        `https://api.scryfall.com/cards/search?q=${encodeURIComponent(q)}&order=eur&dir=asc`,
      );
      if (!res.ok) {
        const next = { ...(cached ?? { name }), cheapestEur: null, cheapestSet: null };
        storeVisual(name, next as CardVisual);
        out.set(key, { eur: null, set: null });
        schedulePersist();
        continue;
      }
      const json = (await res.json()) as { data?: ScryfallCard[] };
      let best: { eur: number; set: string } | null = null;
      for (const card of json.data ?? []) {
        const eur = parseEur(card.prices?.eur);
        if (eur == null) continue;
        if (!best || eur < best.eur) {
          best = { eur, set: (card.set ?? "").toUpperCase() };
        }
      }
      const base = cached ?? pickCard({ name });
      const updated: CardVisual = {
        ...base,
        cheapestEur: best?.eur ?? null,
        cheapestSet: best?.set ?? null,
      };
      storeVisual(name, updated);
      out.set(key, { eur: updated.cheapestEur ?? null, set: updated.cheapestSet ?? null });
      schedulePersist();
    } catch {
      out.set(key, { eur: null, set: null });
    }
  }

  return out;
}

export type CheaperPrinting = {
  name: string;
  currentSet?: string;
  currentEur: number;
  currentId?: string;
  nextId: string;
  nextSet: string;
  nextEur: number;
  nextVisual: CardVisual;
};

const BASIC_LAND = /^(snow-covered )?(plains|island|swamp|mountain|forest|wastes)$/i;

function asCheaperOffer(
  card: { name: string; scryfallId?: string; setCode?: string; eur: number | null },
  best: { id: string; set: string; eur: number; visual: CardVisual },
): CheaperPrinting | null {
  if (card.eur == null) return null;
  if (best.eur >= card.eur - 0.0001) return null;
  if (card.scryfallId && card.scryfallId === best.id) return null;
  return {
    name: card.name,
    currentSet: card.setCode?.toUpperCase(),
    currentEur: card.eur,
    currentId: card.scryfallId,
    nextId: best.id,
    nextSet: best.set,
    nextEur: best.eur,
    nextVisual: best.visual,
  };
}

/**
 * Cheaper non-foil printings for cards already in a list.
 * Does not change which printing the deck shows. The caller applies a pick.
 */
export async function findCheaperPrintings(
  cards: { name: string; scryfallId?: string; setCode?: string; eur: number | null }[],
  onProgress?: (done: number, total: number) => void,
): Promise<CheaperPrinting[]> {
  loadDiskCache();
  const seen = new Set<string>();
  const unique = cards.filter((card) => {
    const key = canonicalizeName(card.name);
    if (!key || seen.has(key) || BASIC_LAND.test(card.name.trim())) return false;
    seen.add(key);
    return true;
  });
  const offers: CheaperPrinting[] = [];
  let fetched = 0;

  for (let i = 0; i < unique.length; i++) {
    onProgress?.(i, unique.length);
    const card = unique[i];
    const key = canonicalizeName(card.name);
    const cached = memory.get(key);
    const cachedNext = cached?.cheapestScryfallId
      ? memory.get(`id:${cached.cheapestScryfallId}`)
      : undefined;
    if (cached && cached.cheapestEur !== undefined && (cached.cheapestEur == null || cachedNext)) {
      if (cached.cheapestEur != null && cachedNext && cached.cheapestScryfallId) {
        const offer = asCheaperOffer(card, {
          id: cached.cheapestScryfallId,
          set: (cached.cheapestSet ?? cachedNext.setCode ?? "").toUpperCase(),
          eur: cached.cheapestEur,
          visual: cachedNext,
        });
        if (offer) offers.push(offer);
      }
      continue;
    }

    if (fetched > 0) await new Promise((r) => setTimeout(r, 100));
    fetched += 1;

    try {
      const q = `!"${card.name.replace(/"/g, "")}" unique:prints -is:digital`;
      const res = await fetch(
        `https://api.scryfall.com/cards/search?q=${encodeURIComponent(q)}&order=eur&dir=asc`,
      );
      if (!res.ok) continue;
      const json = (await res.json()) as { data?: ScryfallCard[] };
      const printings = json.data ?? [];
      let best: { id: string; set: string; eur: number; visual: CardVisual } | null = null;
      for (const printing of printings) {
        const eur = parseEur(printing.prices?.eur);
        if (eur == null || !printing.id) continue;
        if (!best || eur < best.eur) {
          const visual = pickCard(printing);
          best = { id: printing.id, set: (printing.set ?? "").toUpperCase(), eur, visual };
        }
      }
      let currentEur = card.eur;
      if (currentEur == null) {
        const current = printings.find(
          (printing) =>
            (card.scryfallId && printing.id === card.scryfallId) ||
            (!card.scryfallId &&
              card.setCode &&
              (printing.set ?? "").toUpperCase() === card.setCode.toUpperCase()),
        );
        currentEur = current ? parseEur(current.prices?.eur) : null;
      }
      const pricedCard = { ...card, eur: currentEur };
      const existing = memory.get(key) ?? { name: card.name };
      storeVisual(card.name, {
        ...existing,
        cheapestEur: best?.eur ?? null,
        cheapestSet: best?.set ?? null,
        cheapestScryfallId: best?.id ?? null,
      });
      if (best) memory.set(`id:${best.id}`, best.visual);
      schedulePersist();
      if (!best) continue;
      const offer = asCheaperOffer(pricedCard, best);
      if (offer) offers.push(offer);
    } catch {
      // Skip this name. A failed lookup is not a cheaper printing.
    }
  }

  onProgress?.(unique.length, unique.length);
  offers.sort((a, b) => b.currentEur - b.nextEur - (a.currentEur - a.nextEur));
  return offers;
}

export function cardmarketSearchUrl(name: string): string {
  return `https://www.cardmarket.com/en/Magic/Products/Search?searchString=${encodeURIComponent(name)}`;
}

export type PrintingOption = {
  scryfallId: string;
  setCode: string;
  setName?: string;
  collectorNumber?: string;
  eur: number | null;
  normal?: string;
  large?: string;
};

/** List non-digital printings for a card name (throttled). */
export async function fetchPrintings(name: string): Promise<PrintingOption[]> {
  loadDiskCache();
  await new Promise((r) => setTimeout(r, 80));
  try {
    const q = `!"${name.replace(/"/g, "")}" unique:prints -is:digital`;
    const res = await fetch(
      `https://api.scryfall.com/cards/search?q=${encodeURIComponent(q)}&order=released&dir=desc`,
    );
    if (!res.ok) return [];
    const json = (await res.json()) as { data?: ScryfallCard[]; has_more?: boolean; next_page?: string; warnings?: string[] };
    const rows: PrintingOption[] = [];
    for (const card of json.data ?? []) {
      const visual = pickCard(card);
      if (card.id) {
        memory.set(`id:${card.id}`, visual);
      }
      rows.push({
        scryfallId: card.id ?? "",
        setCode: (card.set ?? "").toUpperCase(),
        setName: undefined,
        collectorNumber: undefined,
        eur: visual.eur ?? null,
        normal: visual.normal,
        large: visual.large,
      });
    }
    schedulePersist();
    return rows.filter((r) => r.scryfallId);
  } catch {
    return [];
  }
}

/** Fetch one printing by Scryfall id and cache under name + id. */
export async function resolvePrintingById(
  scryfallId: string,
  nameHint?: string,
): Promise<CardVisual | null> {
  loadDiskCache();
  const byId = memory.get(`id:${scryfallId}`);
  if (byId && !byId.failed) return byId;

  await new Promise((r) => setTimeout(r, 60));
  try {
    const res = await fetch(`https://api.scryfall.com/cards/${scryfallId}`);
    if (!res.ok) return null;
    const visual = pickCard((await res.json()) as ScryfallCard);
    memory.set(`id:${scryfallId}`, visual);
    if (nameHint) storeVisual(nameHint, visual);
    else storeVisual(visual.name, visual);
    schedulePersist();
    return visual;
  } catch {
    return null;
  }
}

export function getCachedVisualById(scryfallId: string): CardVisual | undefined {
  loadDiskCache();
  return memory.get(`id:${scryfallId}`);
}

/** Apply a chosen printing as the canonical face for this card name. */
export function applyPrintingVisual(name: string, visual: CardVisual): void {
  loadDiskCache();
  storeVisual(name, visual);
  if (visual.scryfallId) memory.set(`id:${visual.scryfallId}`, visual);
  schedulePersist();
}

export type CardSearchHit = CardVisual & {
  id: string;
  setName?: string;
  rarity?: string;
  usd?: number | null;
};
export type CardSearchPage = {
  cards: CardSearchHit[];
  total: number;
  nextPage: string | null;
  error?: string;
};
/** Pagination stays on the public search endpoint, even if a caller supplies a URL. */
function searchPageUrl(value: string): URL | null {
  try {
    const url = new URL(value);
    return url.origin === "https://api.scryfall.com" && url.pathname === "/cards/search"
      && !url.username && !url.password ? url : null;
  } catch { return null; }
}
export async function searchScryfallCards(
  query: string,
  options: { pageUrl?: string | null; signal?: AbortSignal } = {},
): Promise<CardSearchPage> {
  const empty: CardSearchPage = { cards: [], total: 0, nextPage: null };
  let url = new URL("https://api.scryfall.com/cards/search");
  if (options.pageUrl) {
    const page = searchPageUrl(options.pageUrl);
    if (!page) return { ...empty, error: "Invalid Scryfall search page." };
    url = page;
  } else {
    if (!query.trim()) return empty;
    url.searchParams.set("q", query.trim());
    url.searchParams.set("unique", "cards");
    url.searchParams.set("order", "name");
  }
  if (options.signal?.aborted) return empty;
  const controller = new AbortController();
  const abort = () => controller.abort();
  options.signal?.addEventListener("abort", abort, { once: true });
  const timeout = setTimeout(abort, 30_000);
  try {
    const res = await fetch(url.href, { signal: controller.signal, headers: { Accept: "application/json" } });
    if (res.status === 404) return empty;
    if (!res.ok) return { ...empty, error: "Scryfall returned HTTP " + res.status + ". Try again later." };
    const json = await res.json() as { data?: ScryfallCard[]; total_cards?: number; has_more?: boolean; next_page?: string; warnings?: string[] };
    if (json.warnings?.some((warning) => /ignored|invalid/i.test(warning))) return { ...empty, error: "Scryfall could not apply one search filter. Check the search options." };
    if (!Array.isArray(json.data)) return { ...empty, error: "Scryfall returned an invalid search response." };
    loadDiskCache();
    const cards: CardSearchHit[] = [];
    for (const card of json.data) {
      if (!card || typeof card.id !== "string" || typeof card.name !== "string") continue;
      const visual = pickCard(card);
      memory.set("id:" + card.id, visual);
      // Searches must not replace a printing chosen in the deck editor.
      if (!memory.has(canonicalizeName(card.name))) storeVisual(card.name, visual);
      cards.push({ ...visual, id: card.id, setName: card.set_name, rarity: card.rarity, usd: parseEur(card.prices?.usd) });
    }
    schedulePersist();
    return {
      cards,
      total: typeof json.total_cards === "number" && Number.isFinite(json.total_cards) ? json.total_cards : cards.length,
      nextPage: json.has_more && typeof json.next_page === "string" ? searchPageUrl(json.next_page)?.href ?? null : null,
    };
  } catch {
    return options.signal?.aborted ? empty : { ...empty, error: "Could not reach Scryfall. Try again." };
  } finally {
    clearTimeout(timeout);
    options.signal?.removeEventListener("abort", abort);
  }
}
