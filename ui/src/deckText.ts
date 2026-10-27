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
