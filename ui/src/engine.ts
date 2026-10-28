// Connection to the Java engine bridge. The Electron shell passes its port as ?enginePort=N.
// Message shapes mirror engine/src/main/java/reforge/engine (GameSnapshot, WebGuiGame, EngineServer).

export type PhaseStops = { mine: string[]; opponents: string[]; autoPass: boolean };

export type CampaignMode = 'quest' | 'adventure';
export type CampaignCard = CatalogCard & { key: string; owned: number; qty: number };
export type CampaignReward = { title?: string; message?: string; cards?: CampaignCard[]; kind?: string; count?: number; name?: string; imageKey?: string };
export type CampaignList = {
  type: 'campaigns'; mode: CampaignMode;
  campaigns: { id: string; name: string; difficulty: number; wins?: number; losses?: number }[];
  starters: { id: string; name: string }[];
  /** Adventure only: Forge's races with a portrait per sex. */
  heroes?: { id: string; portraits: { male?: AtlasSprite; female?: AtlasSprite } }[]; assetBase?: string;
};
export type AdventureMapData = {
  width: number; height: number; tile: number;
  tilesets: { first: number; columns: number; size: number; image: string }[];
  layers: { gids: number[]; opacity: number }[];
};
/** A Forge atlas region: frames are [x, y, width, height] in `image` (animation steps or variants). */
export type AtlasSprite = { image: string; frames: [number, number, number, number][] };
/** Overworld grid of `size`² cells of `tiles`² tiles. `cells`: '0' + biome index (0 is water). */
export type AdventureWorldData = {
  size: number; tiles: number; zoom: number; seed: number; cells: string;
  biomes: { name: string; color: string; tiles: AtlasSprite | null; terrain: { tiles: AtlasSprite | null; min?: number; max?: number; resolution?: number }[];
    decorations: { startArea: number; endArea: number; resolution: number; density: number; sprite: AtlasSprite }[] }[];
};
type CampaignBase = { type: 'campaign'; id: string; name: string; mode: CampaignMode; difficulty: number; assetBase: string; cards: CampaignCard[]; wins: number; losses: number; rewards: CampaignReward[] };
export type QuestState = CampaignBase & { mode: 'quest'; credits: number; rank: number; duels: { id: string; name: string; description: string; difficulty: string }[]; shop: (CatalogCard & { key: string; price: number; available: number })[] };
export type AdventureState = CampaignBase & { mode: 'adventure'; life: number; maxLife: number; gold: number; shards: number; region: string; map?: AdventureMapData; world?: AdventureWorldData; x?: number; y?: number;
  objects?: AdventureObject[];
  /** Forge atlas animations by key: frames are [x, y, width, height] in `image`. */
  player?: string; sprites?: Record<string, AtlasSprite>;
  /** Active side quests; `targets` are world tiles of the current stage (destination or quest enemies). */
  quests?: AdventureQuest[];
  /** A town's quest giver is offering this; answer with acceptQuest or declineQuest. */
  offer?: { name: string; description: string; dialog: QuestDialog };
  /** The town shop being browsed; buy with `key`. */
  shop?: { name: string; description: string; items: (CatalogCard & { key: string; price: number; sold: boolean })[] } };
/**
 * Something on the map: centre (x, y). In regions, `gid` is the object's own tile (w × h) and shops carry
 * Forge's sign sprite, offset from the object's bottom-left like libGDX does (y up).
 */
export type AdventureObject = {
  id: string; kind: string; name: string; x: number; y: number; sprite?: string;
  gid?: number; w?: number; h?: number; title?: string; sign?: string; overlay?: string; signX?: number; signY?: number;
};
export type QuestDialog = { text: string; options: { name: string; accept?: boolean; next?: QuestDialog }[] };
export type AdventureQuest = {
  id: string; name: string; description: string; source: string; targets: [number, number][];
  stage: { objective: string; name: string; description: string; progress: number; count: number; enemy?: string };
};
export type CampaignState = QuestState | AdventureState;
export type CampaignRequest = { type: 'campaign'; action: 'list' | 'create' | 'open' | 'close' | 'state' | 'duel' | 'deck' | 'buy' | 'enter' | 'leave' | 'move' | 'interact' | 'delete' | 'closeShop' | 'acceptQuest' | 'declineQuest' | 'abandonQuest'; mode?: CampaignMode; id?: string; name?: string; starter?: string; difficulty?: number; hero?: string; sex?: 'male' | 'female'; target?: string; key?: string; region?: string; dx?: number; dy?: number; entries?: { key: string; qty: number }[] };

export type EngineInfo = {
  type: 'engineInfo';
  /** The old Central library was already brought into the Forge decks (desktop migration). */
  centralMigrated?: boolean;
  version: string;
  relayAvailable: boolean;
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
  /** The AI profile for matches that don't choose one ("" = random) and its seconds per decision. */
  ai?: { profile: string; timeout: number; timeouts: number[] };
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
  /** Forge's CardRarity name, e.g. 'MythicRare'. */
  rarity?: string;
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
  /** Forge's keywords, in English: `id` is the enum name, `detail` what follows the name (e.g. "{2}" of "Ward {2}"). */
  keywords?: { id: string; title: string; detail: string; reminder: string }[];
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
  /** Only present when Forge allows this viewer to see the current top card. */
  libraryTop?: CardState;
  zones: { hand: CardState[]; battlefield: CardState[]; graveyard: CardState[]; exile: CardState[]; command: CardState[] };
  commanderDamage: { commanderId: number; fromPlayerId: number; damage: number }[];
};

export type Ids = { cards: number[]; players: number[]; stack: number[] };

/** A Forge puzzle: fixed board, goal and turn limit (`solved` = Forge's completion marker). */
export type PuzzleInfo = { id: string; name: string; difficulty: string; goal: string; turns: string; description: string; solved: boolean };
export type LimitedMode = 'draft' | 'sealed';
/** A pool or deck card: the catalog card plus its count (pack cards carry their `index` instead). */
export type PoolCard = CatalogCard & { qty: number; index?: number };
export type LimitedEventSummary = { id: string; mode: LimitedMode; name: string; built: boolean; wins: number; losses: number };
export type LimitedEvent = {
  type: 'limitedEvent'; id: string; mode: LimitedMode; name: string;
  pool: PoolCard[]; main: PoolCard[]; lands: CatalogCard[];
  /** AI opponents by strength; `colors` W1 U2 B4 R8 G16; the last result against each. */
  opponents: { index: number; colors: number; result?: 'won' | 'lost' }[];
  problem?: string;
};
export type DraftState = { type: 'draft'; set: string; round: number; rounds: number; picks: number; pack: PoolCard[]; picked: PoolCard[] };
/** Latest replies of the Draft, Sealed and Puzzles screens. */
export type ModesData = {
  sets?: { code: string; name: string; year: string }[];
  events?: LimitedEventSummary[];
  event?: LimitedEvent;
  draft?: DraftState | null;
  puzzles?: PuzzleInfo[];
};
export type LimitedRequest = { type: 'limited'; action: 'sets' | 'events' | 'open' | 'delete' | 'saveDeck' | 'newSealed' | 'newDraft' | 'draft' | 'pick' | 'play';
  id?: string; set?: string; index?: number; opponent?: number; bestOf?: 1 | 3; main?: { nameEn: string; set: string; number: string; qty: number }[] };

export type GameState = {
  type: 'state';
  /** Native game identity; optional for older engines. */
  gameId?: number;
  /** Set while playing a puzzle: its goal and limits (Forge's goal card never reaches the views). */
  puzzle?: PuzzleInfo;
  /** Matches of several games (best of three): games played, whether it's over, and wins by player name. */
  match?: { games: number; played: number; over: boolean; wins: Record<string, number> };
  turn: number;
  phase: string | null;
  activePlayerId: number | null;
  /** Who holds priority in Forge right now; may be stale while a non-priority decision (blocks, a choice) is pending. */
  priorityPlayerId: number | null;
  gameOver: boolean;
  /** Transient yield until our next turn; stops when attacked or cancelled. */
  fastForward?: boolean;
  winner: string | null;
  players: PlayerState[];
  stack: { id: number; text: string; isSpell?: boolean; sourceCardId: number | null; card?: CardState; controllerId: number | null; targetCardIds: number[]; targetPlayerIds: number[] }[];
  combat: { attackerId: number; defenderPlayerId?: number; defenderCardId?: number; blockerIds: number[] }[];
  log: string[];
  prompt: {
    /** Native one-card Scry / Surveil / Explore confirmation, with the exact permitted destination. */
    placement?: { card: CardState; destination: 'bottom' | 'graveyard'; moveAction: 'ok' | 'cancel' };
    message: string;
    ok: { label: string; enabled: boolean };
    cancel: { label: string; enabled: boolean };
    /** The open input is passing priority (OK beside Undo / End turn). */
    priority: boolean;
    selectable: Ids;
    chosen: Ids;
    /** Selectable cards the table does not show, e.g. a library search. */
    cards: CardState[];
  };
};

/** Forge's actual opening toss: the winner still chooses whether to play or draw. */
export type OpeningCoin = { type: 'openingCoin'; gameId: number; winnerId: number; winnerName: string };

export type ChoiceOption = { label: string; cardId?: number; playerId?: number; card?: CardState };

export type Choice = {
  type: 'choice';
  id: number;
  kind: 'choose' | 'reveal' | 'confirm' | 'order' | 'arrange' | 'amounts' | 'text' | 'sideboard';
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
  /** The native selection's destination. Does not change the answer contract. */
  placement?: 'bottom' | 'graveyard' | 'top';
  options?: ChoiceOption[];
  /** Sideboarding between games: each printing with its copies in the deck (`main`) and sideboard (`side`); answer with `amounts` in the deck. */
  cards?: (CatalogCard & { main: number; side: number })[];
  deckSize?: number;
  preselected?: number[];
};

export type DeckSummary = { name: string; source: 'mine' | 'precon'; commanders?: CatalogCard[]; identity?: number; cards?: number };
export type DeckLists = { mine: string[]; precons: string[]; summaries?: DeckSummary[]; loaded?: boolean };
export type DeckLanguage = { type: 'deckLanguage'; requestId: number; name: string; source: string; language: string;
  total: number; checked: number; available: number; missing: number; unknown: number; done: boolean };

export type LobbyState = {
  type: 'lobby'; host: boolean; localSlot: number; port: number; addresses: string[];
  transport: 'direct' | 'relay'; roomCode?: string;
  slots: { index: number; kind: 'human' | 'ai' | 'open'; name?: string; deck?: string;
    ready: boolean; editable: boolean; controllable: boolean;
    /** Host only: a remote player the host may remove from the room. */
    kickable: boolean }[];
};
export type ChatMessage = { type: 'chatMessage'; source?: string; text: string; kind: 'player' | 'system' | 'warning' };

export type DeckPreview = {
  requestId?: string;
  type: 'deckPreview';
  /** Card lines also carry the card as the catalog describes it, its quantity and ("commander" group) its section. */
  lines: ({ text: string; status: 'ok' | 'warning' | 'error'; message?: string; qty?: number; typeGroup?: string; sideboard?: boolean;
    /** Unknown lines: the name as typed and the closest real cards. */
    requested?: string; suggestions?: { nameEn: string; name: string }[] } & Partial<CatalogCard>)[];
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
  canPartner: boolean;
  identity: number;
  colors: number;
  typeEn: string;
  /** English rules text and Commander legality, for the deck tools. */
  textEn: string;
  commanderLegal: boolean;
  /** W U B R G C counts from Forge; hybrid symbols contribute to both colours. */
  manaSymbols: number[];
  /** Potential front-face mana production, W1 U2 B4 R8 G16 C32. */
  manaProduction: number;
  commanderMana: boolean;
};
export type CardResults = { type: 'cardResults'; requestId: number; total: number; offset: number; cards: CatalogCard[] };
export type Printings = { type: 'printings'; name: string; printings: { set: string; setName: string; number: string; imageKey: string; artIndex: number }[] };

/** One of the player's decks: its decklist (with printings) and the grouped preview. */
/** A decklist to show in the import screen: a fetched link or the list with a newly chosen commander. */
export type DeckText = { type: 'deckText'; text: string; name?: string };

export type DeckDetail = Omit<DeckPreview, 'type'> & { type: 'deckDetail'; name: string; text: string;
  /** The player's own tags, notes and intended bracket (0 = none), kept in the Forge deck. */
  tags: string[]; notes: string; bracketIntent: number };

/** Deck tools' online lookups (engine's DeckServices). Prices use Forge's set codes; EUR is Cardmarket via Scryfall. */
export type PrintingPrice = { set: string; number: string; eur?: number | null; exact: boolean };
export type PrintingSide = { set: string; number: string; imageKey?: string; eur: number };
export type CheaperOffer = { nameEn: string; name: string; from: PrintingSide; to: PrintingSide };
export type EdhrecCombo = { id: string; cardNames: string[]; results: string[]; decks: number; href: string; pieces: string[] };
export type ComboGroup = { commander: string; total: number; url: string; combos: EdhrecCombo[] };
export type DeckServicesReply =
  | { type: 'deckPrices'; requestId: number; name: string; prices: PrintingPrice[] }
  | { type: 'cheaperProgress'; requestId: number; done: number; total: number }
  | { type: 'cheaperPrintings'; requestId: number; name: string; offers: CheaperOffer[] }
  | { type: 'deckCombos'; requestId: number; name: string; groups: ComboGroup[]; missing: string[] }
  | { type: 'comboDetail'; requestId: number; href: string; prerequisites: string[]; steps: string[] }
  | (Omit<DeckDetail, 'type'> & { type: 'deckLines'; requestId: number; source: 'mine' | 'precon' })
  | { type: 'cardsByName'; requestId: number; cards: CatalogCard[] }
  | { type: 'deckSpellbook'; requestId: number; name: string; combos: { id: string; cardNames: string[]; produces: string[] }[] }
  | { type: 'cardRulings'; requestId: number; name: string; card: CatalogCard; text: string; rulings: { date: string; source: string; comment: string }[] }
  | { type: 'servicesError'; requestId: number; service: 'deckPrices' | 'cheaperPrintings' | 'deckCombos' | 'comboDetail' | 'deckLines' | 'cardsByName' | 'deckSpellbook' | 'cardRulings';
      unavailable: boolean; message: string };

/** Decks brought in from a Central library (the desktop migration, or a JSON export opened by hand). */
export type CentralImport = { type: 'centralImport'; migration: boolean; imported: { from: string; name: string; unknown: number }[]; failed: { name: string; reason: string }[] };

export type Notice ={ type: 'notice'; kind: 'incorrectAction' | 'alert' | 'message' | 'error'; text: string | null };

type EngineMessage =
  | OpeningCoin
  | CampaignList | CampaignState | { type: 'campaignClosed' }
  | { type: 'limitedSets'; sets: NonNullable<ModesData['sets']> } | { type: 'limitedEvents'; events: LimitedEventSummary[] }
  | LimitedEvent | DraftState | { type: 'draftClosed' } | { type: 'puzzles'; puzzles: PuzzleInfo[] }
  | { type: 'connection'; reconnecting: boolean }
  | EngineInfo
  | GameState
  | Choice
  | Notice
  | LobbyState
  | ChatMessage
  | { type: 'lobbyClosed' }
  | { type: 'decks'; mine: string[]; commander: string[]; summaries?: DeckSummary[] }
  | DeckPreview
  | DeckLanguage
  | DeckText
  | DeckDetail
  | DeckServicesReply
  | CentralImport
  | CardResults
  | Printings
  | { type: 'error'; message: string; code?: string };

export type Action = 'ok' | 'cancel' | 'card' | 'player' | 'undo' | 'attackAll' | 'concede' | 'leave' | 'nextGame';

export type ClientMessage =
  | CampaignRequest
  | LimitedRequest
  | { type: 'puzzles' }
  | { type: 'startPuzzle'; id: string }
  | { type: 'hello' }
  | { type: 'listDecks' }
  | { type: 'deckLanguage'; requestId: number; name: string; source: 'mine' | 'precon' }
  | { type: 'cancelDeckLanguage' }
  | { type: 'setLanguage'; language: string }
  | { type: 'setSkin'; skin: string }
  | { type: 'setPhaseStops'; stops: PhaseStops | null }
  | { type: 'setAiOptions'; profile?: string; timeout?: number }
  | { type: 'previewDeck'; text: string; name?: string; requestId?: string }
  | { type: 'saveDeck'; text: string; name: string; /** The deck being edited, whose tags and notes carry over. */ from?: string }
  | { type: 'chooseCommander'; text: string; name: string }
  | { type: 'fetchDeck'; url: string }
  | { type: 'deleteDeck'; name: string }
  | { type: 'getDeck'; name: string }
  | { type: 'setDeckMeta'; name: string; tags: string[]; notes: string; bracketIntent: number }
  | { type: 'deckPrices' | 'cheaperPrintings' | 'deckCombos' | 'deckSpellbook'; requestId: number; name: string }
  | { type: 'deckLines'; requestId: number; name: string; source: 'mine' | 'precon' }
  | { type: 'cardsByName'; requestId: number; names: string[] }
  | { type: 'cardRulings'; requestId: number; name: string }
  | { type: 'importCentral'; json: string; migration?: boolean }
  | { type: 'comboDetail'; requestId: number; href: string }
  | { type: 'searchCards'; query?: string; colors?: number; identity?: number; cmc?: number; cardType?: string; commanders?: boolean; partnerOf?: string; requestId?: number; offset?: number;
      /** Advanced: words of the rules text / type line (English or translated) and one compared number. */
      rules?: string; typeText?: string; /** Every card, not only Commander-legal ones (rules lookup). */ allCards?: boolean; stat?: 'mv' | 'pow' | 'tou' | 'loy'; statOp?: '=' | '<' | '<=' | '>' | '>=' | '!='; statValue?: number }
  | { type: 'getPrintings'; name: string }
  | { type: 'renameDeck'; name: string; to: string }
  | { type: 'startMatch'; deck: string | null; deckSource?: 'mine' | 'precon'; opponents: number; aiProfiles: string[] }
  | { type: 'startDeckMatch'; text: string; name: string; opponents: number; aiProfiles?: string[] }
  | { type: 'hostGame'; name: string; port: number; upnp: boolean; transport?: 'direct' }
  | { type: 'joinGame'; name: string; address: string; transport?: 'direct' }
  | { type: 'hostGame'; name: string; transport: 'relay' }
  | { type: 'joinGame'; name: string; transport: 'relay'; code: string }
  | { type: 'setSlot'; index: number; slotType?: 'ai' | 'open'; deck?: string }
  | { type: 'setReady'; ready: boolean }
  | { type: 'addSlot' | 'startOnlineMatch' | 'leaveLobby' }
  | { type: 'removeSlot' | 'kickPlayer'; index: number }
  | { type: 'chat'; text: string }
  | { type: 'action'; action: Action; id?: number }
  | { type: 'action'; action: 'fastForward'; enabled: boolean }
  | { type: 'answer'; id: number; picked?: number[]; amounts?: number[]; value?: string | null; skip?: boolean };

export type EngineHandlers = {
  onOpeningCoin: (toss: OpeningCoin) => void;
  onInfo: (info: EngineInfo) => void;
  onDecks: (decks: DeckLists) => void;
  onDeckLanguage: (result: DeckLanguage) => void;
  onDeckPreview: (preview: DeckPreview) => void;
  onDeckText: (text: DeckText) => void;
  onDeckDetail: (detail: DeckDetail) => void;
  onDeckServices: (reply: DeckServicesReply) => void;
  onCentralImport: (result: CentralImport) => void;
  onCardResults: (results: CardResults) => void;
  onPrintings: (printings: Printings) => void;
  onState: (state: GameState) => void;
  onChoice: (choice: Choice) => void;
  onNotice: (notice: Notice) => void;
  onLobby: (lobby: LobbyState | null) => void;
  onChat: (message: ChatMessage) => void;
  onError: (message: string) => void;
  onClosed: () => void;
  onCampaigns: (campaigns: CampaignList) => void;
  onCampaign: (campaign: CampaignState | null) => void;
  onModes: (update: ModesData) => void;
  onConnection: (reconnecting: boolean) => void;
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
      case 'openingCoin': h.onOpeningCoin(msg); break;
      case 'campaigns': h.onCampaigns(msg); break;
      case 'limitedSets': h.onModes({ sets: msg.sets }); break;
      case 'limitedEvents': h.onModes({ events: msg.events }); break;
      case 'limitedEvent': h.onModes({ event: msg, draft: null }); break;
      case 'draft': h.onModes({ draft: msg }); break;
      case 'draftClosed': h.onModes({ draft: null }); break;
      case 'puzzles': h.onModes({ puzzles: msg.puzzles }); break;
      case 'connection': h.onConnection(msg.reconnecting); break;
      case 'campaign': h.onCampaign(msg); break;
      case 'campaignClosed': h.onCampaign(null); break;
      case 'engineInfo': h.onInfo(msg); break;
      case 'decks': h.onDecks({ mine: msg.mine, precons: msg.commander, summaries: msg.summaries, loaded: true }); break;
      case 'deckLanguage': h.onDeckLanguage(msg); break;
      case 'deckPreview': h.onDeckPreview(msg); break;
      case 'deckText': h.onDeckText(msg); break;
      case 'deckDetail': h.onDeckDetail(msg); break;
      case 'centralImport': h.onCentralImport(msg); break;
      case 'deckPrices': case 'cheaperProgress': case 'cheaperPrintings': case 'deckCombos': case 'comboDetail': case 'servicesError':
      case 'deckLines': case 'cardsByName': case 'deckSpellbook': case 'cardRulings':
        h.onDeckServices(msg); break;
      case 'cardResults': h.onCardResults(msg); break;
      case 'printings': h.onPrintings(msg); break;
      case 'state': h.onState(msg); break;
      case 'choice': h.onChoice(msg); break;
      case 'notice': h.onNotice(msg); break;
      case 'lobby': h.onLobby(msg); break;
      case 'lobbyClosed': h.onLobby(null); break;
      case 'chatMessage': h.onChat(msg); break;
      case 'error': h.onError(msg.code ?? msg.message); break;
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
