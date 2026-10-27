import { useEffect, useState } from 'react';
import type { DeckSummary } from './engine';
import type { Engine } from './useEngine';
import { useT } from './i18n';

let nextRequest = 0;

export function DeckLanguageStatus({ engine, deck, language, languageName }: {
  engine: Engine; deck: DeckSummary; language: string; languageName: string;
}) {
  const t = useT();
  const [retry, setRetry] = useState(0);
  const [requestId, setRequestId] = useState(-1);
  const send = engine.send;
  useEffect(() => {
    const id = ++nextRequest;
    setRequestId(id);
    const timer = window.setTimeout(() => send({ type: 'deckLanguage', requestId: id, name: deck.name, source: deck.source }), 300);
    return () => { window.clearTimeout(timer); send({ type: 'cancelDeckLanguage' }); };
  }, [deck.name, deck.source, language, retry, send]);
  const reply = engine.deckLanguage;
  const result = reply?.requestId === requestId && reply.name === deck.name && reply.source === deck.source && reply.language === language ? reply : null;
  const pending = !result?.done;
  const total = result?.total ?? deck.cards ?? 0;
  const available = result?.available ?? 0;
  // One decimal preserves meaningful partial availability (99/100 must never round to 100%).
  const percent = total ? Math.floor(available * 1000 / total) / 10 : 0;
  const key = pending ? 'deckLanguageChecking' : !total || result.unknown === total ? 'deckLanguageFailed'
    : result.unknown ? 'deckLanguageIncomplete' : !available ? 'deckLanguageMissing'
    : available === total ? 'deckLanguageAll' : 'deckLanguagePartial';
  return <div className="deck-language" title={t('deckLanguageScope')} data-warning={!!result && (result.missing > 0 || result.unknown > 0)}>
    <div role="status" aria-live="polite" aria-atomic="true">
      <p>{t(key, { language: languageName, percent: percent.toLocaleString(language), available, total })}</p>
      {pending && <progress aria-label={t('deckLanguageProgress')} value={result?.checked ?? 0} max={total || 1} />}
      {!pending && result && result.unknown > 0 && result.unknown < total && <p>{t('deckLanguageUnknown', { n: result.unknown })}</p>}
    </div>
    {!pending && result && (result.unknown > 0 || !total) && <button type="button" className="btn btn--ghost" onClick={() => setRetry(n => n + 1)}>{t('deckLanguageRetry')}</button>}
  </div>;
}
