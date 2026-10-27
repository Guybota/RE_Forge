import { useEffect, useRef, useState } from 'react';
import { useT } from './i18n';
import type { Engine } from './useEngine';

/** Paste a decklist (Moxfield, Archidekt, MTG Arena, MTGO), check it line by line, save it. */
export function ImportDeck({ engine, onDone }: { engine: Engine; onDone: (savedName: string | null) => void }) {
  const t = useT();
  const [text, setText] = useState('');
  const [name, setName] = useState('');
  const [saving, setSaving] = useState(false);
  const preview = text.trim() ? engine.deckPreview : null;
  const { send } = engine;

  // Ask the engine to read the list a moment after typing stops.
  useEffect(() => {
    if (!text.trim()) return;
    const timer = setTimeout(() => send({ type: 'previewDeck', text, name }), 350);
    return () => clearTimeout(timer);
  }, [text, name, send]);

  // A deck name in the list itself (e.g. "Name ..." lines) fills an empty name field.
  const suggested = useRef(false);
  useEffect(() => {
    if (preview?.name && !name && !suggested.current) {
      suggested.current = true;
      setName(preview.name);
    }
  }, [preview, name]);

  // The engine answers a save with the new deck list.
  useEffect(() => {
    if (saving && engine.decks.mine.includes(name.trim())) onDone(name.trim());
  }, [saving, engine.decks, name, onDone]);
  useEffect(() => {
    if (engine.error) setSaving(false);
  }, [engine.error]);

  const canSave = !!preview?.cards && !!name.trim() && !saving;

  return (
    <main className="import">
      <header className="import__head">
        <button type="button" className="btn btn--ghost" onClick={() => onDone(null)}>{t('back')}</button>
        <h1>{t('importDeck')}</h1>
      </header>
      <div className="import__body">
        <label className="field-label import__paste">
          {t('decklist')}
          <textarea
            className="input"
            value={text}
            onChange={(e) => setText(e.target.value)}
            placeholder={'Commander\n1 Atraxa, Praetors\' Voice\n\nDeck\n1 Sol Ring\n…'}
            spellCheck={false}
            autoFocus
          />
        </label>
        <section className="import__preview" aria-live="polite">
          {preview && (
            <>
              <p className="import__summary">
                <span>{t('cardsCount', { n: preview.cards ?? 0 })}</span>
                {!!preview.commanders?.length && <span>{t('commander')}: {preview.commanders.join(' · ')}</span>}
                {preview.unknown > 0 && <span className="danger">{t('unknownCount', { n: preview.unknown })}</span>}
                {preview.problem && <span className="import__problem" title={preview.problem}>{t('notLegal')}</span>}
              </p>
              <ul className="import__lines">
                {preview.lines.map((l, i) => (
                  <li key={i} className={`import__line import__line--${l.status}`} title={l.message}>{l.text}</li>
                ))}
              </ul>
            </>
          )}
        </section>
      </div>
      <form
        className="import__save"
        onSubmit={(e) => {
          e.preventDefault();
          setSaving(true);
          send({ type: 'saveDeck', text, name: name.trim() });
        }}
      >
        <label className="field-label">
          {t('deckName')}
          <input className="input" value={name} onChange={(e) => setName(e.target.value)} />
        </label>
        <button type="submit" className="btn btn--primary" disabled={!canSave}>{t('save')}</button>
        {engine.error && <p className="error">{engine.error}</p>}
      </form>
    </main>
  );
}
