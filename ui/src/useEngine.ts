import { useCallback, useEffect, useRef, useState } from 'react';
import type { MessageKey } from './i18n';
import type { LobbyState, ChatMessage, CampaignList, CampaignState } from './engine';
import { setImageBase } from './images';
import { gameSounds } from './audio/gameSounds';
import { playSound } from './audio/sounds';
import { createModeUsageTracker } from './modeUsage';
import { createOpeningCoinGate } from './table/openingCoin';
import { animationOn } from './table/animationPrefs';
import type { OpeningCoin } from './engine';
import type { CentralImport, DeckLanguage, DeckServicesReply } from './engine';
import { connectEngine, enginePort, type Choice, type ClientMessage, type CardResults, type DeckDetail, type DeckLists, type Printings, type DeckPreview, type DeckText, type ModesData, type EngineConnection, type EngineInfo, type GameState, type Notice } from './engine';

export type Engine = {
  status: 'connecting' | 'ready' | 'failed';
  failure: MessageKey | null;
  info: EngineInfo | null;
  decks: DeckLists;
  deckLanguage: DeckLanguage | null;
  /** The latest reply to previewDeck. */
  deckPreview: DeckPreview | null;
  /** The latest fetched link or rewritten list (chooseCommander); a new object each time. */
  deckText: DeckText | null;
  /** The latest online deck-tools reply of each kind (errors under their service); match requestId before use. */
  deckServices: Partial<Record<Exclude<DeckServicesReply['type'], 'servicesError'>, DeckServicesReply>>;
  /** The latest Central library import (the desktop migration or a JSON export). */
  centralImport: CentralImport | null;
  /** The latest reply to getDeck. */
  deckDetail: DeckDetail | null;
  /** The latest replies to searchCards and getPrintings (deck builder). */
  cardResults: CardResults | null;
  printings: Printings | null;
  game: GameState | null;
  openingCoin: OpeningCoin | null;
  finishOpeningCoin: (gameId: number) => void;
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
  const [deckLanguage, setDeckLanguage] = useState<DeckLanguage | null>(null);
  const [deckPreview, setDeckPreview] = useState<DeckPreview | null>(null);
  const [deckText, setDeckText] = useState<DeckText | null>(null);
  const [deckDetail, setDeckDetail] = useState<DeckDetail | null>(null);
  const [deckServices, setDeckServices] = useState<Engine['deckServices']>({});
  const [centralImport, setCentralImport] = useState<CentralImport | null>(null);
  const migrating = useRef(false);
  const [cardResults, setCardResults] = useState<CardResults | null>(null);
  const [printings, setPrintings] = useState<Printings | null>(null);
  const [game, setGame] = useState<GameState | null>(null);
  const [openingCoin, setOpeningCoin] = useState<OpeningCoin | null>(null);
  const coinGate = useRef(createOpeningCoinGate());
  const finishOpeningCoin = useCallback((gameId: number) => {
    if (coinGate.current.finish(gameId)) setOpeningCoin(null);
  }, []);
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
  const usage = useRef(createModeUsageTracker());

  useEffect(() => {
    if (!port) return;
    const c = connectEngine(port, {
      onOpeningCoin: (toss) => {
        if (left.current) return;
        const coin = coinGate.current.receive(toss, animationOn('coin'), !document.hidden);
        if (coin) setOpeningCoin(coin);
      },
      onInfo: (i) => {
        setImageBase(i.imageBase, i.language);
        setInfo(i);
        setStatus('ready');
        // Desktop, once: bring the old Central library in. A busy port or a failure tries again next start.
        if (!i.centralMigrated && !migrating.current && window.reforge?.centralLibrary) {
          migrating.current = true;
          window.reforge.centralLibrary().then((read) => {
            if (read.status === 'ok') c.send({ type: 'importCentral', json: read.json ?? '{"decks":[]}', migration: true });
          }).catch(() => {});
        }
      },
      onDecks: setDecks,
      onDeckLanguage: setDeckLanguage,
      onDeckPreview: setDeckPreview,
      onDeckText: setDeckText,
      onDeckDetail: setDeckDetail,
      // Lookups run in parallel in the engine: an older request's late reply never replaces a newer one.
      onCentralImport: setCentralImport,
      onDeckServices: (reply) => setDeckServices((all) => {
        const kind = reply.type === 'servicesError' ? reply.service : reply.type;
        const previous = all[kind];
        return previous && previous.requestId > reply.requestId ? all : { ...all, [kind]: reply };
      }),
      onCardResults: setCardResults,
      onPrintings: setPrintings,
      onState: (g) => {
        if (left.current || !coinGate.current.acceptsState(g.gameId)) return;
        if (g.gameOver) { coinGate.current.clear(); setOpeningCoin(null); }
        usage.current.state(g);
        gameSounds(previousSoundState.current, g).forEach(playSound);
        previousSoundState.current = g;
        setGame(g);
      },
      onChoice: (q) => { if (!left.current) setChoice(q); },
      onNotice: (n) => setNotice({ ...n, at: Date.now() }),
      onLobby: (l) => {
        usage.current.lobby(l);
        left.current = !l;
        setLobby(l);
        if (!l) { coinGate.current.clear(); setOpeningCoin(null); setReconnecting(false); previousSoundState.current = null; setGame(null); setChoice(null); setChat([]); }
      },
      onChat: (m) => setChat((messages) => [...messages.slice(-199), m]),
      onCampaigns: setCampaigns,
      onModes: (update) => { usage.current.modes(update); setModes((current) => ({ ...current, ...update })); },
      onConnection: setReconnecting,
      onCampaign: (campaign) => { usage.current.campaign(campaign); setCampaign(campaign); },
      onError: (error) => { usage.current.failed(); setError(error); },
      onClosed: () => {
        coinGate.current.clear(); setOpeningCoin(null);
        usage.current.leave();
        setStatus('failed');
        setFailure('engineLost');
      },
    });
    conn.current = c;
    return () => c.close();
  }, [port]);

  const send = useCallback((m: ClientMessage) => {
    if (coinGate.current.blocks(m)) return;
    if (m.type !== 'deckLanguage' && m.type !== 'cancelDeckLanguage') setError(null);
    usage.current.requested(m);
    if (m.type === 'startMatch' || m.type === 'startDeckMatch' || m.type === 'startOnlineMatch' || m.type === 'startPuzzle' || m.type === 'campaign' && m.action === 'duel' || m.type === 'limited' && m.action === 'play') {
      left.current = false;
      previousSoundState.current = null;
    }
    conn.current?.send(m);
  }, []);

  const answer = useCallback<Engine['answer']>(
    (a) => {
      if (coinGate.current.blocks({ type: 'answer', id: choice?.id ?? -1 })) return;
      if (choice) send({ type: 'answer', id: choice.id, ...a });
      setChoice(null);
    },
    [choice, send],
  );

  const leaveGame = useCallback(() => {
    coinGate.current.clear(); setOpeningCoin(null);
    usage.current.leave();
    left.current = true;
    previousSoundState.current = null;
    setGame(null);
    setChoice(null);
  }, []);

  return { status, failure, info, decks, deckLanguage, deckPreview, deckText, deckDetail, deckServices, centralImport, cardResults, printings, game, openingCoin, finishOpeningCoin, choice, notice, error, lobby, chat, campaigns, campaign, modes, reconnecting, send, answer, leaveGame };
}
