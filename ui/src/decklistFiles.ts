/** Decklist text from an opened file, and line fixes for the import screen. Pure: tested by ui:smoke-import. */

const ENTITIES: Record<string, string> = { amp: '&', quot: '"', apos: "'", lt: '<', gt: '>' };
const decode = (s: string) => s.replace(/&(amp|quot|apos|lt|gt);/g, (_, e: string) => ENTITIES[e]);

/** A deck library exported by the old MTG Central (JSON: {version, decks}, a list of decks, or one deck). */
export function isCentralLibrary(content: string): boolean {
  let value: unknown;
  try { value = JSON.parse(content); } catch { return false; }
  const isDeck = (d: unknown) => !!d && typeof d === 'object' && Array.isArray((d as { cards?: unknown }).cards);
  if (Array.isArray(value)) return value.length > 0 && value.every(isDeck);
  if (value && typeof value === 'object' && Array.isArray((value as { decks?: unknown }).decks)) return (value as { decks: unknown[] }).decks.every(isDeck);
  return isDeck(value);
}

/**
 * MTGO's .dek is XML (sideboard cards flagged; Commander puts the commander there), Forge's .dck has
 * [Commander] / [Main] / [Sideboard] / [Maybeboard] sections with "qty Name|SET|art" lines. Anything else is read as text.
 */
export function fileToDecklist(fileName: string, content: string): { text: string; name?: string } {
  const ext = fileName.toLowerCase().split('.').pop();
  const base = fileName.replace(/\.[^.]+$/, '');
  if (ext === 'dek' && /<Cards\b/.test(content)) {
    const main: string[] = [], side: string[] = [];
    for (const [, attrs] of content.matchAll(/<Cards\b([^>]*)>/g)) {
      const attr = (key: string) => decode(attrs.match(new RegExp(`\\b${key}="([^"]*)"`))?.[1] ?? '');
      const name = attr('Name'), qty = Number(attr('Quantity')) || 1;
      if (!name) continue;
      (attr('Sideboard') === 'true' ? side : main).push(`${qty} ${name}`);
    }
    return { text: section('Deck', main) + (side.length ? '\n' + section('Sideboard', side) : ''), name: base };
  }
  if (ext === 'dck') {
    const out: string[] = [];
    let name: string | undefined;
    let current: string | null = null;
    const titles: Record<string, string> = { commander: 'Commander', main: 'Deck', sideboard: 'Sideboard', maybeboard: 'Maybeboard' };
    for (const raw of content.split(/\r?\n/)) {
      const line = raw.trim();
      const header = line.match(/^\[(.+)\]$/);
      if (header) {
        const key = header[1].toLowerCase();
        current = key === 'metadata' ? 'metadata' : titles[key] ?? null;
        if (titles[key]) out.push((out.length ? '\n' : '') + titles[key]);
        continue;
      }
      if (!line || !current) continue;
      if (current === 'metadata') {
        if (line.startsWith('Name=')) name = line.slice(5).trim();
        continue;
      }
      // "1 Sol Ring|C21|2": the third field is Forge's art index, not a collector number.
      const [card, set] = line.split('|');
      out.push(set ? `${card.trim()} (${set.trim()})` : card.trim());
    }
    return { text: out.join('\n') + '\n', name: name || base };
  }
  return { text: content, name: base };
}

function section(title: string, lines: string[]) {
  return `${title}\n${lines.join('\n')}\n`;
}

/**
 * Replaces the first line that asks for {@code requested} with the chosen card, keeping its count and any
 * "SB:"/"CM:" prefix. The set and number go: they belonged to the misspelt card.
 */
export function replaceUnknownLine(text: string, requested: string, nameEn: string): string {
  const lines = text.split('\n');
  const wanted = requested.toLowerCase();
  const i = lines.findIndex((l) => l.toLowerCase().includes(wanted));
  if (i < 0) return text;
  const lead = lines[i].match(/^\s*((?:SB|CM|MB):\s*)?(\d+)x?\s+/i);
  lines[i] = `${lead?.[1] ?? ''}${lead?.[2] ?? 1} ${nameEn}${lines[i].endsWith('\r') ? '\r' : ''}`;
  return lines.join('\n');
}
