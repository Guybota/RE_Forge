import type { MessageKey } from './i18n';

/** Each id matches a [data-skin] block in index.css. */
export const SKINS: { id: string; name: MessageKey }[] = [
  { id: 'mesa', name: 'skinMesa' },
  { id: 'editorial', name: 'skinEditorial' },
  { id: 'retro', name: 'skinRetro' },
  { id: 'terminal', name: 'skinTerminal' },
];

export const DEFAULT_SKIN = 'mesa';
