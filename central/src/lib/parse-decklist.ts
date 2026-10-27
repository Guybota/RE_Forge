export type ParseLineError = {
  line: number;
  text: string;
  message: string;
};

export type ParsedDecklist = {
  cards: { name: string; quantity: number }[];
  errors: ParseLineError[];
};

const SECTION_HEADERS = /^(commander|commanders|companion|sideboard|maybeboard|deck|mainboard|main)$/i;

/** Parse standard `1 Card Name` / `Card Name` lines; ignore blank and section headers. */
export function parseDecklist(text: string): ParsedDecklist {
  const cards: { name: string; quantity: number }[] = [];
  const errors: ParseLineError[] = [];
  const lines = text.split(/\r?\n/);

  lines.forEach((raw, index) => {
    const line = raw.trim();
    if (!line || line.startsWith("//") || line.startsWith("#")) return;
    if (SECTION_HEADERS.test(line.replace(/:$/, ""))) return;

    const qtyMatch = line.match(/^(\d+)x?\s+(.+)$/i);
    const nameOnly = !qtyMatch ? line.replace(/^SB:\s*/i, "").trim() : null;

    let quantity = 1;
    let name = "";

    if (qtyMatch) {
      quantity = Number.parseInt(qtyMatch[1], 10);
      name = qtyMatch[2].trim();
    } else if (nameOnly) {
      name = nameOnly;
    }

    name = name
      .replace(/\s*\*\w+\*$/, "")
      .replace(/\s*#\d+$/, "")
      .replace(/\s*\[[^\]]+\]$/, "")
      .trim();

    if (!name || quantity < 1 || Number.isNaN(quantity)) {
      errors.push({
        line: index + 1,
        text: raw,
        message: "Could not parse quantity and card name",
      });
      return;
    }

    cards.push({ name, quantity });
  });

  return { cards, errors };
}

export function mergeQuantities(
  cards: { name: string; quantity: number }[],
): { name: string; quantity: number }[] {
  const map = new Map<string, { name: string; quantity: number }>();
  for (const card of cards) {
    const key = canonicalizeName(card.name);
    const existing = map.get(key);
    if (existing) {
      existing.quantity += card.quantity;
    } else {
      map.set(key, { name: card.name, quantity: card.quantity });
    }
  }
  return Array.from(map.values()).sort((a, b) =>
    a.name.localeCompare(b.name, undefined, { sensitivity: "base" }),
  );
}

export function canonicalizeName(name: string): string {
  return name.trim().toLowerCase().replace(/\s+/g, " ");
}

export function toDecklistText(
  commanders: { name: string; quantity: number }[],
  cards: { name: string; quantity: number }[],
  sideboard: { name: string; quantity: number }[] = [],
): string {
  const lines: string[] = ["Commander"];
  for (const c of commanders) {
    lines.push(`${c.quantity} ${c.name}`);
  }
  lines.push("", "Deck");
  for (const c of cards) {
    lines.push(`${c.quantity} ${c.name}`);
  }
  if (sideboard.length) {
    lines.push("", "Sideboard");
    for (const c of sideboard) {
      lines.push(`${c.quantity} ${c.name}`);
    }
  }
  return lines.join("\n");
}
