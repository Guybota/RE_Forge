import { useCallback, useEffect, useRef, useState } from 'react';
import type { MessageKey } from './i18n';
import { setImageBase } from './images';
import { connectEngine, enginePort, type Choice, type ClientMessage, type DeckLists, type DeckPreview, type EngineConnection, type EngineInfo, type GameState, type Notice } from './engine';

export type Engine = {
  status: 'connecting' | 'ready' | 'failed';
  failure: MessageKey | null;
  info: EngineInfo | null;
  decks: DeckLists;
  /** The latest reply to previewDeck. */
  deckPreview: DeckPreview | null;
  game: GameState | null;
  choice: Choice | null;
  notice: (Notice & { at: number }) | null;
  error: string | null;
  send: (m: ClientMessage) => void;
  /** Answers the open choice and closes it locally. */
  answer: (a: Omit<Extract<ClientMessage, { type: 'answer' }>, 'type' | 'id'>) => void;
  leaveGame: () => void;
};

export function useEngine(): Engine {
  const port = enginePort();
  const [status, setStatus] = useState<Engine['status']>(port ? 'connecting' : 'failed');
  const [failure, setFailure] = useState<MessageKey | null>(port ? null : 'noEngine');
  const [info, setInfo] = useState<EngineInfo | null>(null);
  const [decks, setDecks] = useState<DeckLists>({ mine: [], precons: [] });
  const [deckPreview, setDeckPreview] = useState<DeckPreview | null>(null);
  const [game, setGame] = useState<GameState | null>(null);
  const [choice, setChoice] = useState<Choice | null>(null);
  const [notice, setNotice] = useState<Engine['notice']>(null);
  const [error, setError] = useState<string | null>(null);
  const conn = useRef<EngineConnection | null>(null);

  useEffect(() => {
    if (!port) return;
    const c = connectEngine(port, {
      onInfo: (i) => {
        setImageBase(i.imageBase);
        setInfo(i);
        setStatus('ready');
      },
      onDecks: setDecks,
      onDeckPreview: setDeckPreview,
      onState: setGame,
      onChoice: setChoice,
      onNotice: (n) => setNotice({ ...n, at: Date.now() }),
      onError: setError,
      onClosed: () => {
        setStatus('failed');
        setFailure('engineLost');
      },
    });
    conn.current = c;
    return () => c.close();
  }, [port]);

  const send = useCallback((m: ClientMessage) => {
    setError(null);
    conn.current?.send(m);
  }, []);

  const answer = useCallback<Engine['answer']>(
    (a) => {
      if (choice) send({ type: 'answer', id: choice.id, ...a });
      setChoice(null);
    },
    [choice, send],
  );

  const leaveGame = useCallback(() => setGame(null), []);

  return { status, failure, info, decks, deckPreview, game, choice, notice, error, send, answer, leaveGame };
}
