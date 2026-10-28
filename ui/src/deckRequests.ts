import { useEffect, useRef, useState } from 'react';
import type { DeckServicesReply } from './engine';
import type { Engine } from './useEngine';

// Online deck-tools requests carry an id; only the reply to the latest one of a kind is used.
let nextRequest = 0;
export const nextRequestId = () => ++nextRequest;

/** The reply to the latest request of this kind, or the error for it. */
export function reply<T extends DeckServicesReply['type']>(engine: Engine, type: Exclude<T, 'servicesError'>, id: number) {
  const r = engine.deckServices[type];
  return r && r.requestId === id ? r as Extract<DeckServicesReply, { type: T | 'servicesError' }> : null;
}

/** Sends a request with a fresh id whenever `deps` change or on retry; replies with another id are stale. */
export function useRequest(send: (requestId: number) => void, deps: unknown[]) {
  const id = useRef(0);
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    id.current = nextRequestId();
    send(id.current);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [...deps, attempt]);
  return { id, retry: () => setAttempt((n) => n + 1) };
}

