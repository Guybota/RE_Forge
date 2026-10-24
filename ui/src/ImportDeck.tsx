import { useEffect, useRef, useState } from 'react';
import { DeckCards } from './DeckCards';
import { useT } from './i18n';
import type { Engine } from './useEngine';

/**
 * Paste a decklist (Moxfield, Archidekt, MTG Arena, MTGO), check it line by line, save it.
 * With `editing`, the same screen changes one of the player's decks (a new name replaces the old deck).
 */
export function ImportDeck({ engine, onDone, editing }: {
  engine: Engine;
  onDone: (savedName: string | null) => void;
  editing?: { name: string; text: string };
}) {
  const t = useT();
  const [text, setText] = useState(editing?.text ?? '');
  const [name, setName] = useState(editing?.name ?? '');
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
    // Otherwise the commander's name is a good default.
    const fallback = preview?.name || preview?.commanders?.[0];
    if (fallback && !name && !suggested.current) {
      suggested.current = true;
      setName(fallback);
    }
  }, [preview, name]);

  // The engine answers a save with a new deck list (the name may already be there when a deck is replaced).
  const decksAtSave = useRef(engine.decks);
  useEffect(() => {
    if (!saving || engine.decks === decksAtSave.current || !engine.decks.mine.includes(name.trim())) return;
    if (editing && editing.name !== name.trim()) send({ type: 'deleteDeck', name: editing.name });
    onDone(name.trim());
  }, [saving, engine.decks, name, onDone, editing, send]);
  useEffect(() => {
    if (engine.error) setSaving(false);
  }, [engine.error]);

  const canSave = !!preview?.cards && !!name.trim() && !saving;

  return (
    <main className={`import ${preview ? 'import--preview' : ''}`}>
      <header className="import__head">
        <button type="button" className="btn btn--ghost" onClick={() => onDone(null)}>{t('back')}</button>
        <h1>{editing ? editing.name : t('importDeck')}</h1>
      </header>
      <div className="import__body">
        <div className="import__left">
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
          <form
            className="import__save"
            onSubmit={(e) => {
              e.preventDefault();
              decksAtSave.current = engine.decks;
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
        </div>
        {preview && <DeckCards preview={preview} />}
      </div>
    </main>
  );
}
