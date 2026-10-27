import { useEffect, useMemo, useState } from 'react';
import type { CentralDeck } from './centralBridge';
import type { Engine } from './useEngine';
import { useT } from './i18n';
import { DeckCards } from './DeckCards';

/** Native preview and an explicit start; external lists are never persisted by this screen. */
export function CentralDeckScreen({ engine, deck, onBack }: { engine: Engine; deck: CentralDeck; onBack: () => void }) {
  const t = useT();
  const [opponents, setOpponents] = useState(1);
  const [starting, setStarting] = useState(false);
  const requestId = useMemo(() => crypto.randomUUID(), [deck]);
  const { send } = engine;
  useEffect(() => { setStarting(false); send({ type: 'previewDeck', text: deck.text, name: deck.name, requestId }); }, [deck, requestId, send]);
  const preview = engine.deckPreview?.requestId === requestId ? engine.deckPreview : null;
  const valid = preview && preview.unknown === 0 && (preview.cards ?? 0) > (preview.commanders?.length ?? 0) && !!preview.commanders?.length;
  const busy = starting && !engine.error;
  return <main className="import central-deck">
    <header className="import__head"><button className="btn btn--ghost" type="button" disabled={busy} onClick={onBack}>{t('mainMenu')}</button><h1>{deck.name}</h1></header>
    <form className="central-deck__actions" onSubmit={e => {
      e.preventDefault();
      if (!valid || busy) return;
      setStarting(true);
      send({ type: 'startDeckMatch', name: deck.name, text: deck.text, opponents });
    }}>
      <fieldset className="segmented" disabled={busy}>
        <legend>{t('opponents')}</legend>
        {[1, 2, 3].map(n => <label key={n}><input type="radio" name="opponents" checked={opponents === n} onChange={() => setOpponents(n)} />{n}</label>)}
      </fieldset>
      <button className="btn btn--primary" type="submit" disabled={!valid || busy}>{t(busy ? 'shuffling' : 'play')}</button>
      {engine.error && preview && <p className="error" role="alert">{engine.error}</p>}
    </form>
    {!preview ? <p role="status">{engine.error ?? t('centralCheckingDeck')}</p> : <>
      {preview.unknown > 0 && <p className="error" role="alert">{t('centralUnknownCards', { n: preview.unknown })}</p>}
      {!preview.commanders?.length && <p className="error" role="alert">{t('centralNoCommander')}</p>}
      <DeckCards preview={preview} />
    </>}
  </main>;
}
