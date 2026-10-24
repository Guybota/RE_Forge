// Two independent Forge processes: lobby, chat, Commander state/deltas, privacy and remote input.
import { spawn } from 'node:child_process';
import { mkdtempSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import net from 'node:net';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const aiCount = Number(process.env.SMOKE_ONLINE_AI ?? 0);
assert.ok(aiCount === 0 || aiCount === 1, 'SMOKE_ONLINE_AI must be 0 or 1');
const java = process.env.JAVA_HOME ? path.join(process.env.JAVA_HOME, 'bin', 'java') : 'java';
const children = [], sockets = [], bots = [];
const timeout = setTimeout(() => { console.error('FAIL: online smoke timed out'); cleanup(); process.exit(1); }, 240_000);
function cleanup() {
  clearTimeout(timeout);
  bots.forEach(clearInterval);
  sockets.forEach((ws) => ws.close());
  children.forEach((child) => child.kill());
}
async function startEngine(label) {
  const data = mkdtempSync(path.join(os.tmpdir(), `reforge-online-${label}-`));
  writeFileSync(path.join(data, 'reforge.properties'), 'language=en-US\nskin=mesa\n');
  const child = spawn(java, ['-jar', path.join(root, 'engine/target/re-forge-engine.jar'),
    '--assets', path.join(root, 'forge/forge-gui'), '--data', data, '--port', '0', '--exit-with-parent']);
  children.push(child);
  let output = '', errors = '';
  child.stderr.on('data', (chunk) => { errors += chunk; });
  const port = await new Promise((resolve, reject) => {
    child.on('error', reject);
    child.on('exit', (code) => reject(new Error(`${label} exited ${code}: ${errors.slice(-3000)}`)));
    child.stdout.on('data', (chunk) => {
      output += chunk;
      const ready = output.match(/^READY (\d+)$/m);
      if (ready) resolve(Number(ready[1]));
    });
  });
  child.on('exit', () => writeFileSync(path.join(data, 'smoke.log'), output + errors));
  console.log(`${label}: engine ${port}, data ${data}`);
  const ws = new WebSocket(`ws://127.0.0.1:${port}`);
  sockets.push(ws);
  const messages = [];
  ws.onmessage = (event) => {
    const msg = JSON.parse(event.data);
    messages.push(msg);
    if (process.env.SMOKE_DEBUG && msg.type !== 'state') console.log(label, JSON.stringify(msg).slice(0, 500));
  };
  await new Promise((resolve, reject) => { ws.onopen = resolve; ws.onerror = reject; });
  return {
    messages, send: (msg) => ws.send(JSON.stringify(msg)),
    async wait(predicate, since = 0, limit = 25_000) {
      const end = Date.now() + limit;
      while (Date.now() < end) {
        const found = messages.slice(since).find(predicate);
        if (found) return found;
        const error = messages.slice(since).find((msg) => msg.type === 'error');
        if (error) throw new Error(`${label}: ${error.message}`);
        await new Promise((resolve) => setTimeout(resolve, 50));
      }
      throw new Error(`${label}: waiting for ${predicate}; last messages ${JSON.stringify(messages.slice(-2)).slice(0, 1000)}; stderr ${errors.slice(-1500)}`);
    },
  };
}
async function freePort() {
  const server = net.createServer();
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const port = server.address().port;
  await new Promise((resolve) => server.close(resolve));
  return port;
}
function autoplay(peer) {
  let seq = 0, lastState = null, actedAt = 0;
  const timer = setInterval(() => {
    let fresh = false;
    for (; seq < peer.messages.length; seq++) {
      const msg = peer.messages[seq];
      if (msg.type === 'error') { console.error(msg.message); continue; }
      if (msg.type === 'choice') {
        const n = msg.options?.length ?? 0;
        const answer = msg.kind === 'text' ? { value: msg.initial ?? '' }
          : msg.kind === 'amounts' ? { amounts: [msg.total, ...Array(Math.max(0, n - 1)).fill(0)] }
          : { picked: [...Array(Math.min(Math.max(0, msg.min ?? 0), n)).keys()] };
        peer.send({ type: 'answer', id: msg.id, ...answer });
      }
      if (msg.type === 'state') { lastState = msg; fresh = true; }
    }
    if (peer.conceding || !lastState || lastState.gameOver || !fresh && Date.now() - actedAt < 1500) return;
    actedAt = Date.now();
    const { ok, selectable, chosen } = lastState.prompt;
    if (ok.enabled) peer.send({ type: 'action', action: 'ok' });
    else {
      const id = selectable.cards.find((id) => !chosen.cards.includes(id));
      if (id !== undefined) peer.send({ type: 'action', action: 'card', id });
      else {
        // Multiplayer's opening coin toss asks which player should start.
        const player = selectable.players.find((id) => !chosen.players.includes(id));
        if (player !== undefined) peer.send({ type: 'action', action: 'player', id: player });
      }
    }
  }, 150);
  bots.push(timer);
}

async function expectError(peer, command) {
  const since = peer.messages.length;
  peer.send(command);
  const error = await peer.wait((m) => m.type === 'error', since);
  peer.messages.splice(peer.messages.indexOf(error), 1);
}

async function concede(peer) {
  // Stop pressing OK before requesting concession. Otherwise the bot can race its own
  // concession by immediately advancing the prompt that the engine is waiting on.
  peer.conceding = true;
  const latest = peer.messages.findLast((m) => m.type === 'state');
  if (!latest?.prompt.ok.enabled && !latest?.prompt.cancel.enabled) {
    await peer.wait((m) => m.type === 'state' && (m.prompt.ok.enabled || m.prompt.cancel.enabled), peer.messages.length, 60_000);
  }
  peer.send({ type: 'action', action: 'concede' });
}

try {
  // Main writes a profile beside the shared assets. Wait for READY before starting the second JVM.
  const host = await startEngine('host');
  const guest = await startEngine('guest');
  const port = await freePort();
  await expectError(guest, { type: 'joinGame', name: 'Guest', address: 'not a valid address' });
  host.send({ type: 'listDecks' });
  const decks = (await host.wait((m) => m.type === 'decks')).commander;
  assert.ok(decks.length > 1);
  host.send({ type: 'hostGame', name: 'Host', port, upnp: false });
  await host.wait((m) => m.type === 'lobby' && m.host);
  guest.send({ type: 'joinGame', name: 'Guest', address: `127.0.0.1:${port}` });
  await guest.wait((m) => m.type === 'lobby' && m.localSlot === 1);
  await host.wait((m) => m.type === 'lobby' && m.slots[1].name === 'Guest');
  await expectError(guest, { type: 'setSlot', index: 0, deck: decks[0] });
  await expectError(guest, { type: 'startOnlineMatch' });
  await expectError(host, { type: 'startMatch', opponents: 1 });
  host.send({ type: 'chat', text: 'host-to-guest' });
  guest.send({ type: 'chat', text: 'guest-to-host' });
  await guest.wait((m) => m.type === 'chatMessage' && m.text === 'host-to-guest');
  await host.wait((m) => m.type === 'chatMessage' && m.text === 'guest-to-host');
  for (const peer of [host, guest]) {
    for (const text of ['host-to-guest', 'guest-to-host']) {
      await peer.wait((m) => m.type === 'chatMessage' && m.text === text);
      assert.equal(peer.messages.filter((m) => m.type === 'chatMessage' && m.text === text).length, 1, 'chat is shown once');
    }
  }
  host.send({ type: 'addSlot' });
  await host.wait((m) => m.type === 'lobby' && m.slots.length === 3);
  host.send({ type: 'setSlot', index: 2, slotType: 'ai', deck: decks[0] });
  await guest.wait((m) => m.type === 'lobby' && m.slots[2]?.kind === 'ai' && m.slots[2]?.deck);
  host.send({ type: 'removeSlot', index: 2 });
  await guest.wait((m) => m.type === 'lobby' && m.slots.length === 2 && m.slots[0].name === 'Host');
  if (aiCount) {
    host.send({ type: 'addSlot' });
    await host.wait((m) => m.type === 'lobby' && m.slots.length === 3);
    host.send({ type: 'setSlot', index: 2, slotType: 'ai', deck: decks[2] });
    await guest.wait((m) => m.type === 'lobby' && m.slots[2]?.kind === 'ai' && m.slots[2]?.deck);
  }
  host.send({ type: 'setSlot', index: 0, deck: decks[0] });
  guest.send({ type: 'setSlot', index: 1, deck: decks[1] });
  await host.wait((m) => m.type === 'lobby' && m.slots.every((s) => s.deck));
  await guest.wait((m) => m.type === 'lobby' && m.slots.every((s) => s.deck));
  host.send({ type: 'setReady', ready: true });
  guest.send({ type: 'setReady', ready: true });
  await host.wait((m) => m.type === 'lobby' && m.slots.every((s) => s.ready));
  console.log('lobby: two seats, deck exchange, AI seat, readiness and chat OK');
  host.send({ type: 'startOnlineMatch' });
  autoplay(host); autoplay(guest);
  for (const peer of [host, guest]) {
    const state = await peer.wait((m) => m.type === 'state' && m.players.some((p) => p.isLocal && p.zones.hand.length));
    assert.equal(state.players.length, 2 + aiCount);
    assert.equal(state.players.filter((p) => p.isLocal).length, 1);
    assert.equal(state.players.filter((p) => p.isAi).length, aiCount);
    const me = state.players.find((p) => p.isLocal);
    const other = state.players.find((p) => !p.isLocal);
    assert.ok(me.zones.hand.every((c) => c.name), 'own hand visible');
    assert.ok(other.zones.hand.every((c) => c.hidden), 'remote hand hidden');
    assert.ok(me.zones.command.length, 'Commander command zone');
    assert.equal(me.life, 40);
  }
  await host.wait((m) => m.type === 'state' && m.turn >= 4, 0, 90_000);
  await guest.wait((m) => m.type === 'state' && m.turn >= 4, 0, 90_000);
  console.log('game: both clients reached turn 4, local hands private, remote deltas/input OK');
  // A remote concession checks client→server controller calls and the end state on both peers.
  await concede(guest);
  if (aiCount) {
    await guest.wait((m) => m.type === 'state' && m.players.some((p) => p.isLocal && p.hasLost));
    await concede(host);
  }
  const ended = await Promise.all([host, guest].map((peer) => peer.wait((m) => m.type === 'state' && m.gameOver, 0, 30_000)));
  assert.equal(ended[0].winner, ended[1].winner);
  console.log(`OK: online game over, winner ${ended[0].winner}`);
  let since = guest.messages.length;
  guest.send({ type: 'leaveLobby' });
  await guest.wait((m) => m.type === 'lobbyClosed', since);
  since = host.messages.length;
  host.send({ type: 'leaveLobby' });
  await host.wait((m) => m.type === 'lobbyClosed', since);
  since = host.messages.length;
  host.send({ type: 'hostGame', name: 'Host again', port, upnp: false });
  await host.wait((m) => m.type === 'lobby' && m.slots[0].name === 'Host again', since);
  host.send({ type: 'leaveLobby' });
  console.log('cleanup: left both lobbies and hosted again on the same port');
} catch (error) {
  console.error('FAIL:', error);
  process.exitCode = 1;
} finally { cleanup(); }
