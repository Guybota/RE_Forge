// Deterministic sound routing and audio-device failure coverage, without touching user preferences.
import assert from 'node:assert/strict';
import { gameSounds } from '../ui/src/audio/gameSounds.ts';

const card = (id, typeEn = 'Creature') => ({ id, typeEn });
const player = (id, isLocal) => ({ id, isLocal, zones: { hand: [], battlefield: [], graveyard: [], exile: [], command: [] } });
const state = () => ({ turn: 1, phase: 'MAIN1', activePlayerId: 1, gameOver: false, players: [player(1, true), player(2, false)], stack: [], combat: [] });
const before = state();
assert.deepEqual(gameSounds(null, before), [], 'opening/reconnecting must not replay the current board');
assert.deepEqual(gameSounds(before, structuredClone(before)), [], 'identical snapshots are silent');
let after = structuredClone(before);
after.phase = 'COMBAT_BEGIN';
assert.deepEqual(gameSounds(before, after), ['phase']);
after.turn = 2; after.activePlayerId = 2;
assert.deepEqual(gameSounds(before, after), ['turn'], 'turn replaces the simultaneous phase cue');
after = structuredClone(before);
after.stack = [{ id: 10, sourceCardId: 90, isSpell: false }];
assert.deepEqual(gameSounds(before, after), [], 'mana/triggered/activated abilities are not played cards');
after.stack[0].isSpell = true;
assert.deepEqual(gameSounds(before, after), ['card'], 'an opponent spell is audible even with its hand hidden');
assert.deepEqual(gameSounds(after, structuredClone(after)), [], 'a spell waiting on the stack is not repeated');
const firstSpell = structuredClone(after);
after.stack.push({ id: 11, sourceCardId: 91, isSpell: true });
assert.deepEqual(gameSounds(firstSpell, after), ['card'], 'a response on an occupied stack is audible');
after = structuredClone(before);
before.players[0].zones.hand = [card(15, 'Land — Forest')];
after.players[0].zones.battlefield = [card(15, 'Land — Forest')];
assert.deepEqual(gameSounds(before, after), ['card']);
after.players[0].zones.battlefield[0].token = true;
assert.deepEqual(gameSounds(before, after), [], 'land tokens are not played lands');
after.players[0].zones.battlefield = [card(20)];
assert.deepEqual(gameSounds(before, after), [], 'a permanent resolving/entering does not double the casting cue');
after.combat = [{ attackerId: 20, defenderPlayerId: 2, blockerIds: [] }];
assert.deepEqual(gameSounds(before, after), ['attack']);
const attacking = structuredClone(after);
after.combat[0].blockerIds.push(21);
assert.deepEqual(gameSounds(attacking, after), [], 'block/target changes do not repeat the attack');
after.gameOver = true;
assert.deepEqual(gameSounds(before, after), [], 'game-over cleanup is silent');

const storage = new Map();
storage.set('reforge.sound', '{malformed');
Object.defineProperty(globalThis, 'localStorage', { value: {
  getItem: key => storage.get(key) ?? null,
  setItem: (key, value) => storage.set(key, value),
} });
const handlers = new Map();
globalThis.document = {
  hidden: false,
  addEventListener: (name, handler) => handlers.set(name, handler),
  removeEventListener: (name, handler) => { if (handlers.get(name) === handler) handlers.delete(name); },
};
let instance;
class Context {
  state = 'running'; currentTime = 1; sampleRate = 48000; sources = []; destination = {};
  constructor() { instance = this; }
  createGain() { this.master = { gain: { value: 0, setTargetAtTime: value => { this.master.gain.value = value; } }, connect() {} }; return this.master; }
  createBuffer(channels, count) { const samples = new Float32Array(count); return { getChannelData: () => samples, samples, channels }; }
  createBufferSource() {
    const source = { connect() {}, disconnect() {}, start() { this.started = true; }, stop() { this.stopped = true; this.onended?.(); } };
    this.sources.push(source); return source;
  }
  resume() { this.state = 'running'; return Promise.resolve(); }
}
globalThis.AudioContext = Context;
const audio = await import('../ui/src/audio/sounds.ts');
assert.deepEqual(audio.getSoundSettings(), { enabled: true, volume: 0.4 }, 'corrupt preferences use safe defaults');
audio.playSound('click');
assert.equal(instance, undefined, 'incoming game events cannot unlock autoplay');
audio.unlockSounds();
const cleanup = audio.installClickSounds();
for (const effect of ['click', 'card', 'attack', 'turn', 'phase']) {
  instance.currentTime++;
  const count = instance.sources.length;
  audio.playSound(effect);
  assert.equal(instance.sources.length, count + 1);
  const source = instance.sources.at(-1);
  assert.ok(source.started);
  const samples = source.buffer.samples;
  assert.ok(samples.length >= 1000 && samples.length < 24000);
  assert.ok(samples.every(Number.isFinite), `${effect}: finite samples`);
  const peak = samples.reduce((n, sample) => Math.max(n, Math.abs(sample)), 0);
  assert.ok(peak > 0.01 && peak < 1, `${effect}: audible signal without clipping (${peak})`);
  audio.playSound(effect);
  assert.equal(instance.sources.length, count + 1, `${effect}: burst suppression`);
  source.onended();
}
audio.setSoundSettings({ enabled: false });
assert.equal(instance.master.gain.value, 0, 'mute also silences sounds already playing');
let count = instance.sources.length;
instance.currentTime++;
audio.playSound('turn');
assert.equal(instance.sources.length, count);
audio.setSoundSettings({ enabled: true, volume: 0 });
audio.playSound('card');
assert.equal(instance.sources.length, count, 'zero volume is silent');
audio.setSoundSettings({ volume: 0.7 });
assert.deepEqual(JSON.parse(storage.get('reforge.sound')), { enabled: true, volume: 0.7 });
document.hidden = true;
audio.playSound('phase');
assert.equal(instance.sources.length, count, 'background windows do not play stale cues');
document.hidden = false;
instance.state = 'suspended';
audio.playSound('phase');
assert.equal(instance.sources.length, count, 'suspended audio drops cues rather than queueing them');
audio.unlockSounds();
audio.playSound('phase');
assert.equal(instance.sources.length, count + 1);
document.hidden = true;
handlers.get('visibilitychange')();
assert.ok(instance.sources.at(-1).stopped, 'switching away stops active sounds');
cleanup();
assert.equal(handlers.size, 0, 'StrictMode/remounts leave only one set of listeners');
instance.state = 'closed';
globalThis.AudioContext = class { constructor() { throw new Error('No audio device'); } };
assert.doesNotThrow(() => { audio.unlockSounds(); audio.playSound('card'); });
console.log('OK: sound routing, duplicate suppression, five unclipped waveforms, mute/volume, persistence, autoplay, visibility and missing audio device');
