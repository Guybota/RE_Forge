import { useEffect, useRef, useState } from 'react';
import type { DeckServicesReply } from './engine';
import type { Engine } from './useEngine';

// Online deck-tools requests carry an id; only the reply to the latest one of a kind is used.
let nextRequest = 0;
export const nextRequestId = () => ++nextRequest;

type ReplyOf<T extends DeckServicesReply['type']> = Extract<DeckServicesReply, { type: T | 'servicesError' }>;

/** The reply to the latest request of this kind, or the error for it. */
export function reply<T extends DeckServicesReply['type']>(engine: Engine, type: Exclude<T, 'servicesError'>, id: number) {
  const r = engine.deckServices[type];
  return r && r.requestId === id ? r as ReplyOf<T> : null;
}

/**
 * Prefer an exact requestId match; otherwise accept the stored reply when it already describes this
 * card (a late re-render can read a newer id before the matching answer lands).
 */
export function replyForCard<T extends 'cardPrice' | 'cardRulings'>(
  engine: Engine,
  type: T,
  id: number,
  nameEn: string,
): ReplyOf<T> | null {
  const exact = reply(engine, type, id);
  if (exact) return exact;
  const r = engine.deckServices[type];
  if (!r || r.requestId > id) return null;
  if (r.type === 'servicesError') return r as ReplyOf<T>;
  if (r.type === type && 'name' in r && r.name === nameEn) return r as ReplyOf<T>;
  return null;
}

/** Sends a request with a fresh id whenever `deps` change or on retry; replies with another id are stale. */
export function useRequest(send: (requestId: number) => void, deps: unknown[]) {
  // Keep the id in state so a reply triggers a render that sees the same id that was sent (a ref alone
  // updated in an effect left the UI matching requestId 0 forever when the answer arrived first).
  const [id, setId] = useState(0);
  const idRef = useRef(0);
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    const next = nextRequestId();
    idRef.current = next;
    setId(next);
    send(next);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [...deps, attempt]);
  return { id: idRef, requestId: id, retry: () => setAttempt((n) => n + 1) };
}

/**
 * Like useRequest, but only allocates an id and sends while `enabled`. Closing the gate must not bump the
 * id (that orphaned in-flight replies and left the UI on "connecting" forever).
 */
export function useGatedRequest(enabled: boolean, send: (requestId: number) => void, deps: unknown[]) {
  const [id, setId] = useState(0);
  const idRef = useRef(0);
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    if (!enabled) return;
    const next = nextRequestId();
    idRef.current = next;
    setId(next);
    send(next);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled, ...deps, attempt]);
  return { id: idRef, requestId: id, retry: () => setAttempt((n) => n + 1) };
}

