// Deterministic animation routing from consecutive snapshots (the DOM runner is checked in the browser).
import assert from 'node:assert/strict';
import { firstPlayer, planAnimations, rememberLocations } from '../ui/src/table/animationPlan.ts';

const card = (id, extra = {}) => ({ id, typeEn: 'Creature', ...extra });
const player = (id, isLocal) => ({ id, isLocal, librarySize: 50, zones: { hand: [], battlefield: [], graveyard: [], exile: [], command: [] } });
const state = () => ({ turn: 3, phase: 'MAIN1', activePlayerId: 1, gameOver: false, players: [player(1, true), player(2, false)], stack: [], combat: [] });
const kinds = (a, b) => planAnimations(a, b).map(p => p.kind);

const before = state();
assert.deepEqual(planAnimations(null, before), [], 'the first snapshot replays nothing');
assert.deepEqual(planAnimations(before, structuredClone(before)), [], 'identical snapshots are still');

let a = structuredClone(before), b;
a.players[1].zones.hand = [{ id: 7, hidden: true }];
b = structuredClone(a); b.players[1].zones.hand = [];
b.stack = [{ id: 1, isSpell: true, sourceCardId: 7, card: card(7, { name: 'Bolt', imageKey: 'k' }) }];
let plan = planAnimations(a, b);
assert.equal(plan.length, 1); assert.equal(plan[0].kind, 'cast'); assert.equal(plan[0].fromZone, 'hand'); assert.equal(plan[0].card.name, 'Bolt', 'an opponent spell flies face up from their hand');
b.stack[0].isSpell = false;
assert.deepEqual(kinds(a, b), [], 'abilities do not fly to the stack');
b.stack[0].isSpell = true;
assert.deepEqual(kinds(b, structuredClone(b)), [], 'a spell waiting on the stack is not cast again');

// Forge takes the spell out of the hand while costs are paid, one snapshot before the stack.
const memory = new Map();
a = structuredClone(before); a.players[0].zones.hand = [card(8, { name: 'Growth' })];
rememberLocations(memory, a);
const paying = structuredClone(before);
rememberLocations(memory, paying);
b = structuredClone(before); b.stack = [{ id: 2, isSpell: true, sourceCardId: 8, controllerId: 1 }];
plan = planAnimations(paying, b, memory);
assert.deepEqual(plan.map(p => [p.kind, p.fromZone, p.card.name]), [['cast', 'hand', 'Growth']], 'the cast still starts from the hand');
rememberLocations(memory, b);
const resolved = structuredClone(before); resolved.players[0].zones.graveyard = [card(8)];
assert.deepEqual(planAnimations(b, resolved, memory), [], 'a resolved spell is not a discard');

a = structuredClone(before); a.players[0].zones.hand = [card(9)];
b = structuredClone(before); b.players[0].zones.battlefield = [card(9, { typeEn: 'Legendary Creature — Elf' })];
plan = planAnimations(a, b);
assert.deepEqual(plan, [{ kind: 'enter', cardId: 9, ring: true }], 'legendary permanents get the ring');
b.players[0].zones.battlefield = [card(9, { rarity: 'MythicRare' })];
assert.equal(planAnimations(a, b)[0].ring, true, 'mythics get the ring');
b.players[0].zones.battlefield = [card(9, { rarity: 'Rare' })];
assert.equal(planAnimations(a, b)[0].ring, false);

a = structuredClone(before); a.players[0].zones.battlefield = [card(3, { counters: { P1P1: 1 } }), card(4, { typeEn: 'Legendary Planeswalker', loyalty: '3' }), card(5, { typeEn: 'Artifact — Equipment' })];
b = structuredClone(a);
b.players[0].zones.battlefield[0].counters = { P1P1: 2 };
b.players[0].zones.battlefield[1].loyalty = '4';
b.players[0].zones.battlefield[2].attachedToId = 3;
assert.deepEqual(kinds(a, b), ['counters', 'counters', 'equip']);
const tapped = structuredClone(a); tapped.players[0].zones.battlefield[0].tapped = true;
assert.deepEqual(kinds(a, tapped), [], 'tapping is not a counter change');

a = structuredClone(before); a.players[0].zones.hand = [card(20)];
b = structuredClone(before); b.players[0].zones.graveyard = [card(20)];
assert.deepEqual(planAnimations(a, b).map(p => [p.kind, p.from, p.to]), [['zones', 'hand', 'graveyard']], 'discard leaves the hand');
a = structuredClone(before);
b = structuredClone(before); b.players[1].librarySize = 48; b.players[1].zones.graveyard = [card(30), card(31)];
assert.deepEqual(planAnimations(a, b).map(p => [p.kind, p.from, p.playerId]), [['zones', 'library', 2], ['zones', 'library', 2]], 'milled cards leave the library');
a = structuredClone(before); a.players[0].zones.battlefield = [card(40)];
b = structuredClone(before); b.players[0].zones.graveyard = [card(40)];
assert.deepEqual(kinds(a, b), [], 'dying is not a discard or mill');

const opening = state(); opening.turn = 0; opening.activePlayerId = 1;
assert.equal(firstPlayer(null, opening), null, 'turn 0 is still the play-or-draw question');
const started = structuredClone(opening); started.turn = 1; started.activePlayerId = 2;
assert.equal(firstPlayer(null, started), 2, 'the coin names the first active player');
assert.equal(firstPlayer(opening, started), 2);
assert.equal(firstPlayer(started, structuredClone(started)), null, 'only once');
assert.equal(firstPlayer(null, before), null, 'reconnecting mid-game shows no coin');
console.log('OK: animation plans (cast, enter, ring, counters, equip, discard, mill, coin)');
