import { useCallback, useEffect, useRef, useState } from 'react';
import type { MessageKey } from './i18n';
import type { LobbyState, ChatMessage, CampaignList, CampaignState } from './engine';
import { setImageBase } from './images';
import { gameSounds } from './audio/gameSounds';
import { playSound } from './audio/sounds';
import { connectEngine, enginePort, type Choice, type ClientMessage, type CardResults, type DeckDetail, type DeckLists, type Printings, type DeckPreview, type DeckText, type ModesData, type EngineConnection, type EngineInfo, type GameState, type Notice } from './engine';

export type Engine = {
  status: 'connecting' | 'ready' | 'failed';
  failure: MessageKey | null;
  info: EngineInfo | null;
  decks: DeckLists;
  /** The latest reply to previewDeck. */
  deckPreview: DeckPreview | null;
  /** The latest fetched link or rewritten list (chooseCommander); a new object each time. */
  deckText: DeckText | null;
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
  campaigns: CampaignList | null;
  campaign: CampaignState | null;
  /** Draft, Sealed and Puzzles replies, merged as they arrive. */
  modes: ModesData;
  /** An online guest's game lost the host and Forge is reconnecting. */
  reconnecting: boolean;
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
  const [deckText, setDeckText] = useState<DeckText | null>(null);
  const [deckDetail, setDeckDetail] = useState<DeckDetail | null>(null);
  const [cardResults, setCardResults] = useState<CardResults | null>(null);
  const [printings, setPrintings] = useState<Printings | null>(null);
  const [game, setGame] = useState<GameState | null>(null);
  const [choice, setChoice] = useState<Choice | null>(null);
  const [notice, setNotice] = useState<Engine['notice']>(null);
  const [error, setError] = useState<string | null>(null);
  const [lobby, setLobby] = useState<LobbyState | null>(null);
  const [chat, setChat] = useState<ChatMessage[]>([]);
  const [campaigns, setCampaigns] = useState<CampaignList | null>(null);
  const [modes, setModes] = useState<ModesData>({});
  const [reconnecting, setReconnecting] = useState(false);
  const [campaign, setCampaign] = useState<CampaignState | null>(null);
  const conn = useRef<EngineConnection | null>(null);
  // After leaving a match its last states and questions may still arrive; they must not reopen the table.
  const left = useRef(false);
  const previousSoundState = useRef<GameState | null>(null);

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
      onDeckText: setDeckText,
      onDeckDetail: setDeckDetail,
      onCardResults: setCardResults,
      onPrintings: setPrintings,
      onState: (g) => {
        if (left.current) return;
        gameSounds(previousSoundState.current, g).forEach(playSound);
        previousSoundState.current = g;
        setGame(g);
      },
      onChoice: (q) => { if (!left.current) setChoice(q); },
      onNotice: (n) => setNotice({ ...n, at: Date.now() }),
      onLobby: (l) => {
        left.current = !l;
        setLobby(l);
        if (!l) { setReconnecting(false); previousSoundState.current = null; setGame(null); setChoice(null); setChat([]); }
      },
      onChat: (m) => setChat((messages) => [...messages.slice(-199), m]),
      onCampaigns: setCampaigns,
      onModes: (update) => setModes((current) => ({ ...current, ...update })),
      onConnection: setReconnecting,
      onCampaign: setCampaign,
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
    if (m.type === 'startMatch' || m.type === 'startOnlineMatch' || m.type === 'startPuzzle' || m.type === 'campaign' && m.action === 'duel' || m.type === 'limited' && m.action === 'play') {
      left.current = false;
      previousSoundState.current = null;
    }
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
    previousSoundState.current = null;
    setGame(null);
    setChoice(null);
  }, []);

  return { status, failure, info, decks, deckPreview, deckText, deckDetail, cardResults, printings, game, choice, notice, error, lobby, chat, campaigns, campaign, modes, reconnecting, send, answer, leaveGame };
}
