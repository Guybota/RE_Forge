import { useMemo, useState } from 'react';
import { Home } from './Home';
import { I18n, translator } from './i18n';
import { LanguagePicker } from './LanguagePicker';
import { Table } from './table/Table';
import { useEngine } from './useEngine';
import './App.css';

export default function App() {
  const engine = useEngine();
  const [pickingLanguage, setPickingLanguage] = useState(false);
  // Before the engine says which language was chosen, follow the system's.
  const language = engine.info?.language ?? navigator.language;
  const t = useMemo(() => translator(language), [language]);

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
  } else if (!engine.info?.language || pickingLanguage) {
    // First run: language comes first. The skin choice will follow here once skins exist.
    screen = <LanguagePicker engine={engine} onDone={() => setPickingLanguage(false)} />;
  } else {
    screen = <Home engine={engine} onChangeLanguage={() => setPickingLanguage(true)} />;
  }

  return <I18n.Provider value={t}>{screen}</I18n.Provider>;
}
