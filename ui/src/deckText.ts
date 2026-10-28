// Small edits to a saved deck's decklist text (`deckDetail.text`: Commander / Deck / Sideboard sections,
// lines "qty Name (SET) number"), keeping every other line, printing and section as it is.

const LINE = /^(\d+)\s+(.+?)(?:\s+\(([^)]+)\)\s*(\S+)?)?\s*$/;

type Parsed = { qty: number; name: string; set?: string; number?: string };
function parse(line: string): Parsed | null {
  const m = LINE.exec(line.trim());
  return m ? { qty: Number(m[1]), name: m[2], set: m[3], number: m[4] } : null;
}
const isSection = (line: string) => /^(commander|deck|sideboard|main)$/i.test(line.trim());

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
