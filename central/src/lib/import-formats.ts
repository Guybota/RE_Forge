import { mergeQuantities, parseDecklist, type ParseLineError } from "./parse-decklist";

export type ImportFormat = "auto" | "mtg-arena" | "moxfield" | "archidekt" | "plain";

export type ImportedList = {
  commanders: { name: string; quantity: number }[];
  cards: { name: string; quantity: number }[];
  sideboard: { name: string; quantity: number }[];
  errors: ParseLineError[];
  detected: ImportFormat;
};

type Zone = "main" | "command" | "sideboard" | "ignore";

const HEADER =
  /^(?:\/\/\s*|#\s*)?(commander|commanders|companion|sideboard|maybeboard|deck|mainboard|main|about|wishlist)\s*:?\s*$/i;

/**
 * Best-effort normalize Moxfield / Archidekt / Arena / plain pastes.
 * Commander and sideboard sections stay partitioned. Maybeboard, wishlist,
 * and about blocks are dropped.
 */
export function parseImportPaste(text: string, format: ImportFormat = "auto"): ImportedList {
  const detected = format === "auto" ? detectFormat(text) : format;
  const buckets = normalizePaste(text, detected);
  const commanders = parseBucket(buckets.command);
  const cards = parseBucket(buckets.main);
  const sideboard = parseBucket(buckets.sideboard);
  return {
    commanders: mergeQuantities(commanders.cards),
    cards: mergeQuantities(cards.cards),
    sideboard: mergeQuantities(sideboard.cards),
    errors: [...commanders.errors, ...cards.errors, ...sideboard.errors],
    detected,
  };
}

function detectFormat(text: string): ImportFormat {
  if (/^Deck\b/m.test(text) && (/^Sideboard\b/m.test(text) || /\(\w{2,5}\)\s+\d+/m.test(text))) {
    return "mtg-arena";
  }
  if (/^\d+\s+.+\s+\([A-Z0-9]{2,5}\)\s+\d+/m.test(text) || /\$[\d.]+/m.test(text)) {
    return "moxfield";
  }
  if (/^\d+x?\s+.+\s+\{/m.test(text) || /\[.*Archidekt/i.test(text)) {
    return "archidekt";
  }
  return "plain";
}

function headerZone(line: string): Zone | null {
  const match = line.match(HEADER);
  if (!match) return null;
  const word = match[1].toLowerCase();
  if (word === "commander" || word === "commanders") return "command";
  if (word === "sideboard" || word === "companion") return "sideboard";
  if (word === "deck" || word === "mainboard" || word === "main") return "main";
  return "ignore";
}

function normalizePaste(text: string, format: ImportFormat): Record<"command" | "main" | "sideboard", string[]> {
  const lines = text.split(/\r?\n/);
  const out = { command: [] as string[], main: [] as string[], sideboard: [] as string[] };
  let zone: Zone = "main";

  for (const raw of lines) {
    let line = raw.trim();
    if (!line) {
      // A commander block is short. A blank line returns to the main deck
      // so cards after `// Commander` are not all treated as commanders.
      if (zone === "command") zone = "main";
      continue;
    }

    const nextZone = headerZone(line);
    if (nextZone) {
      zone = nextZone;
      continue;
    }
    if (zone === "ignore") continue;

    let target: Zone = zone;
    if (/^SB:\s*/i.test(line)) {
      target = "sideboard";
      line = line.replace(/^SB:\s*/i, "");
    }
    if (/\{\s*sideboard\s*\}/i.test(line)) {
      target = "sideboard";
    }

    if (format === "mtg-arena" || format === "auto" || format === "moxfield") {
      line = line.replace(/\s+\([A-Za-z0-9]{2,5}\)\s+\d+.*$/, "");
    }
    if (format === "moxfield" || format === "auto") {
      line = line.replace(/\s+\$[\d.]+.*$/, "").replace(/\s+\*F\*\s*$/i, "");
    }
    if (format === "archidekt" || format === "auto") {
      line = line.replace(/\s+\{[^}]+\}\s*$/, "").replace(/^(\d+)x\s+/i, "$1 ");
    }

    line = line.trim();
    if (!line) continue;
    if (target === "command") out.command.push(line);
    else if (target === "sideboard") out.sideboard.push(line);
    else out.main.push(line);
  }

  return out;
}

function parseBucket(lines: string[]): { cards: { name: string; quantity: number }[]; errors: ParseLineError[] } {
  if (!lines.length) return { cards: [], errors: [] };
  return parseDecklist(lines.join("\n"));
}

export function exportDecklistText(
  commanders: { name: string; quantity: number }[],
  cards: { name: string; quantity: number }[],
  style: "plain" | "arena" = "plain",
  sideboard: { name: string; quantity: number }[] = [],
): string {
  if (style === "arena") {
    const lines = ["Commander"];
    for (const c of commanders) lines.push(`${c.quantity} ${c.name}`);
    lines.push("", "Deck");
    for (const c of cards) lines.push(`${c.quantity} ${c.name}`);
    if (sideboard.length) {
      lines.push("", "Sideboard");
      for (const c of sideboard) lines.push(`${c.quantity} ${c.name}`);
    }
    return lines.join("\n");
  }
  const lines: string[] = [];
  for (const c of commanders) lines.push(`${c.quantity} ${c.name}`);
  lines.push("");
  for (const c of cards) lines.push(`${c.quantity} ${c.name}`);
  if (sideboard.length) {
    lines.push("", "Sideboard");
    for (const c of sideboard) lines.push(`${c.quantity} ${c.name}`);
  }
  return lines.join("\n");
}
