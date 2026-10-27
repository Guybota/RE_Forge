// Official Scryfall keyword-abilities, keyword-actions and ability-words catalogs, 2026-10-27.
import keywordNames from "../data/search-keywords.json";

export const COLOR_LETTERS = ["W", "U", "B", "R", "G"] as const;
export type ColorLetter = (typeof COLOR_LETTERS)[number];
export type ColorMode = "exactly" | "including" | "atmost";
export type CompareOp = "eq" | "gt" | "lt" | "gte" | "lte" | "neq";
export type LegalityMode = "legal" | "banned" | "restricted" | "notlegal";
export type PriceCurrency = "eur" | "usd";
export type StatKind = "mv" | "pow" | "tou" | "loy";
export type SearchChip = { id: string; text: string; include: boolean; kind: "keyword" | "is" };
export type CardSearchFilters = {
  name: string; oracle: string; oracleTogether: boolean;
  types: SearchChip[]; typePartial: boolean;
  colors: ColorLetter[]; colorless: boolean; colorMode: ColorMode;
  commanderColors: ColorLetter[]; commanderColorless: boolean;
  manaCost: string; stat: StatKind; statOp: CompareOp; statValue: string;
  games: { paper: boolean; arena: boolean; mtgo: boolean };
  legality: LegalityMode; format: string; set: string; block: string;
  rarities: ("c" | "u" | "r" | "m")[];
  criteria: SearchChip[]; criteriaPartial: boolean;
  priceCurrency: PriceCurrency; priceOp: CompareOp; priceValue: string;
};
export const FORMATS = [
  { value: "commander", label: "Commander" }, { value: "standard", label: "Standard" },
  { value: "pioneer", label: "Pioneer" }, { value: "modern", label: "Modern" },
  { value: "legacy", label: "Legacy" }, { value: "vintage", label: "Vintage" },
  { value: "pauper", label: "Pauper" }, { value: "historic", label: "Historic" },
  { value: "timeless", label: "Timeless" }, { value: "brawl", label: "Brawl" },
] as const;
export const CRITERIA_FLAGS = [
  { value: "commander", label: "Can be a commander" }, { value: "spell", label: "Spell" },
  { value: "permanent", label: "Permanent" }, { value: "token", label: "Token" },
  { value: "dfc", label: "Double-faced" }, { value: "split", label: "Split card" },
  { value: "modal", label: "Modal" }, { value: "vanilla", label: "No rules text" },
  { value: "reserved", label: "Reserved List" }, { value: "fullart", label: "Full art" },
  { value: "promo", label: "Promo" },
] as const;
export const MANA_SYMBOLS = [
  ...COLOR_LETTERS.map((letter) => "{" + letter + "}"),
  "{C}", "{S}", "{X}", "{Y}", "{Z}", "{T}", "{Q}", "{E}",
  ...Array.from({ length: 21 }, (_, n) => "{" + n + "}"),
  ...["W/U", "W/B", "U/B", "U/R", "B/R", "B/G", "R/G", "R/W", "G/W", "G/U"].map((pair) => "{" + pair + "}"),
  ...COLOR_LETTERS.flatMap((letter) => ["{" + letter + "/P}", "{2/" + letter + "}"]),
];
export function emptyCardSearch(): CardSearchFilters {
  return {
    name: "", oracle: "", oracleTogether: false, types: [], typePartial: false,
    colors: [], colorless: false, colorMode: "including",
    commanderColors: [], commanderColorless: false, manaCost: "",
    stat: "mv", statOp: "eq", statValue: "", games: { paper: true, arena: false, mtgo: false },
    legality: "legal", format: "", set: "", block: "", rarities: [],
    criteria: [], criteriaPartial: false, priceCurrency: "eur", priceOp: "lte", priceValue: "",
  };
}
const OPERATORS: Record<CompareOp, string> = { eq: "=", gt: ">", lt: "<", gte: ">=", lte: "<=", neq: "!=" };
function quote(value: string): string { return JSON.stringify(value.trim()); }
function regex(value: string): string { return value.replace(/[.*+?^{}()|[\]\\/]/g, "\\$&").replace(/\$/g, "\\$&"); }
/** Preserve quoted phrases while treating every other word as its own required term. */
function words(value: string): string[] {
  return (value.match(/"(?:\\.|[^"\\])*"|\S+/g) ?? []).map((word) => {
    if (word.startsWith('"') && word.endsWith('"')) {
      try { return JSON.parse(word) as string; } catch { return word.slice(1, -1); }
    }
    return word;
  }).filter(Boolean);
}
function alternatives(terms: string[]): string {
  return terms.length > 1 ? "(" + terms.join(" or ") + ")" : terms[0] ?? "";
}
function clauses(f: CardSearchFilters): string[] {
  const terms = words(f.name).map((word) => "name:" + quote(word));
  const oracle = f.oracleTogether ? [f.oracle.trim()].filter(Boolean) : words(f.oracle);
  terms.push(...oracle.map((word) => "oracle:" + quote(word)));
  for (const chip of f.types) {
    if (!chip.text.trim()) continue;
    terms.push((chip.include ? "" : "-") + (f.typePartial
      ? "type:" + quote(chip.text)
      : "type:/\\b" + regex(chip.text.trim()) + "\\b/"));
  }
  const colors = COLOR_LETTERS.filter((c) => f.colors.includes(c)).join("").toLowerCase();
  if (f.colorless) terms.push("color=c");
  else if (colors) terms.push("color" + ({ exactly: "=", including: ">=", atmost: "<=" }[f.colorMode]) + colors);
  const identity = COLOR_LETTERS.filter((c) => f.commanderColors.includes(c)).join("").toLowerCase();
  if (f.commanderColorless) terms.push("identity=c");
  else if (identity) terms.push("identity<=" + identity);
  const mana = f.manaCost.replace(/\s+/g, "").toUpperCase();
  if (mana && /^(?:\{(?:\d+|[WUBRGCSXYZ]|[WUBRG2]\/[WUBRGP])\})+$/.test(mana)) terms.push("mana=" + mana);
  if (/^-?(?:\d+(?:\.\d+)?|\.\d+)$/.test(f.statValue.trim()) || f.statValue.trim() === "*") {
    terms.push(({ mv: "cmc", pow: "pow", tou: "tou", loy: "loy" }[f.stat]) + OPERATORS[f.statOp] + f.statValue.trim());
  }
  if (f.format && /^[a-z]+$/.test(f.format)) terms.push(
    ({ legal: "legal:", banned: "banned:", restricted: "restricted:", notlegal: "-legal:" }[f.legality]) + f.format,
  );
  if (f.set.trim()) terms.push("set:" + quote(f.set));
  if (f.block.trim()) terms.push("block:" + quote(f.block));
  if (f.rarities.length) terms.push(alternatives(["c", "u", "r", "m"].filter((r) => f.rarities.includes(r as CardSearchFilters["rarities"][number])).map((r) => "rarity:" + r)));
  for (const chip of f.criteria) {
    if (!chip.text.trim()) continue;
    const prefix = chip.include ? "" : "-";
    if (chip.kind === "is") {
      if (CRITERIA_FLAGS.some((flag) => flag.value === chip.text)) terms.push(prefix + "is:" + chip.text);
    } else if (f.criteriaPartial) {
      // The API does not support keyword regexes and silently ignores them.
      const matches = keywordNames.filter((name) => name.toLowerCase().startsWith(chip.text.trim().toLowerCase()));
      if (matches.length) terms.push(prefix + alternatives(matches.map((name) => "keyword:" + quote(name))));
      else if (chip.include) terms.push("(cmc<0 cmc>=0)");
    } else terms.push(prefix + "keyword:" + quote(chip.text));
  }
  if (/^(?:\d+(?:\.\d+)?|\.\d+)$/.test(f.priceValue.trim())) terms.push(f.priceCurrency + OPERATORS[f.priceOp] + f.priceValue.trim());
  return terms;
}
export function hasSearchCriteria(filters: CardSearchFilters): boolean {
  return clauses(filters).length > 0 || filters.games.arena || filters.games.mtgo;
}
export function buildCardSearchQuery(filters: CardSearchFilters): string {
  const terms = clauses(filters);
  const games = (["paper", "arena", "mtgo"] as const).filter((game) => filters.games[game]).map((game) => "game:" + game);
  if (games.length) terms.push(alternatives(games));
  return terms.join(" ");
}
