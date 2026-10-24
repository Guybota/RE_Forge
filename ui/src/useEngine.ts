import { useCallback, useEffect, useRef, useState } from 'react';
import type { MessageKey } from './i18n';
import type { LobbyState, ChatMessage } from './engine';
import { setImageBase } from './images';
import { connectEngine, enginePort, type Choice, type ClientMessage, type CardResults, type DeckDetail, type DeckLists, type Printings, type DeckPreview, type EngineConnection, type EngineInfo, type GameState, type Notice } from './engine';

export type Engine = {
  status: 'connecting' | 'ready' | 'failed';
  failure: MessageKey | null;
  info: EngineInfo | null;
  decks: DeckLists;
  /** The latest reply to previewDeck. */
  deckPreview: DeckPreview | null;
  /** The latest reply to getDeck. */
  deckDetail: DeckDetail | null;
  /** The latest replies to searchCards and getPrintings (deck builder). */
  cardResults: CardResults | null;
  printings: Printings | null;
  game: GameState | null;
  choice: Choice | null;
  notice: (Notice & { at: number }) | null;
  error: string | null;
  lobby: LobbyState | null;
  chat: ChatMessage[];
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
  const [deckDetail, setDeckDetail] = useState<DeckDetail | null>(null);
  const [cardResults, setCardResults] = useState<CardResults | null>(null);
  const [printings, setPrintings] = useState<Printings | null>(null);
  const [game, setGame] = useState<GameState | null>(null);
  const [choice, setChoice] = useState<Choice | null>(null);
  const [notice, setNotice] = useState<Engine['notice']>(null);
  const [error, setError] = useState<string | null>(null);
  const [lobby, setLobby] = useState<LobbyState | null>(null);
  const [chat, setChat] = useState<ChatMessage[]>([]);
  const conn = useRef<EngineConnection | null>(null);
  // After leaving a match its last states and questions may still arrive; they must not reopen the table.
  const left = useRef(false);

  useEffect(() => {
    if (!port) return;
    const c = connectEngine(port, {
      onInfo: (i) => {
        setImageBase(i.imageBase, i.language);
        setInfo(i);
        setStatus('ready');
      },
      onDecks: setDecks,
      onDeckPreview: setDeckPreview,
      onDeckDetail: setDeckDetail,
      onCardResults: setCardResults,
      onPrintings: setPrintings,
      onState: (g) => { if (!left.current) setGame(g); },
      onChoice: (q) => { if (!left.current) setChoice(q); },
      onNotice: (n) => setNotice({ ...n, at: Date.now() }),
      onLobby: (l) => {
        if (l) left.current = false;
        setLobby(l);
        if (!l) { setGame(null); setChoice(null); setChat([]); }
      },
      onChat: (m) => setChat((messages) => [...messages.slice(-199), m]),
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
    if (m.type === 'startMatch' || m.type === 'startOnlineMatch') left.current = false;
    conn.current?.send(m);
  }, []);

  const answer = useCallback<Engine['answer']>(
    (a) => {
      if (choice) send({ type: 'answer', id: choice.id, ...a });
      setChoice(null);
    },
    [choice, send],
  );

  const leaveGame = useCallback(() => {
    left.current = true;
    setGame(null);
    setChoice(null);
  }, []);

  return { status, failure, info, decks, deckPreview, deckDetail, cardResults, printings, game, choice, notice, error, lobby, chat, send, answer, leaveGame };
}
