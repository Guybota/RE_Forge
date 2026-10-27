/** The Central iframe bridge carries a list, never a request to save/replace a deck. */
export type CentralDeck = { id: string; name: string; text: string };

declare global {
  interface Window { reforge?: { openCentral: () => Promise<string> } }
}

export function parseCentralDeck(value: unknown): CentralDeck | null {
  if (!value || typeof value !== 'object' || !('type' in value) || value.type !== 'central:deck' || !('deck' in value)) return null;
  const deck = value.deck;
  if (!deck || typeof deck !== 'object') return null;
  const bounded = (key: string, max: number): string | null => {
    const v = (deck as Record<string, unknown>)[key];
    return typeof v === 'string' && v.trim().length > 0 && v.length <= max ? v : null;
  };
  const id = bounded('id', 200), name = bounded('name', 200), text = bounded('text', 1_000_000);
  return id && name && text ? { id, name, text } : null;
}

export function acceptsCentralMessage(event: { origin: string; source: unknown; data: unknown }, parent: unknown, origin: string): CentralDeck | null {
  return origin !== 'null' && event.origin === origin && event.source === parent ? parseCentralDeck(event.data) : null;
}

export function centralUrl(): string | null {
  const value = new URLSearchParams(window.location.search).get('centralUrl');
  if (!value) return null;
  try {
    const url = new URL(value);
    return url.protocol === 'http:' && ['127.0.0.1', 'localhost'].includes(url.hostname) ? url.href : null;
  } catch { return null; }
}
