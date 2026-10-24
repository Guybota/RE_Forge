// Connection to the Java engine bridge. The Electron shell passes its port as ?enginePort=N.
// Message shapes mirror engine/src/main/java/reforge/engine (GameSnapshot, WebGuiGame, EngineServer).

export type EngineInfo = { type: 'engineInfo'; version: string; cards: number; editions: number };

export type CardState = {
  id: number;
  hidden?: boolean;
  name?: string;
  cost?: string;
  type?: string;
  colors?: string;
  set?: string;
  text?: string;
  power?: number;
  toughness?: number;
  loyalty?: string;
  defense?: string;
  controllerId?: number;
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

export type ChoiceOption = { label: string; cardId?: number; playerId?: number };

export type Choice = {
  type: 'choice';
  id: number;
  kind: 'choose' | 'reveal' | 'confirm' | 'order' | 'amounts' | 'text';
  title: string;
  min?: number;
  max?: number;
  total?: number;
  initial?: string;
  numeric?: boolean;
  options?: ChoiceOption[];
  preselected?: number[];
};

export type Notice = { type: 'notice'; kind: 'incorrectAction' | 'alert' | 'message' | 'error'; text: string | null };

type EngineMessage =
  | EngineInfo
  | GameState
  | Choice
  | Notice
  | { type: 'decks'; commander: string[] }
  | { type: 'error'; message: string };

export type Action = 'ok' | 'cancel' | 'card' | 'player' | 'undo' | 'attackAll' | 'concede' | 'leave';

export type ClientMessage =
  | { type: 'hello' }
  | { type: 'listDecks' }
  | { type: 'startMatch'; deck: string | null; opponents: number }
  | { type: 'action'; action: Action; id?: number }
  | { type: 'answer'; id: number; picked?: number[]; amounts?: number[]; value?: string | null };

export type EngineHandlers = {
  onInfo: (info: EngineInfo) => void;
  onDecks: (names: string[]) => void;
  onState: (state: GameState) => void;
  onChoice: (choice: Choice) => void;
  onNotice: (notice: Notice) => void;
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
      h.onError('Resposta inválida do motor');
      return;
    }
    switch (msg.type) {
      case 'engineInfo': h.onInfo(msg); break;
      case 'decks': h.onDecks(msg.commander); break;
      case 'state': h.onState(msg); break;
      case 'choice': h.onChoice(msg); break;
      case 'notice': h.onNotice(msg); break;
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
