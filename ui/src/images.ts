// Card pictures come from the engine's local image server (it downloads from Scryfall once, then caches).

let imageBase: string | null = null;
let imageLanguage = 'en-US';

export function setImageBase(base: string | undefined, language?: string) {
  imageBase = base ?? null;
  imageLanguage = language ?? 'en-US';
}

/** "crop" is the illustration only (for the card frame); "full" is the whole printed card (for the preview). */
export function cardImage(imageKey: string | undefined, format: 'crop' | 'full'): string | null {
  if (!imageBase || !imageKey || !(imageKey.startsWith('c:') || imageKey.startsWith('t:'))) return null;
  return `${imageBase}?key=${encodeURIComponent(imageKey)}&format=${format}&lang=${encodeURIComponent(imageLanguage)}`;
}
