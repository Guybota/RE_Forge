import raw from "@/data/card-tags.json";
import { canonicalizeName } from "./parse-decklist";

type Row = [number, number, number] | [number, number, number, string[]];

export type CardTag = {
  cmc: number;
  types: number;
  themes: number;
  sub: string[];
};

const byKey = new Map<string, CardTag>();

for (const [name, row] of Object.entries(raw as unknown as Record<string, Row>)) {
  const tag: CardTag = {
    cmc: row[0] ?? 0,
    types: row[1] ?? 0,
    themes: row[2] ?? 0,
    sub: row[3] ?? [],
  };
  byKey.set(canonicalizeName(name), tag);
  if (name.includes(" // ")) {
    for (const face of name.split(" // ")) {
      const key = canonicalizeName(face);
      if (!byKey.has(key)) byKey.set(key, tag);
    }
  }
}

export function tagOf(name: string): CardTag | undefined {
  const direct = byKey.get(canonicalizeName(name));
  if (direct) return direct;
  const face = name.split(" // ")[0];
  if (face && face !== name) return byKey.get(canonicalizeName(face));
  return undefined;
}
