// Small edits to a saved deck's decklist text (`deckDetail.text`: Commander / Deck / Sideboard / Maybeboard
// sections, lines "qty Name (SET) number"), keeping every other line, printing and section as it is.

const LINE = /^(\d+)\s+(.+?)(?:\s+\(([^)]+)\)\s*(\S+)?)?\s*$/;

type Parsed = { qty: number; name: string; set?: string; number?: string };
function parse(line: string): Parsed | null {
  const m = LINE.exec(line.trim());
  return m ? { qty: Number(m[1]), name: m[2], set: m[3], number: m[4] } : null;
}
const isSection = (line: string) => /^(commander|deck|sideboard|maybeboard|main)$/i.test(line.trim());

/** Switches one printing of a card (every section) to another set and collector number. */
export function swapPrinting(text: string, nameEn: string, from: { set: string; number: string }, to: { set: string; number: string }): string {
  return text.split('\n').map((line) => {
    const p = parse(line);
    if (!p || p.name !== nameEn || p.set !== from.set || p.number !== from.number) return line;
    return `${p.qty} ${p.name} (${to.set}) ${to.number}`;
  }).join('\n');
}

const spot = (p: Parsed) => p.set ? ` (${p.set}) ${p.number ?? ''}`.trimEnd() : '';
const written = (p: Parsed) => `${p.qty} ${p.name}${spot(p)}`;

function sectionName(line: string) {
  const name = line.trim().toLowerCase();
  return name === 'main' ? 'deck' : name;
}

/** Drops a section whose header has no card under it. */
function tidy(text: string) {
  const blocks: string[][] = [];
  let current: string[] = [];
  for (const line of text.split('\n')) {
    if (isSection(line)) {
      if (current.length) blocks.push(current);
      current = [line.trim()];
    } else current.push(line);
  }
  if (current.length) blocks.push(current);
  return blocks
    .filter((block) => block.some((line) => parse(line)))
    .map((block) => block.join('\n').trim())
    .join('\n\n');
}

/** Takes one copy of a printing out of one section. Other sections keep theirs. */
export function removeCopy(text: string, nameEn: string, from: { set?: string; number?: string }, only: string): string {
  let section = 'deck';
  const out: string[] = [];
  for (const line of text.split('\n')) {
    if (isSection(line)) { section = sectionName(line); out.push(line); continue; }
    const p = parse(line);
    if (p && section === only && p.name === nameEn && p.set === from.set && p.number === from.number) {
      if (p.qty > 1) out.push(written({ ...p, qty: p.qty - 1 }));
      continue;
    }
    out.push(line);
  }
  return tidy(out.join('\n'));
}

const HEADER: Record<string, string> = { deck: 'Deck', sideboard: 'Sideboard', maybeboard: 'Maybeboard', commander: 'Commander' };

/** Moves one copy of a printing from one section to another. Other copies and sections stay. */
export function moveCopy(text: string, nameEn: string, from: { set?: string; number?: string }, only: string, to: string): string {
  if (only === to) return text;
  let section = 'deck';
  let moved: Parsed | null = null;
  const out: string[] = [];
  for (const line of text.split('\n')) {
    if (isSection(line)) { section = sectionName(line); out.push(line); continue; }
    const p = parse(line);
    if (!moved && p && section === only && p.name === nameEn && p.set === from.set && p.number === from.number) {
      moved = { ...p, qty: 1 };
      if (p.qty > 1) out.push(written({ ...p, qty: p.qty - 1 }));
      continue;
    }
    out.push(line);
  }
  if (!moved) return text;
  let placed = false;
  let sec = 'deck';
  const next: string[] = [];
  for (const line of out) {
    if (isSection(line)) { sec = sectionName(line); next.push(line); continue; }
    const p = parse(line);
    if (!placed && sec === to && p && p.name === nameEn && p.set === from.set && p.number === from.number) {
      next.push(written({ ...p, qty: p.qty + 1 }));
      placed = true;
      continue;
    }
    next.push(line);
  }
  if (!placed) {
    const at = next.findIndex((line) => isSection(line) && sectionName(line) === to);
    if (at >= 0) next.splice(at + 1, 0, written(moved));
    else next.push('', HEADER[to] ?? 'Deck', written(moved));
  }
  return tidy(next.join('\n'));
}

/** Moves a commander into the deck. The printed card stays the same. */
export function demoteCommander(text: string, nameEn: string, from: { set?: string; number?: string }): string {
  let section = 'deck';
  let moved: string | null = null;
  const out: string[] = [];
  for (const line of text.split('\n')) {
    if (isSection(line)) { section = sectionName(line); out.push(line); continue; }
    const p = parse(line);
    if (!moved && p && section === 'commander' && p.name === nameEn && p.set === from.set && p.number === from.number) {
      moved = written(p);
      continue;
    }
    out.push(line);
  }
  if (!moved) return text;
  const deckAt = out.findIndex((line) => isSection(line) && sectionName(line) === 'deck');
  if (deckAt >= 0) out.splice(deckAt + 1, 0, moved);
  else out.push('', 'Deck', moved);
  return tidy(out.join('\n'));
}

type Section = 'commander' | 'deck' | 'sideboard' | 'maybeboard';

function parseSections(text: string): Record<Section, Parsed[]> {
  const out: Record<Section, Parsed[]> = { commander: [], deck: [], sideboard: [], maybeboard: [] };
  let section: Section = 'deck';
  for (const line of text.split('\n')) {
    if (isSection(line)) {
      const name = sectionName(line);
      if (name === 'commander' || name === 'deck' || name === 'sideboard' || name === 'maybeboard') section = name;
      continue;
    }
    const p = parse(line);
    if (p) out[section].push(p);
  }
  return out;
}

function stackCards(cards: Parsed[]) {
  const map = new Map<string, Parsed>();
  for (const p of cards) {
    const key = `${p.name}\0${p.set ?? ''}\0${p.number ?? ''}`;
    const prev = map.get(key);
    if (prev) prev.qty += p.qty;
    else map.set(key, { ...p });
  }
  return [...map.values()];
}

/**
 * Adds every card from `incoming` into the matching sections of `current`.
 * Commanders in the import go into the deck so the current commanders stay.
 * Matching printings stack quantities.
 */
export function mergeDecklists(current: string, incoming: string): string {
  const base = parseSections(current);
  const add = parseSections(incoming);
  for (const p of add.commander) base.deck.push(p);
  for (const section of ['deck', 'sideboard', 'maybeboard'] as const) {
    for (const p of add[section]) base[section].push(p);
  }
  const parts: string[] = [];
  for (const [title, cards] of [
    ['Commander', base.commander],
    ['Deck', base.deck],
    ['Sideboard', base.sideboard],
    ['Maybeboard', base.maybeboard],
  ] as const) {
    const stacked = stackCards(cards);
    if (!stacked.length) continue;
    if (parts.length) parts.push('');
    parts.push(title, ...stacked.map(written));
  }
  return parts.join('\n');
}

/** Adds one copy of each card to the main deck and takes one copy of each cut out of it. */
export function addAndCut(text: string, add: string[], cut: string[]): string {
  const lines = text.split('\n');
  const out: string[] = [];
  const cuts = [...cut];
  let section = 'deck';
  let added = false;
  for (const line of lines) {
    if (isSection(line)) {
      section = line.trim().toLowerCase() === 'main' ? 'deck' : line.trim().toLowerCase();
      out.push(line);
      if (section === 'deck' && !added) { out.push(...add.map((n) => `1 ${n}`)); added = true; }
      continue;
    }
    const p = parse(line);
    const i = p && section === 'deck' ? cuts.indexOf(p.name) : -1;
    if (p && i >= 0) {
      cuts.splice(i, 1);
      if (p.qty > 1) out.push(line.replace(/^\s*\d+/, String(p.qty - 1)));
      continue;
    }
    out.push(line);
  }
  if (!added && add.length) out.push('', 'Deck', ...add.map((n) => `1 ${n}`));
  return out.join('\n');
}
