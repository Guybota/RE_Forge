import type { CampaignState, ClientMessage, GameState, LobbyState, ModesData } from './engine';

export const PLAYABLE_MODES = ['commander', 'adventure', 'quest', 'draft', 'sealed', 'puzzles', 'online'] as const;
export type PlayableMode = typeof PLAYABLE_MODES[number];
export type ModeUsage = { plays: number; lastPlayed: number; imageKey?: string };
export type ModeHistory = Partial<Record<PlayableMode, ModeUsage>>;
const STORAGE = 'reforge.modeUsage';
const validMode = (mode: unknown): mode is PlayableMode => PLAYABLE_MODES.some(id => id === mode);
const validImage = (key: unknown): key is string => typeof key === 'string' && key.length <= 512 && /^(c:|t:).+/.test(key);

function load(): ModeHistory {
  const history: ModeHistory = {};
  try {
    const saved = JSON.parse(localStorage.getItem(STORAGE) ?? 'null');
    if (saved?.version !== 1) return history;
    for (const mode of PLAYABLE_MODES) {
      const entry = saved.modes?.[mode];
      if (!Number.isSafeInteger(entry?.plays) || entry.plays < 1 || !Number.isSafeInteger(entry.lastPlayed) || entry.lastPlayed < 0) continue;
      history[mode] = { plays: entry.plays, lastPlayed: entry.lastPlayed, ...(validImage(entry.imageKey) ? { imageKey: entry.imageKey } : {}) };
    }
  } catch { /* A first run, unavailable storage or a damaged record has no invented history. */ }
  return history;
}

let history = load();
const listeners = new Set<() => void>();
export const getModeHistory = () => history;
export const subscribeModeHistory = (listener: () => void) => { listeners.add(listener); return () => { listeners.delete(listener); }; };

/** Counts confirmed play sessions, never menu visits. Keeps working in memory if storage is blocked. */
export function recordModePlay(mode: PlayableMode, imageKey?: string) {
  if (!validMode(mode)) return;
  const previous = history[mode];
  const art = validImage(imageKey) ? imageKey : previous?.imageKey;
  history = { ...history, [mode]: { plays: Math.min(Number.MAX_SAFE_INTEGER, (previous?.plays ?? 0) + 1), lastPlayed: Date.now(), ...(art ? { imageKey: art } : {}) } };
  try { localStorage.setItem(STORAGE, JSON.stringify({ version: 1, modes: history })); } catch { /* Session-only history. */ }
  listeners.forEach(listener => listener());
}

/** Stable order: most sessions, most recently played, then the normal menu order. */
export function popularModes(source: ModeHistory, limit = 3): PlayableMode[] {
  return PLAYABLE_MODES.filter(mode => source[mode]?.plays)
    .sort((a, b) => source[b]!.plays - source[a]!.plays || source[b]!.lastPlayed - source[a]!.lastPlayed)
    .slice(0, Math.max(0, limit));
}

type Pending = { kind: 'game'; mode: PlayableMode } | { kind: 'campaign'; mode?: 'quest' | 'adventure'; id?: string; previousId?: string }
  | { kind: 'limited'; mode?: 'draft' | 'sealed'; id?: string; previousId?: string };

/** Wire acknowledgements prevent failed starts, repeated snapshots and Bo3 games from inflating usage. */
export function createModeUsageTracker(record = recordModePlay) {
  let pending: Pending | null = null;
  let online = false;
  let gameCounted = false;
  let campaignId: string | undefined;
  let eventId: string | undefined;
  const clear = () => { pending = null; gameCounted = false; };
  return {
    requested(message: ClientMessage) {
      if (message.type === 'startMatch' || message.type === 'startPuzzle' || message.type === 'startOnlineMatch') {
        pending = { kind: 'game', mode: message.type === 'startMatch' ? 'commander' : message.type === 'startPuzzle' ? 'puzzles' : 'online' };
        gameCounted = false;
      } else if (message.type === 'campaign') {
        if (message.action === 'open') pending = { kind: 'campaign', id: message.id };
        if (message.action === 'create') pending = { kind: 'campaign', mode: message.mode, previousId: campaignId };
        if (message.action === 'close') pending = null;
      } else if (message.type === 'limited') {
        if (message.action === 'open') pending = { kind: 'limited', id: message.id };
        if (message.action === 'newDraft' || message.action === 'newSealed') {
          pending = { kind: 'limited', mode: message.action === 'newDraft' ? 'draft' : 'sealed', previousId: eventId };
        }
        // Re-entering an unfinished draft resumes play; a draftClosed reply counts nothing.
        if (message.action === 'draft') pending = { kind: 'limited', mode: 'draft' };
      }
    },
    state(game: GameState) {
      const mode = pending?.kind === 'game' ? pending.mode : online && !gameCounted ? 'online' : null;
      if (!mode) return;
      const player = game.players.find(player => player.isLocal);
      record(mode, player?.zones.command.find(card => card.imageKey)?.imageKey);
      pending = null;
      gameCounted = true;
    },
    campaign(campaign: CampaignState | null) {
      if (campaign && pending?.kind === 'campaign' && (!pending.mode || pending.mode === campaign.mode)
        && (!pending.id || pending.id === campaign.id) && (!pending.previousId || pending.previousId !== campaign.id)) {
        record(campaign.mode, campaign.cards.find(card => card.imageKey)?.imageKey);
        pending = null;
      }
      campaignId = campaign?.id;
    },
    modes(update: ModesData) {
      const event = update.event;
      if (pending?.kind === 'limited') {
        if (update.draft && pending.mode === 'draft' && !pending.id) {
          record('draft', update.draft.picked[0]?.imageKey ?? update.draft.pack[0]?.imageKey);
          pending = null;
        } else if (event && (!pending.mode || pending.mode === event.mode) && (!pending.id || pending.id === event.id)
          && (!pending.previousId || pending.previousId !== event.id)) {
          record(event.mode, event.main[0]?.imageKey ?? event.pool[0]?.imageKey);
          pending = null;
        } else if (update.draft === null && !event && pending.mode === 'draft') pending = null;
      }
      if (event) eventId = event.id;
    },
    lobby(lobby: LobbyState | null) { online = lobby !== null; if (!lobby) clear(); },
    failed() { pending = null; },
    leave: clear,
  };
}
