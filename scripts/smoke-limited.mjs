// Draft, Sealed and Puzzles through the socket: Forge's boosters and AI drafters, deck rules, a game against an AI
// deck with its result saved, a full draft, and a puzzle that starts from its fixed state.
// Throw-away data folder in Portuguese. Run with: npm run engine:smoke-limited   (after npm run engine:build)
import { spawn } from 'node:child_process';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const data = mkdtempSync(path.join(os.tmpdir(), 'reforge-limited-'));
writeFileSync(path.join(data, 'reforge.properties'), 'language=pt-BR\nskin=mesa\n');
const java = process.env.JAVA_HOME ? path.join(process.env.JAVA_HOME, 'bin', 'java') : 'java';
let engine;
const timeout = setTimeout(() => fail('timed out'), 300_000);
let stderr = '';
function fail(message) {
  if (process.env.SMOKE_DEBUG) console.error(stderr.split('\n').filter((l) => !/not assigned to any set|Upcoming set/.test(l)).slice(-40).join('\n'));
  engine?.kill();
  console.error(`FAIL: ${message}`);
  process.exit(1);
}

function start() {
  engine = spawn(java, ['-jar', path.join(root, 'engine/target/re-forge-engine.jar'), '--port', '0',
    '--assets', path.join(root, 'forge/forge-gui'), '--data', data, '--exit-with-parent']);
  engine.stderr.on('data', (chunk) => { stderr += chunk; });
  return new Promise((resolve) => {
    let out = '';
    engine.stdout.on('data', (chunk) => {
      out += chunk;
      const m = out.match(/^READY (\d+)$/m);
      if (m) { engine.stdout.removeAllListeners('data'); resolve(Number(m[1])); }
    });
  });
}

async function connect(port) {
  const ws = new WebSocket(`ws://127.0.0.1:${port}`);
  const messages = [];
  ws.onmessage = (event) => messages.push(JSON.parse(event.data));
  await new Promise((resolve) => { ws.onopen = resolve; });
  const send = (o) => ws.send(JSON.stringify(o));
  // Waits for the first new message of `type` (errors fail unless `allowError`).
  const ask = async (message, type, allowError = false) => {
    const since = messages.length;
    send(message);
    const end = Date.now() + 120_000;
    while (Date.now() < end) {
      const found = messages.slice(since).find((m) => m.type === type || m.type === 'error');
      if (found?.type === 'error' && !allowError) fail(`engine error for ${JSON.stringify(message).slice(0, 80)}: ${found.message}`);
      if (found) return found;
      await new Promise((r) => setTimeout(r, 30));
    }
    fail(`no ${type} after ${JSON.stringify(message).slice(0, 80)}`);
  };
  return { ws, messages, send, ask };
}

/** Plays nothing: passes until a state arrives, then concedes and confirms. */
async function concede(peer) {
  const since = peer.messages.length;
  const end = Date.now() + 120_000;
  let conceded = false;
  while (Date.now() < end) {
    const fresh = peer.messages.slice(since);
    const over = fresh.find((m) => m.type === 'state' && m.gameOver);
    if (over) return over;
    const choice = fresh.filter((m) => m.type === 'choice').pop();
    if (choice && !choice.answered) { choice.answered = true; peer.send({ type: 'answer', id: choice.id, picked: [0] }); }
    if (!conceded && fresh.some((m) => m.type === 'state')) { conceded = true; peer.send({ type: 'action', action: 'concede' }); }
    await new Promise((r) => setTimeout(r, 50));
  }
  if (process.env.SMOKE_DEBUG) console.log(JSON.stringify(peer.messages.slice(since).filter((m) => m.type !== 'state').slice(-6)).slice(0, 2500), JSON.stringify(peer.messages.filter((m) => m.type === 'state').pop()?.prompt));
  fail('the game did not end after conceding');
}

const lim = (action, extra = {}) => ({ type: 'limited', action, ...extra });

const port = await start();
let peer = await connect(port);

// Puzzles: Forge's list, easiest first; one starts from its fixed state.
const puzzles = (await peer.ask({ type: 'puzzles' }, 'puzzles')).puzzles;
assert.ok(puzzles.length > 300, 'Forge puzzles listed');
assert.ok(puzzles.every((p) => p.id && p.name && p.goal), 'puzzle metadata');
assert.equal(puzzles[0].difficulty, 'Common', 'easiest first');
const puzzle = puzzles.find((p) => p.id === 'MTGP_01');
assert.match(puzzle.description, /4 damage/);
peer.send({ type: 'startPuzzle', id: 'MTGP_01' });
const puzzleState = await (async () => {
  const end = Date.now() + 60_000;
  while (Date.now() < end) {
    const s = peer.messages.filter((m) => m.type === 'state').pop();
    if (s?.players?.some((p) => p.isLocal && p.zones.hand.length === 3)) return s;
    await new Promise((r) => setTimeout(r, 50));
  }
  fail('puzzle state never arrived');
})();
const me = puzzleState.players.find((p) => p.isLocal), them = puzzleState.players.find((p) => !p.isLocal);
assert.equal(me.life, 5); assert.equal(them.life, 4);
assert.equal(puzzleState.puzzle?.goal, 'Win', 'the puzzle goal travels with the state');
await concede(peer);
console.log(`puzzles: ${puzzles.length}, MTGP_01 started (hand 3, life 5 vs 4) and conceded`);

// Sets with boosters.
const sets = (await peer.ask(lim('sets'), 'limitedSets')).sets;
assert.ok(sets.length > 20, 'boosterable sets');
const code = sets.find((s) => s.code === 'DOM')?.code ?? sets[0].code;

// Sealed: 6 boosters, a deck from the pool plus free basics, rules enforced.
let event = await peer.ask(lim('newSealed', { set: code }), 'limitedEvent');
const poolCount = event.pool.reduce((n, c) => n + c.qty, 0);
assert.ok(poolCount >= 80, `sealed pool of ${poolCount}`);
assert.equal(event.lands.length, 5, 'five basic lands');
assert.equal(event.opponents.length, 3, 'three AI opponents');
const nonlands = event.pool.filter((c) => c.group !== 'land').flatMap((c) => Array(c.qty).fill(c)).slice(0, 23);
const entry = (c, qty) => ({ nameEn: c.nameEn, set: c.set, number: c.number, qty });
const deck = [...nonlands.map((c) => entry(c, 1)), entry(event.lands[0], 9), entry(event.lands[1], 8)];
const tooMany = await peer.ask(lim('saveDeck', { id: event.id, main: [entry(nonlands[0], 99)] }), 'limitedEvent', true);
assert.equal(tooMany.type, 'error', 'more copies than opened are refused');
const short = await peer.ask(lim('saveDeck', { id: event.id, main: deck.slice(0, 5) }), 'limitedEvent');
assert.ok(short.problem, 'a short deck is flagged');
event = await peer.ask(lim('saveDeck', { id: event.id, main: deck }), 'limitedEvent');
assert.equal(event.problem, undefined, `40-card deck is legal: ${event.problem}`);
assert.equal(event.main.reduce((n, c) => n + c.qty, 0), 40);
assert.equal(event.pool.reduce((n, c) => n + c.qty, 0), poolCount, 'the pool keeps every opened card');

// A game against the first AI deck; conceding records a loss.
peer.send(lim('play', { id: event.id, opponent: 0 }));
await concede(peer);
const after = await (async () => {
  const end = Date.now() + 30_000;
  while (Date.now() < end) {
    const e = peer.messages.filter((m) => m.type === 'limitedEvent').pop();
    if (e?.opponents[0].result) return e;
    await new Promise((r) => setTimeout(r, 50));
  }
  fail('result not recorded');
})();
assert.equal(after.opponents[0].result, 'lost');
console.log(`sealed ${code}: pool ${poolCount}, deck 40, lost to opponent 1 (recorded)`);

// Draft: every pick until Forge's AI drafters build their decks.
let state = await peer.ask(lim('newDraft', { set: code }), 'draft');
assert.ok(state.pack.length >= 10, 'first pack');
let picks = 0;
for (;;) {
  const reply = await peer.ask(lim('pick', { index: 0 }), state.pack.length > 1 || state.round < state.rounds ? 'draft' : 'limitedEvent');
  picks++;
  if (reply.type === 'limitedEvent' || picks > 60) { event = reply; break; }
  // The last pick of the last pack answers with the event instead.
  if (reply.type !== 'draft') fail(`unexpected ${reply.type}`);
  state = reply;
  assert.equal(state.picked.reduce((n, c) => n + c.qty, 0), picks, 'every pick is kept');
}
if (event.type !== 'limitedEvent') event = await (async () => {
  const end = Date.now() + 30_000;
  while (Date.now() < end) { const e = peer.messages.filter((m) => m.type === 'limitedEvent').pop(); if (e?.mode === 'draft') return e; await new Promise((r) => setTimeout(r, 50)); }
  fail('draft event missing');
})();
assert.equal(event.mode, 'draft');
assert.equal(event.pool.reduce((n, c) => n + c.qty, 0), picks, 'the pool is the picks');
assert.equal(event.opponents.length, 7, 'seven AI drafters');
console.log(`draft ${code}: ${picks} picks, 7 AI decks`);

// Events survive a restart; deleting removes them.
engine.kill();
await new Promise((r) => setTimeout(r, 1000));
peer = await connect(await start());
const events = (await peer.ask(lim('events'), 'limitedEvents')).events;
const sealed = events.find((e) => e.mode === 'sealed');
assert.ok(sealed?.built && sealed.losses === 1, 'sealed event, deck and result saved');
assert.ok(events.some((e) => e.mode === 'draft'), 'draft event saved');
const left = (await peer.ask(lim('delete', { id: sealed.id }), 'limitedEvents')).events;
assert.ok(!left.some((e) => e.id === sealed.id), 'deleted');

clearTimeout(timeout);
console.log('OK: puzzles, sealed (pool, deck rules, game, result), draft (picks, AI decks) and saved events');
peer.ws.close();
engine.kill();
process.exit(0);
