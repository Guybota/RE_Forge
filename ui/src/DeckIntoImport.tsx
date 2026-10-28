import { useEffect, useRef, useState } from 'react';
import { DeckCards } from './DeckCards';
import { fileToDecklist, isCentralLibrary, replaceUnknownLine } from './decklistFiles';
import { mergeDecklists } from './deckText';
import { useT } from './i18n';
import type { Engine } from './useEngine';

const LINK_ERRORS = ['linkUnsupported', 'linkNotFound', 'linkUnavailable'] as const;

/**
 * Paste, open a file or fetch a link into an owned deck: add the cards, or replace the list.
 * A Central library file is refused here (that creates new decks from the shelf Import).
 */
export function DeckIntoImport({ engine, deckName, currentText, onClose }: {
  engine: Engine;
  deckName: string;
  currentText: string;
  onClose: () => void;
}) {
  const t = useT();
  const ref = useRef<HTMLDialogElement>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  const [text, setText] = useState('');
  const [link, setLink] = useState('');
  const [fetching, setFetching] = useState(false);
  const [dragging, setDragging] = useState(false);
  const [libraryRefused, setLibraryRefused] = useState(false);
  const [saving, setSaving] = useState(false);
  const preview = text.trim() ? engine.deckPreview : null;
  const { send } = engine;

  useEffect(() => {
    const dialog = ref.current;
    dialog?.showModal();
    return () => dialog?.close();
  }, []);

  useEffect(() => {
    if (!text.trim()) return;
    const timer = setTimeout(() => send({ type: 'previewDeck', text, name: deckName }), 350);
    return () => clearTimeout(timer);
  }, [text, deckName, send]);

  const seenText = useRef(engine.deckText);
  useEffect(() => {
    if (!engine.deckText || engine.deckText === seenText.current) return;
    seenText.current = engine.deckText;
    setFetching(false);
    setText(engine.deckText.text);
  }, [engine.deckText]);

  useEffect(() => {
    if (engine.error) { setSaving(false); setFetching(false); }
  }, [engine.error]);

  const openFile = async (file: File | undefined) => {
    if (!file) return;
    const content = await file.text();
    if (isCentralLibrary(content)) {
      setLibraryRefused(true);
      return;
    }
    setLibraryRefused(false);
    const list = fileToDecklist(file.name, content);
    setText(list.text);
  };

  const apply = (mode: 'add' | 'replace') => {
    if (!preview?.cards || saving) return;
    if (mode === 'replace' && !window.confirm(t('importIntoReplaceConfirm', { name: deckName }))) return;
    const next = mode === 'add' ? mergeDecklists(currentText, text) : text;
    setSaving(true);
    send({ type: 'saveDeck', text: next, name: deckName, from: deckName });
    send({ type: 'getDeck', name: deckName });
    onClose();
  };

  const linkError = LINK_ERRORS.find((key) => key === engine.error);
  const canApply = !!preview?.cards && !saving;

  return (
    <dialog ref={ref} className="choice game-menu zone deck-into-import" aria-labelledby="deck-into-import-title"
      onCancel={(e) => { e.preventDefault(); onClose(); }}>
      <header className="game-menu__head">
        <h2 id="deck-into-import-title" className="choice__title">{t('importIntoDeck')}</h2>
        <button type="button" className="btn btn--ghost" onClick={onClose}>{t('close')}</button>
      </header>
      <div className={`deck-into-import__body${preview ? ' deck-into-import__body--preview' : ''}`}>
        <div className="deck-into-import__left">
          <form className="import__sources" onSubmit={(e) => {
            e.preventDefault();
            setLibraryRefused(false);
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
            <input ref={fileInput} type="file" accept=".txt,.dek,.dck,.dec,.json,text/plain,application/json" hidden
              onChange={(e) => { void openFile(e.target.files?.[0]); e.target.value = ''; }} />
            {linkError && <p className="error" role="alert">{t(linkError)}</p>}
            {libraryRefused && <p className="error" role="alert">{t('importIntoNoLibrary')}</p>}
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
            <textarea className="input" value={text} onChange={(e) => { setLibraryRefused(false); setText(e.target.value); }}
              placeholder={'Commander\n1 Atraxa, Praetors\' Voice\n\nDeck\n1 Sol Ring\n…'}
              spellCheck={false} autoFocus />
          </label>
          {engine.error && !linkError && <p className="error" role="alert">{engine.error}</p>}
        </div>
        {preview && <DeckCards preview={preview}
          onCommander={(card) => send({ type: 'chooseCommander', text, name: card })}
          onReplace={(requested, card) => setText(replaceUnknownLine(text, requested, card))} />}
      </div>
      <div className="deck-into-import__actions">
        <button type="button" className="btn btn--primary" disabled={!canApply} onClick={() => apply('add')}>{t('importIntoAdd')}</button>
        <button type="button" className="btn btn--ghost" disabled={!canApply} onClick={() => apply('replace')}>{t('importIntoReplace')}</button>
      </div>
    </dialog>
  );
}
