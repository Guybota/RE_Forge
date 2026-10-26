import { useT } from './i18n';
import { useState } from 'react';
import { SettingsDialog } from './settings/SettingsDialog';
import type { Engine } from './useEngine';

export type HomeDestination = 'commander' | 'quest' | 'adventure' | 'draft' | 'sealed' | 'puzzles' | 'decks' | 'online' | 'skin' | 'language';

export function Home({ engine, onPick }: { engine: Engine; onPick: (destination: HomeDestination) => void }) {
  const t = useT(); const info = engine.info;
  const [settingsOpen, setSettingsOpen] = useState(false);
  return (
    <main className="mode-home">
      <header className="mode-home__brand"><h1 title={info ? t('cardCount', { cards: info.cards.toLocaleString(info.language), editions: info.editions }) : undefined}>RE:Forge</h1></header>
      <nav className="mode-home__modes" aria-label={t('mainMenu')}>
        <button className="mode-home__mode" type="button" title={t('adventureHint')} onClick={() => onPick('adventure')}><span>{t('adventure')}</span><svg viewBox="0 0 80 64" aria-hidden="true"><path d="M4 55 28 12l18 31 10-17 20 29Z M28 12v43 M4 55h72" /></svg></button>
        <button className="mode-home__mode" type="button" title={t('questHint')} onClick={() => onPick('quest')}><span>{t('quest')}</span><svg viewBox="0 0 80 64" aria-hidden="true"><path d="M22 8h38v46H22Z M12 18h10 M12 30h10 M12 42h10 M32 22h18 M32 32h18 M32 42h10" /></svg></button>
        <button className="mode-home__mode" type="button" title={t('commanderHint')} onClick={() => onPick('commander')}><span>{t('commanderMode')}</span><svg viewBox="0 0 80 64" aria-hidden="true"><path d="M20 53V13h28v40Z M27 13V7h28v40h-7 M33 34l5-11 5 11-5 10Z" /></svg></button>
        <button className="mode-home__mode" type="button" title={t('draftHint')} onClick={() => onPick('draft')}><span>{t('draftMode')}</span><svg viewBox="0 0 80 64" aria-hidden="true"><path d="M8 50 26 12h16L24 50Z M30 50 48 12h16L46 50Z M52 32h20 M64 24l8 8-8 8" /></svg></button>
        <button className="mode-home__mode" type="button" title={t('sealedHint')} onClick={() => onPick('sealed')}><span>{t('sealedMode')}</span><svg viewBox="0 0 80 64" aria-hidden="true"><path d="M14 20h52v34H14Z M14 20l26 16 26-16 M26 8h28v12" /></svg></button>
        <button className="mode-home__mode" type="button" title={t('puzzlesHint')} onClick={() => onPick('puzzles')}><span>{t('puzzlesMode')}</span><svg viewBox="0 0 80 64" aria-hidden="true"><path d="M14 10h22v8a6 6 0 1 0 12 0v-8h18v22h-8a6 6 0 1 0 0 12h8v12H14Z" /></svg></button>
      </nav>
      <footer className="mode-home__footer">
        <nav aria-label={t('decks')}><button className="btn btn--ghost" type="button" onClick={() => onPick('decks')}>{t('decks')}</button><button className="btn btn--ghost" type="button" onClick={() => onPick('online')}>{t('online')}</button></nav>
        <nav aria-label={t('menu')}>
          <button type="button" className="btn btn--ghost" aria-haspopup="dialog" onClick={() => setSettingsOpen(true)}>{t('settings')}</button>
        </nav>
      </footer>
      {settingsOpen && <SettingsDialog engine={engine} onClose={() => setSettingsOpen(false)} />}
    </main>
  );
}
