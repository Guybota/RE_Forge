import { useEffect, useRef, useState } from 'react';
import { DeckCards } from './DeckCards';
import { fileToDecklist, replaceUnknownLine } from './decklistFiles';
import { useT } from './i18n';
import type { Engine } from './useEngine';

const LINK_ERRORS = ['linkUnsupported', 'linkNotFound', 'linkUnavailable'] as const;

/**
 * Paste a decklist (Moxfield, Archidekt, MTG Arena, MTGO), open a file or fetch a deck link; check it line by line,
 * pick the commander, fix unknown cards from suggestions, save it.
 */
export function ImportDeck({ engine, onDone }: { engine: Engine; onDone: (savedName: string | null) => void }) {
  const t = useT();
  const [text, setText] = useState('');
  const [name, setName] = useState('');
  const [link, setLink] = useState('');
  const [fetching, setFetching] = useState(false);
  const [dragging, setDragging] = useState(false);
  const [saving, setSaving] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);
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

  // A new list from a file or a link replaces the text, and its name the field.
  const load = (list: string, listName?: string) => {
    setText(list);
    if (listName) { suggested.current = true; setName(listName); }
  };

  // Fetched links and lists with a newly chosen commander come back as deckText; one seen before this screen opened is stale.
  const seenText = useRef(engine.deckText);
  useEffect(() => {
    if (!engine.deckText || engine.deckText === seenText.current) return;
    seenText.current = engine.deckText;
    setFetching(false);
    load(engine.deckText.text, engine.deckText.name);
  }, [engine.deckText]);

  const openFile = async (file: File | undefined) => {
    if (!file) return;
    const list = fileToDecklist(file.name, await file.text());
    load(list.text, list.name);
  };

  // The engine answers a save with a new deck list (the name may already be there when a deck is replaced).
  const decksAtSave = useRef(engine.decks);
  useEffect(() => {
    if (!saving || engine.decks === decksAtSave.current || !engine.decks.mine.includes(name.trim())) return;
    onDone(name.trim());
  }, [saving, engine.decks, name, onDone]);
  useEffect(() => {
    if (engine.error) { setSaving(false); setFetching(false); }
  }, [engine.error]);

  const linkError = LINK_ERRORS.find((key) => key === engine.error);
  const canSave = !!preview?.cards && !!name.trim() && !saving;

  return (
    <main className={`import ${preview ? 'import--preview' : ''}`}>
      <header className="import__head">
        <button type="button" className="btn btn--ghost" onClick={() => onDone(null)}>{t('back')}</button>
        <h1>{t('importDeck')}</h1>
      </header>
      <div className="import__body">
        <div className="import__left">
          <form className="import__sources" onSubmit={(e) => {
            e.preventDefault();
            setFetching(true);
            send({ type: 'fetchDeck', url: link.trim() });
          }}>
            <label className="field-label">
              {t('deckLink')}
              <input className="input" type="url" value={link} onChange={(e) => setLink(e.target.value)}
                placeholder="https://moxfield.com/decks/…" spellCheck={false} />
            </label>
            <button type="submit" className="btn" disabled={!link.trim() || fetching}>{fetching ? t('fetchingLink') : t('fetchLink')}</button>
            <button type="button" className="btn btn--ghost" title={t('openFileHint')} onClick={() => fileInput.current?.click()}>{t('openFile')}</button>
            <input ref={fileInput} type="file" accept=".txt,.dek,.dck,.dec,text/plain" hidden
              onChange={(e) => { void openFile(e.target.files?.[0]); e.target.value = ''; }} />
            {linkError && <p className="error" role="alert">{t(linkError)}</p>}
          </form>
          <label className={`field-label import__paste${dragging ? ' import__drop' : ''}`}
            onDragOver={(e) => { if (e.dataTransfer.types.includes('Files')) { e.preventDefault(); setDragging(true); } }}
            onDragLeave={() => setDragging(false)}
            onDrop={(e) => {
              setDragging(false);
              if (!e.dataTransfer.files.length) return;
              e.preventDefault();
              void openFile(e.dataTransfer.files[0]);
            }}>
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
            {engine.error && !linkError && <p className="error">{engine.error}</p>}
          </form>
        </div>
        {preview && <DeckCards preview={preview}
          onCommander={(card) => send({ type: 'chooseCommander', text, name: card })}
          onReplace={(requested, card) => setText(replaceUnknownLine(text, requested, card))} />}
      </div>
    </main>
  );
}
