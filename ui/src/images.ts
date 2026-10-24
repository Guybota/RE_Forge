// Card pictures come from the engine's local image server (it downloads from Scryfall once, then caches).

let imageBase: string | null = null;

export function setImageBase(base: string | undefined) {
  imageBase = base ?? null;
}

/** "crop" is the illustration only (for the card frame); "full" is the whole printed card (for the preview). */
export function cardImage(imageKey: string | undefined, format: 'crop' | 'full'): string | null {
  if (!imageBase || !imageKey) return null;
  return `${imageBase}?key=${encodeURIComponent(imageKey)}&format=${format}`;
}
