import type { Engine } from './useEngine';

/** First-run step 1 (then skin, then play). Each language is shown by its own name, so no other text is needed. */
export function LanguagePicker({ engine, onDone }: { engine: Engine; onDone?: () => void }) {
  const languages = engine.info?.languages ?? [];
  const current = engine.info?.language;

  return (
    <main className="home">
      <h1>RE:Forge</h1>
      <ul className="languages" aria-label="Idioma · Language">
        {languages.map((l) => (
          <li key={l.code}>
            <button
              type="button"
              lang={l.code}
              className={`languages__option ${l.code === current ? 'is-on' : ''}`}
              aria-pressed={l.code === current}
              onClick={() => {
                engine.send({ type: 'setLanguage', language: l.code });
                onDone?.();
              }}
            >
              {l.name}
            </button>
          </li>
        ))}
      </ul>
      {engine.error && <p className="error">{engine.error}</p>}
    </main>
  );
}
