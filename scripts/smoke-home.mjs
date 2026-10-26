// Confirmed play, rather than navigation, determines the home menu's local ranking.
import assert from 'node:assert/strict';

const storage = new Map();
globalThis.localStorage = { getItem: key => storage.get(key) ?? null, setItem: (key, value) => storage.set(key, value) };
const usage = await import('../ui/src/modeUsage.ts');
assert.deepEqual(usage.getModeHistory(), {});
assert.deepEqual(usage.popularModes(usage.getModeHistory()), [], 'a new player has no invented ranking');
let updates = 0;
const unsubscribe = usage.subscribeModeHistory(() => updates++);
usage.recordModePlay('commander', 'c:Command Tower|CMM|1');
usage.recordModePlay('draft'); usage.recordModePlay('draft');
assert.deepEqual(usage.popularModes(usage.getModeHistory()), ['draft', 'commander']);
assert.equal(updates, 3);
unsubscribe();
usage.recordModePlay('puzzles');
assert.equal(updates, 3);
const restored = await import('../ui/src/modeUsage.ts?restore');
assert.deepEqual(restored.getModeHistory(), usage.getModeHistory(), 'history survives reopening the app');
assert.deepEqual(usage.popularModes({ quest: { plays: 3, lastPlayed: 1 }, draft: { plays: 3, lastPlayed: 2 }, commander: { plays: 10, lastPlayed: 0 }, puzzles: { plays: 1, lastPlayed: 3 } }), ['commander', 'draft', 'quest']);

storage.set('reforge.modeUsage', JSON.stringify({ version: 1, modes: {
  commander: { plays: -1, lastPlayed: 1 }, draft: { plays: '4', lastPlayed: 1 }, quest: { plays: 3, lastPlayed: -1 },
  adventure: { plays: 2, lastPlayed: 1, imageKey: 'https://untrusted.invalid/image' },
  puzzles: { plays: 1, lastPlayed: 1, imageKey: 'c:Sol Ring|CMM|1' }, unknown: { plays: 999, lastPlayed: 1 },
} }));
const invalid = await import('../ui/src/modeUsage.ts?invalid');
assert.deepEqual(Object.keys(invalid.getModeHistory()), ['adventure', 'puzzles']);
assert.equal(invalid.getModeHistory().adventure.imageKey, undefined, 'saved values cannot become arbitrary image URLs');
storage.set('reforge.modeUsage', '{broken');
assert.deepEqual((await import('../ui/src/modeUsage.ts?corrupt')).getModeHistory(), {});
globalThis.localStorage = { getItem() { throw Error('Blocked'); }, setItem() { throw Error('Blocked'); } };
const blocked = await import('../ui/src/modeUsage.ts?blocked');
assert.doesNotThrow(() => blocked.recordModePlay('quest'));
assert.equal(blocked.getModeHistory().quest.plays, 1);

const recorded = [];
const tracker = usage.createModeUsageTracker((mode, image) => recorded.push([mode, image]));
const game = { players: [{ isLocal: true, zones: { command: [{ imageKey: 'c:Command Tower|CMM|1' }] } }] };
for (const message of [{ type: 'hello' }, { type: 'puzzles' }, { type: 'campaign', action: 'list', mode: 'quest' }, { type: 'limited', action: 'events' }]) tracker.requested(message);
tracker.state(game);
assert.equal(recorded.length, 0, 'visits and unsolicited snapshots count nothing');
tracker.requested({ type: 'startMatch', deck: null, opponents: 1, aiProfiles: [] });
tracker.failed(); tracker.state(game);
assert.equal(recorded.length, 0, 'failed starts count nothing');
tracker.requested({ type: 'startMatch', deck: null, opponents: 1, aiProfiles: [] });
tracker.state(game); tracker.state(game); tracker.state({ ...game, turn: 2 });
assert.deepEqual(recorded, [['commander', 'c:Command Tower|CMM|1']], 'repeated snapshots count once');
tracker.leave();
tracker.requested({ type: 'startPuzzle', id: 'tutorial' }); tracker.state(game); tracker.state(game);
assert.equal(recorded.at(-1)[0], 'puzzles');
tracker.leave();
tracker.lobby({ localSlot: 1 }); tracker.state(game); tracker.state(game);
assert.equal(recorded.at(-1)[0], 'online', 'a guest counts play without sending startOnlineMatch');
const beforeReconnect = recorded.length;
tracker.lobby({ localSlot: 1 }); tracker.state(game);
assert.equal(recorded.length, beforeReconnect, 'lobby refresh and reconnection do not count again');
tracker.leave(); tracker.state(game);
assert.equal(recorded.length, beforeReconnect + 1, 'a new online match after leaving counts');
tracker.lobby(null);

const campaign = { id: 'q', mode: 'quest', cards: [{ imageKey: 'c:Sol Ring|CMM|1' }] };
tracker.requested({ type: 'campaign', action: 'open', id: 'q' });
tracker.campaign({ ...campaign, id: 'old' });
const beforeCampaign = recorded.length;
tracker.campaign(campaign); tracker.campaign(campaign);
tracker.requested({ type: 'campaign', action: 'duel' }); tracker.state(game); tracker.campaign(campaign);
assert.equal(recorded.length, beforeCampaign + 1, 'moving, duelling and shopping stay within the campaign session');
tracker.requested({ type: 'campaign', action: 'close' }); tracker.campaign(null);
tracker.requested({ type: 'campaign', action: 'create', mode: 'adventure' });
tracker.campaign({ ...campaign, id: 'a', mode: 'adventure' });
assert.equal(recorded.at(-1)[0], 'adventure');

const draft = { picked: [], pack: [{ imageKey: 'c:Sol Ring|CMM|1' }] };
tracker.requested({ type: 'limited', action: 'draft' }); tracker.modes({ draft: null });
const beforeDraft = recorded.length;
tracker.requested({ type: 'limited', action: 'newDraft', set: 'BLB' });
tracker.modes({ draft }); tracker.requested({ type: 'limited', action: 'pick', index: 0 }); tracker.modes({ draft });
assert.equal(recorded.length, beforeDraft + 1, 'an empty draft lookup and repeated picks do not inflate usage');
const event = { id: 'sealed', mode: 'sealed', main: [], pool: [{ imageKey: 'c:Sol Ring|CMM|1' }] };
tracker.requested({ type: 'limited', action: 'newSealed', set: 'BLB' }); tracker.modes({ event });
const afterSealed = recorded.length;
tracker.requested({ type: 'limited', action: 'saveDeck', id: event.id }); tracker.modes({ event });
tracker.requested({ type: 'limited', action: 'play', id: event.id, opponent: 0 }); tracker.state(game);
tracker.requested({ type: 'action', action: 'nextGame' }); tracker.state(game);
assert.equal(recorded.length, afterSealed, 'saving, matches and Bo3 games stay within the event session');
tracker.requested({ type: 'limited', action: 'open', id: event.id }); tracker.modes({ event });
assert.equal(recorded.length, afterSealed + 1, 'explicitly reopening a saved event starts another session');
assert.deepEqual(new Set(recorded.map(([mode]) => mode)), new Set(usage.PLAYABLE_MODES));
console.log('OK: home ranking, persistence, invalid/blocked storage and seven confirmed play modes without duplicate sessions');
