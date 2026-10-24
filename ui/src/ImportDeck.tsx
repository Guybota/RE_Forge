import { useEffect, useRef, useState } from 'react';
import type { DeckPreview } from './engine';
import { useT, type MessageKey } from './i18n';
import { cardImage } from './images';
import type { Engine } from './useEngine';

type Line = DeckPreview['lines'][number];
const GROUPS: { id: string; label: MessageKey }[] = [
  { id: 'commander', label: 'commander' }, { id: 'creature', label: 'groupCreatures' }, { id: 'planeswalker', label: 'groupPlaneswalkers' },
  { id: 'instant', label: 'groupInstants' }, { id: 'sorcery', label: 'groupSorceries' }, { id: 'artifact', label: 'groupArtifacts' },
  { id: 'enchantment', label: 'groupEnchantments' }, { id: 'battle', label: 'groupBattles' }, { id: 'land', label: 'groupLands' },
  { id: 'other', label: 'groupOther' },
];

/** Paste a decklist (Moxfield, Archidekt, MTG Arena, MTGO), check it line by line, save it. */
export function ImportDeck({ engine, onDone }: { engine: Engine; onDone: (savedName: string | null) => void }) {
  const t = useT();
  const [text, setText] = useState('');
  const [name, setName] = useState('');
  const [saving, setSaving] = useState(false);
  const [hovered, setHovered] = useState<Line | null>(null);
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

  // The engine answers a save with the new deck list.
  useEffect(() => {
    if (saving && engine.decks.mine.includes(name.trim())) onDone(name.trim());
  }, [saving, engine.decks, name, onDone]);
  useEffect(() => {
    if (engine.error) setSaving(false);
  }, [engine.error]);

  const canSave = !!preview?.cards && !!name.trim() && !saving;
  const loose = preview?.lines.filter((l) => !l.group) ?? [];
  const picture = hovered?.imageKey ? cardImage(hovered.imageKey, 'full') : null;
  const line = (l: Line, i: number) => (
    <li key={i} className={`import__line import__line--${l.status}`} title={l.message ?? l.text}
      onMouseEnter={() => setHovered(l)} onMouseLeave={() => setHovered(null)}>
      {l.group ? <><span className="import__qty">{l.qty}</span> {l.name}</> : l.text}
    </li>
  );

  return (
    <main className={`import ${preview ? 'import--preview' : ''}`}>
      <header className="import__head">
        <button type="button" className="btn btn--ghost" onClick={() => onDone(null)}>{t('back')}</button>
        <h1>{t('importDeck')}</h1>
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
        {preview && <section className="import__preview" aria-live="polite">
          {(
            <>
              <p className="import__summary">
                <span>{t('cardsCount', { n: preview.cards ?? 0 })}</span>
                {preview.unknown > 0 && <span className="danger">{t('unknownCount', { n: preview.unknown })}</span>}
                {preview.problem && <span className="import__problem" title={preview.problem}>{t('notLegal')}</span>}
              </p>
              <div className="import__groups">
                {loose.length > 0 && <ul className="import__lines">{loose.map(line)}</ul>}
                {GROUPS.map((g) => {
                  const lines = preview.lines.filter((l) => l.group === g.id);
                  if (!lines.length) return null;
                  const count = lines.reduce((n, l) => n + (l.qty ?? 0), 0);
                  return (
                    <section key={g.id} className="import__group">
                      <h2>{t(g.label)} <span className="muted">{count}</span></h2>
                      <ul className="import__lines">{lines.map(line)}</ul>
                    </section>
                  );
                })}
              </div>
            </>
          )}
        </section>}
        {picture && <img className="import__picture" src={picture} alt="" aria-hidden="true" />}
      </div>
    </main>
  );
}
