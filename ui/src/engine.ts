// Connection to the Java engine bridge. The Electron shell passes its port as ?enginePort=N.
// Message shapes mirror engine/src/main/java/reforge/engine (GameSnapshot, WebGuiGame, EngineServer).

export type PhaseStops = { mine: string[]; opponents: string[] };

export type EngineInfo = {
  type: 'engineInfo';
  version: string;
  cards: number;
  editions: number;
  imageBase?: string;
  /** Forge language code; missing until the player has chosen one (first run). */
  language?: string;
  languages: { code: string; name: string }[];
  /** Skin id; missing until the player has chosen one (first run). */
  skin?: string;
  phaseStops: PhaseStops;
  phaseOptions: string[];
  /** Forge's AI profiles, easiest first. */
  aiProfiles: string[];
};

export type CardState = {
  id: number;
  hidden?: boolean;
  name?: string;
  cost?: string;
  /** Type line in the chosen language, for display. */
  type?: string;
  /** Type line in English, for logic (land detection, basic land colour). */
  typeEn?: string;
  colors?: string;
  set?: string;
  imageKey?: string;
  text?: string;
  power?: number;
  toughness?: number;
  loyalty?: string;
  defense?: string;
  controllerId?: number;
  /** Usable right now: playable from hand, can attack, or can block (Forge's actionable highlight). */
  actionable?: boolean;
  tapped?: boolean;
  sick?: boolean;
  attacking?: boolean;
  blocking?: boolean;
  token?: boolean;
  commander?: boolean;
  faceDown?: boolean;
  damage?: number;
  attachedToId?: number;
  counters?: Record<string, number>;
};

export type PlayerState = {
  id: number;
  /** How often each commander was cast from the command zone (tax = 2 × casts). */
  commanderCasts?: { id: number; casts: number }[];
  name: string;
  life: number;
  poison: number;
  isLocal: boolean;
  isAi: boolean;
  hasLost: boolean;
  handSize: number;
  librarySize: number;
  zones: { hand: CardState[]; battlefield: CardState[]; graveyard: CardState[]; exile: CardState[]; command: CardState[] };
  commanderDamage: { commanderId: number; fromPlayerId: number; damage: number }[];
};

export type Ids = { cards: number[]; players: number[]; stack: number[] };

export type GameState = {
  type: 'state';
  turn: number;
  phase: string | null;
  activePlayerId: number | null;
  gameOver: boolean;
  winner: string | null;
  players: PlayerState[];
  stack: { id: number; text: string; sourceCardId: number | null; controllerId: number | null; targetCardIds: number[]; targetPlayerIds: number[] }[];
  combat: { attackerId: number; defenderPlayerId?: number; defenderCardId?: number; blockerIds: number[] }[];
  log: string[];
  prompt: {
    message: string;
    ok: { label: string; enabled: boolean };
    cancel: { label: string; enabled: boolean };
    selectable: Ids;
    chosen: Ids;
  };
};

export type ChoiceOption = { label: string; cardId?: number; playerId?: number; card?: CardState };

export type Choice = {
  type: 'choice';
  id: number;
  kind: 'choose' | 'reveal' | 'confirm' | 'order' | 'arrange' | 'amounts' | 'text';
  title: string;
  min?: number;
  max?: number;
  total?: number;
  initial?: string;
  numeric?: boolean;
  numberMin?: number;
  numberMax?: number;
  invalid?: boolean;
  minimums?: number[];
  maximums?: number[];
  initialAmounts?: number[];
  lethal?: number[];
  ordered?: boolean;
  divideFreely?: boolean;
  defenderIndex?: number;
  maySkip?: boolean;
  movable?: number[];
  toTop?: boolean;
  toBottom?: boolean;
  toAnywhere?: boolean;
  options?: ChoiceOption[];
  preselected?: number[];
};

export type DeckLists = { mine: string[]; precons: string[] };

export type LobbyState = {
  type: 'lobby'; host: boolean; localSlot: number; port: number; addresses: string[];
  slots: { index: number; kind: 'human' | 'ai' | 'open'; name?: string; deck?: string;
    ready: boolean; editable: boolean; controllable: boolean }[];
};
export type ChatMessage = { type: 'chatMessage'; source?: string; text: string; kind: 'player' | 'system' | 'warning' };

export type DeckPreview = {
  type: 'deckPreview';
  /** Card lines also carry the card as the catalog describes it, its quantity and ("commander" group) its section. */
  lines: ({ text: string; status: 'ok' | 'warning' | 'error'; message?: string; qty?: number; typeGroup?: string } & Partial<CatalogCard>)[];
  /** The commanders' combined colour identity (bits W 1, U 2, B 4, R 8, G 16). */
  identity?: number;
  unknown: number;
  name?: string;
  cards?: number;
  commanders?: string[];
  /** Why the deck isn't Commander-legal (still playable against the AI). */
  problem?: string;
};

/** A card in the deck builder's catalog (also the fields of a decklist line). */
export type CatalogCard = {
  nameEn: string;
  name: string;
  set: string;
  number: string;
  imageKey: string;
  cost: string;
  cmc: number;
  type: string;
  /** creature, planeswalker, instant, sorcery, artifact, enchantment, battle, land, other; "commander" on deck lines. */
  group: string;
  canCommand: boolean;
  identity: number;
};
export type CardResults = { type: 'cardResults'; total: number; offset: number; cards: CatalogCard[] };
export type Printings = { type: 'printings'; name: string; printings: { set: string; setName: string; number: string; imageKey: string }[] };

/** One of the player's decks: its decklist (with printings) and the grouped preview. */
export type DeckDetail = Omit<DeckPreview, 'type'> & { type: 'deckDetail'; name: string; text: string };

export type Notice ={ type: 'notice'; kind: 'incorrectAction' | 'alert' | 'message' | 'error'; text: string | null };

type EngineMessage =
  | EngineInfo
  | GameState
  | Choice
  | Notice
  | LobbyState
  | ChatMessage
  | { type: 'lobbyClosed' }
  | { type: 'decks'; mine: string[]; commander: string[] }
  | DeckPreview
  | DeckDetail
  | CardResults
  | Printings
  | { type: 'error'; message: string };

export type Action = 'ok' | 'cancel' | 'card' | 'player' | 'undo' | 'attackAll' | 'concede' | 'leave';

export type ClientMessage =
  | { type: 'hello' }
  | { type: 'listDecks' }
  | { type: 'setLanguage'; language: string }
  | { type: 'setSkin'; skin: string }
  | { type: 'setPhaseStops'; stops: PhaseStops | null }
  | { type: 'previewDeck'; text: string; name?: string }
  | { type: 'saveDeck'; text: string; name: string }
  | { type: 'deleteDeck'; name: string }
  | { type: 'getDeck'; name: string }
  | { type: 'searchCards'; query?: string; colors?: number; identity?: number; cmc?: number; cardType?: string; commanders?: boolean; offset?: number }
  | { type: 'getPrintings'; name: string }
  | { type: 'renameDeck'; name: string; to: string }
  | { type: 'startMatch'; deck: string | null; opponents: number; aiProfiles: string[] }
  | { type: 'hostGame'; name: string; port: number; upnp: boolean }
  | { type: 'joinGame'; name: string; address: string }
  | { type: 'setSlot'; index: number; slotType?: 'ai' | 'open'; deck?: string }
  | { type: 'setReady'; ready: boolean }
  | { type: 'addSlot' | 'startOnlineMatch' | 'leaveLobby' }
  | { type: 'removeSlot'; index: number }
  | { type: 'chat'; text: string }
  | { type: 'action'; action: Action; id?: number }
  | { type: 'answer'; id: number; picked?: number[]; amounts?: number[]; value?: string | null; skip?: boolean };

export type EngineHandlers = {
  onInfo: (info: EngineInfo) => void;
  onDecks: (decks: DeckLists) => void;
  onDeckPreview: (preview: DeckPreview) => void;
  onDeckDetail: (detail: DeckDetail) => void;
  onCardResults: (results: CardResults) => void;
  onPrintings: (printings: Printings) => void;
  onState: (state: GameState) => void;
  onChoice: (choice: Choice) => void;
  onNotice: (notice: Notice) => void;
  onLobby: (lobby: LobbyState | null) => void;
  onChat: (message: ChatMessage) => void;
  onError: (message: string) => void;
  onClosed: () => void;
};

export function enginePort(): number | null {
  const value = new URLSearchParams(window.location.search).get('enginePort');
  const port = Number(value);
  return value && Number.isInteger(port) && port > 0 ? port : null;
}

export type EngineConnection = { send: (m: ClientMessage) => void; close: () => void };

export function connectEngine(port: number, h: EngineHandlers): EngineConnection {
  const ws = new WebSocket(`ws://127.0.0.1:${port}`);
  let closedByUs = false;
  const send = (m: ClientMessage) => {
    if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(m));
  };

  ws.onopen = () => {
    send({ type: 'hello' });
    send({ type: 'listDecks' });
  };
  ws.onmessage = (event) => {
    let msg: EngineMessage;
    try {
      msg = JSON.parse(event.data);
    } catch {
      h.onError('Invalid reply from the engine');
      return;
    }
    switch (msg.type) {
      case 'engineInfo': h.onInfo(msg); break;
      case 'decks': h.onDecks({ mine: msg.mine, precons: msg.commander }); break;
      case 'deckPreview': h.onDeckPreview(msg); break;
      case 'deckDetail': h.onDeckDetail(msg); break;
      case 'cardResults': h.onCardResults(msg); break;
      case 'printings': h.onPrintings(msg); break;
      case 'state': h.onState(msg); break;
      case 'choice': h.onChoice(msg); break;
      case 'notice': h.onNotice(msg); break;
      case 'lobby': h.onLobby(msg); break;
      case 'lobbyClosed': h.onLobby(null); break;
      case 'chatMessage': h.onChat(msg); break;
      case 'error': h.onError(msg.message); break;
    }
  };
  ws.onclose = () => {
    if (!closedByUs) h.onClosed();
  };

  return {
    send,
    close: () => {
      closedByUs = true;
      ws.close();
    },
  };
}
