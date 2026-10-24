import { useEffect, useMemo, useState } from 'react';
import { Home } from './Home';
import { Lobby } from './Lobby';
import { ImportDeck } from './ImportDeck';
import { Decks } from './Decks';
import { I18n, translator } from './i18n';
import { LanguagePicker } from './LanguagePicker';
import { DEFAULT_SKIN } from './skins';
import { SkinPicker } from './SkinPicker';
import { Table } from './table/Table';
import { CardZoomProvider } from './table/CardZoom';
import { useEngine } from './useEngine';
import './App.css';

export default function App() {
  const engine = useEngine();
  const [picking, setPicking] = useState<'language' | 'skin' | 'decks' | 'import' | 'online' | null>(null);
  // The deck last saved, edited or chosen to play: preselected on the decks and home screens.
  const [lastDeck, setLastDeck] = useState<string | undefined>();
  const [editing, setEditing] = useState<{ name: string; text: string } | undefined>();
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
        {engine.status === 'connecting' ? <p className="muted">{t('connecting')}</p> : <p className="error">{t(engine.failure ?? 'engineLost')}</p>}
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
  } else if (picking === 'import') {
    screen = (
      <ImportDeck
        key={editing?.name ?? ''}
        engine={engine}
        editing={editing}
        onDone={(saved) => {
          if (saved) setLastDeck(saved);
          setEditing(undefined);
          setPicking('decks');
        }}
      />
    );
  } else if (picking === 'decks') {
    screen = (
      <Decks
        engine={engine}
        initialDeck={lastDeck}
        onBack={() => setPicking(null)}
        onPlay={(deck) => { setLastDeck(deck); setPicking(null); }}
        onImport={() => { setEditing(undefined); setPicking('import'); }}
        onEdit={(deck) => { setEditing(deck); setPicking('import'); }}
      />
    );
  } else {
    // key: remount so the deck chosen on the decks screen becomes the selection.
    screen = <Home key={lastDeck} engine={engine} onPick={setPicking} initialDeck={lastDeck} />;
  }

  return <I18n.Provider value={t}><CardZoomProvider>{screen}</CardZoomProvider></I18n.Provider>;
}
