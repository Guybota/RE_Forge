// Translation for the text the ported deck tools write. The English sentence stays in the code and is the key;
// a table (pt.json) gives the translation, and {name} placeholders are filled after translating. Text with values
// inside is built with say(template, values); fixed text is translated when shown, with say(text).

let table: Record<string, string> | null = null;

/** The translations to use from now on (null = English). Set before computing what will be shown. */
export function setDeckToolsLanguage(translations: Record<string, string> | null) {
  table = translations;
}

export function translating(): boolean {
  return table !== null;
}

export function say(text: string, values?: Record<string, string | number>): string {
  const template = table?.[text] ?? text;
  if (!values) return template;
  return template.replace(/\{(\w+)\}/g, (whole, key: string) => (key in values ? String(values[key]) : whole));
}

/** "A, B, and C" in the current language. */
export function joinList(items: string[]): string {
  if (items.length <= 1) return items[0] ?? '';
  if (items.length === 2) return say('{a} and {b}', { a: items[0], b: items[1] });
  return say('{list}, and {last}', { list: items.slice(0, -1).join(', '), last: items[items.length - 1] });
}
