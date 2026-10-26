import type { MessageKey } from './i18n';
import type { PlayableMode } from './modeUsage';

export const HOME_MODES: { id: PlayableMode; name: MessageKey; hint: MessageKey }[] = [
  { id: 'commander', name: 'commanderMode', hint: 'commanderHint' },
  { id: 'adventure', name: 'adventure', hint: 'adventureHint' },
  { id: 'quest', name: 'quest', hint: 'questHint' },
  { id: 'draft', name: 'draftMode', hint: 'draftHint' },
  { id: 'sealed', name: 'sealedMode', hint: 'sealedHint' },
  { id: 'puzzles', name: 'puzzlesMode', hint: 'puzzlesHint' },
  { id: 'online', name: 'online', hint: 'online' },
];

/** The existing home-menu illustrations, shared by the rail, feature and shortcuts. */
export function ModeIcon({ mode }: { mode: PlayableMode }) {
  const paths: Record<PlayableMode, string> = {
    commander: 'M20 53V13h28v40Z M27 13V7h28v40h-7 M33 34l5-11 5 11-5 10Z',
    adventure: 'M4 55 28 12l18 31 10-17 20 29Z M28 12v43 M4 55h72',
    quest: 'M22 8h38v46H22Z M12 18h10 M12 30h10 M12 42h10 M32 22h18 M32 32h18 M32 42h10',
    draft: 'M8 50 26 12h16L24 50Z M30 50 48 12h16L46 50Z M52 32h20 M64 24l8 8-8 8',
    sealed: 'M14 20h52v34H14Z M14 20l26 16 26-16 M26 8h28v12',
    puzzles: 'M14 10h22v8a6 6 0 1 0 12 0v-8h18v22h-8a6 6 0 1 0 0 12h8v12H14Z',
    online: 'M9 18h22v18H9Z M49 18h22v18H49Z M20 36v12h40V36 M40 48v8',
  };
  return <svg viewBox="0 0 80 64" aria-hidden="true"><path d={paths[mode]} /></svg>;
}
