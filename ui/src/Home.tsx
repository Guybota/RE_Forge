import { useState, useSyncExternalStore } from 'react';
import { useT } from './i18n';
import { SettingsDialog } from './settings/SettingsDialog';
import type { Engine } from './useEngine';
import { getModeHistory, popularModes, subscribeModeHistory, type PlayableMode } from './modeUsage';
import { HOME_MODES, ModeIcon } from './homeModes';
import { cardImage } from './images';
import './home.css';
import { CentralImportResult } from './ImportDeck';

export type HomeDestination = PlayableMode | 'decks' | 'rules' | 'skin' | 'language';

function ModeArtwork({ mode, imageKey }: { mode: PlayableMode; imageKey?: string }) {
  const src = cardImage(imageKey, 'crop');
  return <span className="library-home__art" aria-hidden="true">
    <ModeIcon mode={mode} />
    {src && <img key={src} src={src} alt="" decoding="async" onError={e => { e.currentTarget.hidden = true; }} />}
  </span>;
}

export function Home({ engine, onPick }: { engine: Engine; onPick: (destination: HomeDestination) => void }) {
  const t = useT(); const info = engine.info;
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [migrationSeen, setMigrationSeen] = useState(false);
  const migration = engine.centralImport?.migration && engine.centralImport.imported.length + engine.centralImport.failed.length > 0 && !migrationSeen
    ? engine.centralImport : null;
  const history = useSyncExternalStore(subscribeModeHistory, getModeHistory);
  const popular = popularModes(history);
  const featured = HOME_MODES.find(mode => mode.id === popular[0]) ?? HOME_MODES[0];
  const playCount = (mode: PlayableMode) => t(history[mode]?.plays === 1 ? 'modePlayedOnce' : 'modePlayedMany', { n: history[mode]?.plays ?? 0 });
  return (
    <main className="library-home">
      <header className="library-home__header">
        <h1 title={info ? t('cardCount', { cards: info.cards.toLocaleString(info.language), editions: info.editions }) : undefined}>RE:Forge</h1>
        <nav className="library-home__nav" aria-label={t('mainMenu')}>
          <button className="btn btn--ghost" type="button" aria-current="page">{t('home')}</button>
          <button className="btn btn--ghost" type="button" onClick={() => onPick('decks')}>{t('decks')}</button>
          <button className="btn btn--ghost" type="button" onClick={() => onPick('rules')}>{t('rules')}</button>
          <button className="btn btn--ghost" type="button" onClick={() => onPick('online')}>{t('online')}</button>
        </nav>
        <button className="btn btn--ghost library-home__settings" type="button" aria-haspopup="dialog" onClick={() => setSettingsOpen(true)}>{t('settings')}</button>
      </header>
      {migration && <section className="library-home__migration" aria-label={t('centralTools')}>
        <CentralImportResult result={migration} />
        <span className="decks__new">
          <button type="button" className="btn btn--primary" onClick={() => { setMigrationSeen(true); onPick('decks'); }}>{t('decks')}</button>
          <button type="button" className="btn btn--ghost" onClick={() => setMigrationSeen(true)}>{t('close')}</button>
        </span>
      </section>}
      <div className="library-home__body">
        <nav className="library-home__rail" aria-label={t('gameModes')}>
          {HOME_MODES.filter(mode => mode.id !== 'online').map(mode => (
            <button type="button" key={mode.id} title={t(mode.hint)} onClick={() => onPick(mode.id)}>
              <ModeIcon mode={mode.id} /><span>{t(mode.name)}</span>
            </button>
          ))}
        </nav>
        <div className="library-home__content">
          <section className="library-home__feature" aria-labelledby="featured-mode">
            <div className="library-home__feature-copy">
              <h2 id="featured-mode">{t(featured.name)}</h2>
              {history[featured.id] && <p className="library-home__feature-count">{playCount(featured.id)}</p>}
              <button className="btn btn--primary" type="button" title={t(featured.hint)} onClick={() => onPick(featured.id)}>
                {t(featured.id === 'commander' ? 'prepareMatch' : 'openMode', { mode: t(featured.name) })}
              </button>
            </div>
            <ModeArtwork mode={featured.id} imageKey={history[featured.id]?.imageKey} />
          </section>
          <section className="library-home__popular" aria-labelledby="popular-modes">
            <h2 id="popular-modes" title={t('mostPlayedHint')}>{t('mostPlayedModes')}</h2>
            {popular.length ? <div className="library-home__shortcuts">
              {popular.map(id => {
                const mode = HOME_MODES.find(mode => mode.id === id)!;
                return <button type="button" className="library-home__shortcut" key={id} title={t(mode.hint)} onClick={() => onPick(id)}>
                  <ModeArtwork mode={id} imageKey={history[id]?.imageKey} />
                  <span className="library-home__shortcut-copy"><strong>{t(mode.name)}</strong><span>{playCount(id)}</span></span>
                </button>;
              })}
            </div> : <p className="library-home__empty">{t('mostPlayedEmpty')}</p>}
          </section>
        </div>
      </div>
      {settingsOpen && <SettingsDialog engine={engine} onClose={() => setSettingsOpen(false)} />}
    </main>
  );
}
