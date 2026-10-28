/** Scryfall advanced-search filters, turned into one query string. */

import type { MessageKey } from './i18n';

export type ColorLetter = 'W' | 'U' | 'B' | 'R' | 'G';
export type ColorMode = 'exactly' | 'including' | 'atmost';
export type CompareOp = 'eq' | 'gt' | 'lt' | 'gte' | 'lte' | 'neq';
export type StatKind = 'mv' | 'pow' | 'tou' | 'loy';
export type PriceCurrency = 'eur' | 'usd';
export type LegalityMode = 'legal' | 'banned' | 'restricted' | 'notlegal';

export type SearchChip = {
  id: string;
  text: string;
  include: boolean;
  /** `is` is a Scryfall flag such as commander. Anything else is a keyword. */
  kind: 'is' | 'keyword';
};

export type CardSearchFilters = {
  name: string;
  oracle: string;
  /** When true, oracle words must appear in order as one phrase. */
  oracleTogether: boolean;
  types: SearchChip[];
  typePartial: boolean;
  colors: ColorLetter[];
  colorless: boolean;
  colorMode: ColorMode;
  commanderColors: ColorLetter[];
  commanderColorless: boolean;
  manaCost: string;
  stat: StatKind;
  statOp: CompareOp;
  statValue: string;
  games: { paper: boolean; arena: boolean; mtgo: boolean };
  legality: LegalityMode;
  format: string;
  set: string;
  block: string;
  rarities: Array<'c' | 'u' | 'r' | 'm'>;
  criteria: SearchChip[];
  criteriaPartial: boolean;
  priceCurrency: PriceCurrency;
  priceOp: CompareOp;
  priceValue: string;
};

export const COLOR_LETTERS: ColorLetter[] = ['W', 'U', 'B', 'R', 'G'];

export const CRITERIA_FLAGS: { value: string; label: MessageKey }[] = [
  { value: 'commander', label: 'criterionCommander' },
  { value: 'spell', label: 'criterionSpell' },
  { value: 'permanent', label: 'criterionPermanent' },
  { value: 'historic', label: 'criterionHistoric' },
  { value: 'vanilla', label: 'criterionVanilla' },
  { value: 'modal', label: 'criterionModal' },
  { value: 'adventure', label: 'criterionAdventure' },
  { value: 'mdfc', label: 'criterionMdfc' },
  { value: 'split', label: 'criterionSplit' },
  { value: 'flip', label: 'criterionFlip' },
  { value: 'transform', label: 'criterionTransform' },
  { value: 'meld', label: 'criterionMeld' },
  { value: 'token', label: 'criterionToken' },
  { value: 'reserved', label: 'criterionReserved' },
  { value: 'reprint', label: 'criterionReprint' },
  { value: 'firstprint', label: 'criterionFirstPrint' },
  { value: 'promo', label: 'criterionPromo' },
  { value: 'funny', label: 'criterionFunny' },
  { value: 'digital', label: 'criterionDigital' },
  { value: 'extra', label: 'criterionExtra' },
];

export const FORMATS: { value: string; label: MessageKey }[] = [
  { value: 'commander', label: 'formatCommander' },
  { value: 'standard', label: 'formatStandard' },
  { value: 'pioneer', label: 'formatPioneer' },
  { value: 'modern', label: 'formatModern' },
  { value: 'legacy', label: 'formatLegacy' },
  { value: 'vintage', label: 'formatVintage' },
  { value: 'pauper', label: 'formatPauper' },
  { value: 'brawl', label: 'formatBrawl' },
  { value: 'historic', label: 'formatHistoric' },
  { value: 'timeless', label: 'formatTimeless' },
  { value: 'alchemy', label: 'formatAlchemy' },
  { value: 'explorer', label: 'formatExplorer' },
  { value: 'oathbreaker', label: 'formatOathbreaker' },
  { value: 'predh', label: 'formatPredh' },
  { value: 'premodern', label: 'formatPremodern' },
  { value: 'oldschool', label: 'formatOldSchool' },
  { value: 'duel', label: 'formatDuel' },
  { value: 'future', label: 'formatFuture' },
];

export const MANA_SYMBOLS = ['{W}', '{U}', '{B}', '{R}', '{G}', '{C}', '{0}', '{1}', '{2}', '{3}', '{4}', '{5}', '{6}', '{7}', '{8}', '{9}', '{X}', '{T}', '{Q}', '{E}', '{S}'] as const;

export const COMPARE_OPS: { id: CompareOp; label: MessageKey }[] = [
  { id: 'eq', label: 'searchOpEq' },
  { id: 'gt', label: 'searchOpGt' },
  { id: 'lt', label: 'searchOpLt' },
  { id: 'gte', label: 'searchOpGte' },
  { id: 'lte', label: 'searchOpLte' },
  { id: 'neq', label: 'searchOpNeq' },
];

export function emptyCardSearch(): CardSearchFilters {
  return {
    name: '',
    oracle: '',
    oracleTogether: false,
    types: [],
    typePartial: true,
    colors: [],
    colorless: false,
    colorMode: 'exactly',
    commanderColors: [],
    commanderColorless: false,
    manaCost: '',
    stat: 'mv',
    statOp: 'eq',
    statValue: '',
    games: { paper: true, arena: false, mtgo: false },
    legality: 'legal',
    format: '',
    set: '',
    block: '',
    rarities: [],
    criteria: [],
    criteriaPartial: true,
    priceCurrency: 'eur',
    priceOp: 'lt',
    priceValue: '',
  };
}

const COMPARE: Record<CompareOp, string> = { eq: '=', gt: '>', lt: '<', gte: '>=', lte: '<=', neq: '!=' };
const TOKEN = /\{[^}]+\}|"[^"]*"|[^\s]+/g;

function pieces(raw: string): string[] {
  return (raw.match(TOKEN) ?? [])
    .map((token) => {
      if (token.startsWith('{') && token.endsWith('}')) return token;
      if (token.startsWith('"')) {
        const inner = token.slice(1, token.endsWith('"') ? -1 : undefined).replace(/"/g, '').trim();
        return inner ? `"${inner}"` : '';
      }
      return token.replace(/^[,.;:]+|[,.;:]+$/g, '');
    })
    .filter(Boolean);
}

function scopedValue(token: string): string {
  if (token.startsWith('{') && token.endsWith('}')) return token;
  if (token.startsWith('"') && token.endsWith('"')) return token;
  if (/^[A-Za-z0-9~'_-]+$/.test(token)) return token;
  return `"${token.replace(/"/g, '')}"`;
}

function quotedTerm(op: string, raw: string): string | null {
  const value = raw.trim();
  if (!value) return null;
  if (/^[A-Za-z0-9]{2,8}$/.test(value)) return `${op}:${value.toLowerCase()}`;
  return `${op}:"${value.replace(/"/g, '')}"`;
}

function colorClause(colors: ColorLetter[], colorless: boolean, mode: ColorMode, op: 'c' | 'id'): string | null {
  if (colorless && colors.length === 0) return `${op}:c`;
  if (colors.length === 0) return null;
  const letters = COLOR_LETTERS.filter((c) => colors.includes(c)).join('').toLowerCase();
  if (op === 'id') return `id<=${letters}`;
  if (mode === 'including') return `c>=${letters}`;
  if (mode === 'atmost') return `c<=${letters}`;
  return `c:${letters}`;
}

function chipClause(chip: SearchChip, op: 't' | 'kw' | 'is', partial: boolean): string {
  const word = chip.text.trim().replace(/"/g, '');
  const quote = op !== 'is' && (!partial || word.includes(' '));
  const body = quote ? `${op}:"${word}"` : `${op}:${word}`;
  return chip.include ? body : `-${body}`;
}

function numberClause(key: string, op: CompareOp, raw: string): string | null {
  const value = raw.trim();
  if (!value || !/^(?:\d+(?:\.\d+)?|\*)$/.test(value)) return null;
  return `${key}${COMPARE[op]}${value}`;
}

/** A Scryfall `q` string. Empty means the form has nothing to search. */
export function buildCardSearchQuery(filters: CardSearchFilters): string {
  const parts: string[] = [];
  for (const token of pieces(filters.name)) parts.push(`name:${scopedValue(token)}`);
  if (filters.oracleTogether) {
    const phrase = filters.oracle.trim().replace(/"/g, '');
    if (phrase) parts.push(`o:"${phrase}"`);
  } else {
    for (const token of pieces(filters.oracle)) parts.push(`o:${scopedValue(token)}`);
  }
  for (const chip of filters.types) {
    if (chip.text.trim()) parts.push(chipClause(chip, 't', filters.typePartial));
  }
  const colors = colorClause(filters.colors, filters.colorless, filters.colorMode, 'c');
  if (colors) parts.push(colors);
  const identity = colorClause(filters.commanderColors, filters.commanderColorless, 'atmost', 'id');
  if (identity) parts.push(identity);
  const mana = filters.manaCost.replace(/\s+/g, '');
  if (mana) parts.push(`m:${mana}`);
  const stat = numberClause(filters.stat, filters.statOp, filters.statValue);
  if (stat) parts.push(stat);
  const games = [
    filters.games.paper ? 'game:paper' : '',
    filters.games.arena ? 'game:arena' : '',
    filters.games.mtgo ? 'game:mtgo' : '',
  ].filter(Boolean);
  if (games.length === 1) parts.push(games[0]);
  else if (games.length > 1) parts.push(`(${games.join(' OR ')})`);
  if (filters.format) {
    const code = filters.format.toLowerCase();
    if (filters.legality === 'banned') parts.push(`banned:${code}`);
    else if (filters.legality === 'restricted') parts.push(`restricted:${code}`);
    else if (filters.legality === 'notlegal') parts.push(`-legal:${code}`);
    else parts.push(`legal:${code}`);
  }
  const set = quotedTerm('set', filters.set);
  if (set) parts.push(set);
  const block = quotedTerm('block', filters.block);
  if (block) parts.push(block);
  if (filters.rarities.length) {
    const rarity = filters.rarities.map((r) => `r:${r}`);
    parts.push(rarity.length === 1 ? rarity[0] : `(${rarity.join(' OR ')})`);
  }
  for (const chip of filters.criteria) {
    if (!chip.text.trim()) continue;
    const op = chip.kind === 'is' ? 'is' : 'kw';
    parts.push(chipClause(chip, op, chip.kind === 'is' ? false : filters.criteriaPartial));
  }
  const price = numberClause(filters.priceCurrency, filters.priceOp, filters.priceValue);
  if (price) parts.push(price);
  return parts.join(' ');
}

/** True when something other than the game checkboxes is filled in. */
export function hasSearchCriteria(filters: CardSearchFilters): boolean {
  return buildCardSearchQuery({ ...filters, games: { paper: false, arena: false, mtgo: false } }).length > 0;
}

export function insertSymbol(value: string, symbol: string, el: HTMLInputElement | null): string {
  if (!el) return `${value}${symbol}`;
  const start = el.selectionStart ?? value.length;
  const end = el.selectionEnd ?? start;
  const next = `${value.slice(0, start)}${symbol}${value.slice(end)}`;
  const caret = start + symbol.length;
  requestAnimationFrame(() => { el.focus(); el.setSelectionRange(caret, caret); });
  return next;
}
