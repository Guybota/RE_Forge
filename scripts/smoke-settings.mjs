// Persist settings across a JVM restart, then prove a changed stop releases live priority.
import { spawn } from 'node:child_process';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const java = process.env.JAVA_HOME ? path.join(process.env.JAVA_HOME, 'bin', 'java') : 'java';
const data = mkdtempSync(path.join(os.tmpdir(), 'reforge-settings-'));
writeFileSync(path.join(data, 'reforge.properties'), 'language=en-US\nskin=mesa\n');
let child, socket, timer, paused = true;
const deadline = setTimeout(() => { console.error('FAIL: settings smoke timed out'); child?.kill(); process.exit(1); }, 180_000);

async function boot() {
  const process = spawn(java, ['-jar', path.join(root, 'engine/target/re-forge-engine.jar'),
    '--assets', path.join(root, 'forge/forge-gui'), '--data', data, '--port', '0', '--exit-with-parent']);
  child = process;
  let output = '';
  process.stderr.on('data', (chunk) => { output += chunk; });
  const port = await new Promise((resolve, reject) => {
    process.on('error', reject);
    process.on('exit', (code) => reject(new Error(`Engine exited ${code}: ${output.slice(-2500)}`)));
    process.stdout.on('data', (chunk) => {
      output += chunk;
      const ready = output.match(/^READY (\d+)$/m);
      if (ready) resolve(Number(ready[1]));
    });
  });
  const ws = new WebSocket(`ws://127.0.0.1:${port}`);
  socket = ws;
  const messages = [];
  ws.onmessage = (event) => messages.push(JSON.parse(event.data));
  await new Promise((resolve, reject) => { ws.onopen = resolve; ws.onerror = reject; });
  const peer = {
    messages,
    send: (msg) => ws.send(JSON.stringify(msg)),
    async wait(predicate, since = 0, limit = 25_000) {
      const end = Date.now() + limit;
      while (Date.now() < end) {
        const slice = messages.slice(since);
        const found = slice.find(predicate);
        if (found) return found;
        const error = slice.find((m) => m.type === 'error');
        if (error) throw new Error(error.message);
        await new Promise((resolve) => setTimeout(resolve, 30));
      }
      const last = messages.findLast((m) => m.type === 'state');
      throw new Error(`Waiting for ${predicate}; turn ${last?.turn} ${last?.phase}, prompt ${JSON.stringify(last?.prompt)}; ${output.slice(-2000)}`);
    },
    async request(msg, type = 'engineInfo') {
      const since = messages.length;
      peer.send(msg);
      return peer.wait((m) => m.type === type, since);
    },
    async stop() {
      ws.close();
      await new Promise((resolve) => { process.once('exit', resolve); process.kill(); });
    },
  };
  return peer;
}

function autoplay(peer) {
  let seq = 0, state, actedAt = 0;
  timer = setInterval(() => {
    let fresh = false;
    for (; seq < peer.messages.length; seq++) {
      const msg = peer.messages[seq];
      if (msg.type === 'choice') {
        const n = msg.options?.length ?? 0;
        const answer = msg.kind === 'text' ? { value: msg.initial ?? '' }
          : msg.kind === 'amounts' ? { amounts: [msg.total, ...Array(Math.max(0, n - 1)).fill(0)] }
          : { picked: [...Array(Math.min(Math.max(0, msg.min ?? 0), n)).keys()] };
        peer.send({ type: 'answer', id: msg.id, ...answer });
      }
      if (msg.type === 'state') {
        state = msg;
        fresh = true;
        const me = state.players.find((p) => p.isLocal);
        if (me?.id === state.activePlayerId && state.phase === 'UPKEEP' && state.prompt.ok.enabled) paused = true;
      }
    }
    if (paused || !state || state.gameOver || !fresh && Date.now() - actedAt < 1500) return;
    actedAt = Date.now();
    const { ok, selectable, chosen } = state.prompt;
    if (ok.enabled) peer.send({ type: 'action', action: 'ok' });
    else {
      const card = selectable.cards.find((id) => !chosen.cards.includes(id));
      const player = selectable.players.find((id) => !chosen.players.includes(id));
      if (card !== undefined) peer.send({ type: 'action', action: 'card', id: card });
      else if (player !== undefined) peer.send({ type: 'action', action: 'player', id: player });
    }
  }, 100);
}

try {
  let peer = await boot();
  const initial = await peer.request({ type: 'hello' });
  const defaults = initial.phaseStops;
  assert.deepEqual(defaults.mine, ['MAIN1', 'COMBAT_DECLARE_BLOCKERS', 'MAIN2']);
  assert.deepEqual(defaults.opponents, ['COMBAT_DECLARE_BLOCKERS', 'END_OF_TURN']);
  const custom = { mine: ['UPKEEP'], opponents: [] };
  let info = await peer.request({ type: 'setPhaseStops', stops: custom });
  assert.deepEqual(info.phaseStops, custom);
  let error = await peer.request({ type: 'setPhaseStops', stops: { mine: ['DRAW'], opponents: ['NOT_A_PHASE'] } }, 'error');
  peer.messages.splice(peer.messages.indexOf(error), 1);
  info = await peer.request({ type: 'hello' });
  assert.deepEqual(info.phaseStops, custom, 'invalid second row does not change the first');
  await peer.request({ type: 'setSkin', skin: 'terminal' });
  await peer.stop();
  peer = await boot();
  info = await peer.request({ type: 'hello' });
  assert.deepEqual(info.phaseStops, custom, 'phase stops including an empty row survive restart');
  assert.equal(info.skin, 'terminal');
  assert.equal(info.language, 'en-US');
  console.log('settings: defaults, atomic validation, empty row and persistence across restart OK');

  autoplay(peer);
  paused = false;
  peer.send({ type: 'startMatch', opponents: 1 });
  const stop = await peer.wait((m) => m.type === 'state' && m.phase === 'UPKEEP' && m.prompt.ok.enabled
    && m.players.some((p) => p.isLocal && p.id === m.activePlayerId), 0, 60_000);
  paused = true;
  info = await peer.request({ type: 'setSkin', skin: 'retro' });
  assert.equal(info.skin, 'retro', 'skin changes during a match');
  error = await peer.request({ type: 'setLanguage', language: 'pt-BR' }, 'error');
  peer.messages.splice(peer.messages.indexOf(error), 1);
  const since = peer.messages.length;
  info = await peer.request({ type: 'setPhaseStops', stops: { mine: [], opponents: [] } });
  assert.deepEqual(info.phaseStops, { mine: [], opponents: [] });
  await peer.wait((m) => m.type === 'state' && (m.turn > stop.turn || m.phase !== 'UPKEEP'), since);
  console.log('match: custom upkeep stop reached; disabling it advances without pressing OK; live skin and language guard OK');
  info = await peer.request({ type: 'setPhaseStops', stops: null });
  assert.deepEqual(info.phaseStops, defaults);
  assert.match(readFileSync(path.join(data, 'reforge.properties'), 'utf8'), /phaseStops\.mine=MAIN1,COMBAT_DECLARE_BLOCKERS,MAIN2/);
  paused = false;
  const latest = peer.messages.findLast((m) => m.type === 'state');
  if (!latest?.prompt.ok.enabled && !latest?.prompt.cancel.enabled) {
    await peer.wait((m) => m.type === 'state' && (m.prompt.ok.enabled || m.prompt.cancel.enabled), peer.messages.length);
  }
  paused = true;
  peer.send({ type: 'action', action: 'concede' });
  await peer.wait((m) => m.type === 'state' && m.gameOver);
  console.log('OK: defaults restored and Commander game ended');
} catch (error) {
  console.error('FAIL:', error);
  process.exitCode = 1;
} finally {
  clearTimeout(deadline);
  clearInterval(timer);
  socket?.close();
  child?.kill();
}
