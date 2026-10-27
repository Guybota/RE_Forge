import { canonicalizeName } from "./parse-decklist";
import { resolveCardVisuals, type CardVisual } from "./scryfall";
import type { ColorIdentity } from "./types";

const ORDER: ColorIdentity[] = ["W", "U", "B", "R", "G"];

/** Union of Scryfall color identities. Undefined when no card data was available. */
export function unionColorIdentity(
  visuals: Array<CardVisual | undefined>,
): ColorIdentity[] | undefined {
  const found = new Set<string>();
  let saw = false;
  for (const visual of visuals) {
    if (!visual || visual.failed || visual.colorIdentity == null) continue;
    saw = true;
    for (const color of visual.colorIdentity) found.add(color.toUpperCase());
  }
  if (!saw) return undefined;
  return ORDER.filter((color) => found.has(color));
}

export async function resolveCommanderColors(
  names: string[],
): Promise<ColorIdentity[] | undefined> {
  const unique = Array.from(new Set(names.map((name) => name.trim()).filter(Boolean)));
  if (!unique.length) return undefined;
  const visuals = await resolveCardVisuals(unique);
  return unionColorIdentity(unique.map((name) => visuals.get(canonicalizeName(name))));
}
