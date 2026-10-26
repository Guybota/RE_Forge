import { useEffect, useMemo, useState } from 'react';
import { Home } from './Home';
import { QuickMatch } from './QuickMatch';
import { CampaignScreen } from './campaigns/CampaignScreen';
import { LimitedScreen } from './modes/LimitedScreen';
import { PuzzleScreen } from './modes/PuzzleScreen';
import { Lobby } from './Lobby';
import { ImportDeck } from './ImportDeck';
import { Decks } from './Decks';
import { DeckBuilder } from './DeckBuilder';
import type { DeckDetail } from './engine';
import { I18n, translator } from './i18n';
import { LanguagePicker } from './LanguagePicker';
import { DEFAULT_SKIN } from './skins';
import { SkinPicker } from './SkinPicker';
import { Table } from './table/Table';
import { CardZoomProvider } from './table/CardZoom';
import { useEngine } from './useEngine';
import './App.css';
import { installClickSounds } from './audio/sounds';
import { installAppearanceSettings } from './settings/appearancePrefs';
import './settings/appearance.css';

export default function App() {
  useEffect(installClickSounds, []);
  useEffect(installAppearanceSettings, []);
  const engine = useEngine();
  const [picking, setPicking] = useState<'language' | 'skin' | 'decks' | 'import' | 'builder' | 'online' | 'commander' | 'quest' | 'adventure' | 'draft' | 'sealed' | 'puzzles' | null>(null);
  // The deck last saved, edited or chosen to play: preselected on the decks and home screens.
  const [lastDeck, setLastDeck] = useState<string | undefined>();
  const [building, setBuilding] = useState<DeckDetail | undefined>();
  // Before the engine says which language was chosen, follow the system's.
  const language = engine.info?.language ?? navigator.language;
  const t = useMemo(() => translator(language), [language]);
  const skin = engine.info?.skin ?? DEFAULT_SKIN;

  useEffect(() => {
    document.documentElement.dataset.skin = skin;
    document.documentElement.lang = language;
  }, [skin, language]);

  let screen;
  if (engine.status !== 'ready') {
    screen = (
      <main className="home">
        <h1>RE:Forge</h1>
        {engine.status === 'connecting' ? <div className="app-loading" role="status">
          <p className="muted">{t('connecting')}</p>
          <progress aria-label={t('loadingApplication')} />
        </div> : <p className="error">{t(engine.failure ?? 'engineLost')}</p>}
      </main>
    );
  } else if (engine.game) {
    screen = <Table engine={engine} game={engine.game} />;
  } else if (engine.lobby || picking === 'online') {
    screen = <Lobby engine={engine} onBack={() => setPicking(null)} />;
  } else if (!engine.info?.language || picking === 'language') {
    // First run: 1. language, 2. skin, 3. play.
    screen = <LanguagePicker engine={engine} onDone={() => setPicking(null)} />;
  } else if (!engine.info?.skin || picking === 'skin') {
    screen = <SkinPicker engine={engine} onDone={() => setPicking(null)} onBack={() => setPicking('language')} />;
  } else if (picking === 'quest' || picking === 'adventure') {
    screen = <CampaignScreen key={picking} mode={picking} engine={engine} onBack={() => setPicking(null)} />;
  } else if (picking === 'draft' || picking === 'sealed') {
    screen = <LimitedScreen key={picking} mode={picking} engine={engine} onBack={() => setPicking(null)} />;
  } else if (picking === 'puzzles') {
    screen = <PuzzleScreen engine={engine} onBack={() => setPicking(null)} />;
  } else if (picking === 'commander') {
    screen = <QuickMatch key={lastDeck} engine={engine} onPick={setPicking} initialDeck={lastDeck} onBack={() => setPicking(null)} />;
  } else if (picking === 'import' || picking === 'builder') {
    const done = (saved: string | null) => {
      if (saved) setLastDeck(saved);
      setPicking('decks');
    };
    screen = picking === 'import'
      ? <ImportDeck engine={engine} onDone={done} />
      : <DeckBuilder key={building?.name ?? ''} engine={engine} initial={building} onDone={done} />;
  } else if (picking === 'decks') {
    screen = (
      <Decks
        engine={engine}
        initialDeck={lastDeck}
        onBack={() => setPicking(null)}
        onPlay={(deck) => { setLastDeck(deck); setPicking('commander'); }}
        onImport={() => setPicking('import')}
        onBuild={(deck) => { setBuilding(deck); setPicking('builder'); }}
      />
    );
  } else {
    // key: remount so the deck chosen on the decks screen becomes the selection.
    screen = <Home engine={engine} onPick={setPicking} />;
  }

  return <I18n.Provider value={t}><CardZoomProvider>{screen}</CardZoomProvider></I18n.Provider>;
}
