import { useT } from './i18n';
import { useState } from 'react';
import { SettingsDialog } from './audio/SoundSettings';
import { SKINS } from './skins';
import type { Engine } from './useEngine';

export type HomeDestination = 'commander' | 'quest' | 'adventure' | 'decks' | 'online' | 'skin' | 'language';

export function Home({ engine, onPick }: { engine: Engine; onPick: (destination: HomeDestination) => void }) {
  const t = useT(); const info = engine.info;
  const [soundOpen, setSoundOpen] = useState(false);
  return (
    <main className="mode-home">
      <header className="mode-home__brand"><h1 title={info ? t('cardCount', { cards: info.cards.toLocaleString(info.language), editions: info.editions }) : undefined}>RE:Forge</h1></header>
      <nav className="mode-home__modes" aria-label={t('mainMenu')}>
        <button className="mode-home__mode" type="button" title={t('adventureHint')} onClick={() => onPick('adventure')}><span>{t('adventure')}</span><svg viewBox="0 0 80 64" aria-hidden="true"><path d="M4 55 28 12l18 31 10-17 20 29Z M28 12v43 M4 55h72" /></svg></button>
        <button className="mode-home__mode" type="button" title={t('questHint')} onClick={() => onPick('quest')}><span>{t('quest')}</span><svg viewBox="0 0 80 64" aria-hidden="true"><path d="M22 8h38v46H22Z M12 18h10 M12 30h10 M12 42h10 M32 22h18 M32 32h18 M32 42h10" /></svg></button>
        <button className="mode-home__mode" type="button" title={t('commanderHint')} onClick={() => onPick('commander')}><span>{t('commanderMode')}</span><svg viewBox="0 0 80 64" aria-hidden="true"><path d="M20 53V13h28v40Z M27 13V7h28v40h-7 M33 34l5-11 5 11-5 10Z" /></svg></button>
      </nav>
      <footer className="mode-home__footer">
        <nav aria-label={t('decks')}><button className="btn btn--ghost" type="button" onClick={() => onPick('decks')}>{t('decks')}</button><button className="btn btn--ghost" type="button" onClick={() => onPick('online')}>{t('online')}</button></nav>
        <nav aria-label={t('menu')}>
          <button type="button" className="btn btn--ghost" aria-haspopup="dialog" onClick={() => setSoundOpen(true)}>{t('settings')}</button>
          <button type="button" className="btn btn--ghost" onClick={() => onPick('skin')}>{t(SKINS.find(s => s.id === info?.skin)?.name ?? 'skinMesa')}</button>
          <button type="button" className="btn btn--ghost" onClick={() => onPick('language')}>{info?.languages.find(l => l.code === info.language)?.name ?? t('language')}</button>
        </nav>
      </footer>
      {soundOpen && <SettingsDialog onClose={() => setSoundOpen(false)} />}
    </main>
  );
}
