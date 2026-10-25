// Two independent Forge processes: lobby, chat, Commander state/deltas, privacy and remote input.
import { spawn } from 'node:child_process';
import { mkdtempSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import net from 'node:net';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { startRelay } from './relay-test-server.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const aiCount = Number(process.env.SMOKE_ONLINE_AI ?? 0);
const relayed = process.argv.includes('--relay');
const humanCount = Number(process.env.SMOKE_ONLINE_HUMANS ?? 2);
assert.ok(humanCount >= 2 && humanCount <= 4 && humanCount + aiCount <= 4);
let relayServer;
assert.ok(aiCount === 0 || aiCount === 1, 'SMOKE_ONLINE_AI must be 0 or 1');
const java = process.env.JAVA_HOME ? path.join(process.env.JAVA_HOME, 'bin', 'java') : 'java';
const children = [], sockets = [], bots = [];
const timeout = setTimeout(async () => { console.error('FAIL: online smoke timed out'); await cleanup(); process.exit(1); }, 240_000);
async function cleanup() {
  clearTimeout(timeout);
  bots.forEach(clearInterval);
  sockets.forEach((ws) => ws.close());
  children.forEach((child) => child.kill());
  if (relayServer) await relayServer.close();
}
async function startEngine(label) {
  const data = mkdtempSync(path.join(os.tmpdir(), `reforge-online-${label}-`));
  writeFileSync(path.join(data, 'reforge.properties'), 'language=en-US\nskin=mesa\n');
  const child = spawn(java, ['-jar', path.join(root, 'engine/target/re-forge-engine.jar'),
    '--assets', path.join(root, 'forge/forge-gui'), '--data', data, '--port', '0', '--exit-with-parent'], {
    env: { ...process.env, ...(relayServer ? { RE_FORGE_RELAY_URL: relayServer.url } : {}) },
  });
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
  child.on('exit', () => {
    writeFileSync(path.join(data, 'smoke.log'), output + errors);
    writeFileSync(path.join(data, 'messages.json'), JSON.stringify(messages));
  });
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
        const cancelConcession = peer.conceding && peer.cancelNextConcession && msg.kind === 'confirm';
        const answer = cancelConcession ? { picked: [1] } : msg.kind === 'text' ? { value: msg.initial ?? '' }
          : msg.kind === 'amounts' ? { amounts: msg.initialAmounts ?? [msg.total, ...Array(Math.max(0, n - 1)).fill(0)] }
          : msg.kind === 'arrange' ? { picked: [...Array(n).keys()] }
          : { picked: [...Array(Math.min(Math.max(0, msg.min ?? 0), n)).keys()] };
        peer.send({ type: 'answer', id: msg.id, ...answer });
        if (cancelConcession) { peer.cancelNextConcession = false; peer.conceding = false; }
      }
      if (msg.type === 'state') { lastState = msg; fresh = true; }
    }
    if (peer.pauseAtUpkeep && lastState?.phase === 'UPKEEP' && lastState.prompt.ok.enabled
      && lastState.players.some(p => p.isLocal && p.id === lastState.activePlayerId)) peer.pauseActions = true;
    if (peer.wantConcession && (lastState?.prompt.ok.enabled || lastState?.prompt.cancel.enabled)) peer.conceding = true;
    if (peer.conceding || peer.pauseActions || !lastState || lastState.gameOver || !fresh && Date.now() - actedAt < 1500) return;
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
  return error;
}

async function concede(peer) {
  // Keep answering card/player selections until a button prompt can be held. Pausing before
  // that point can strand the bot in cleanup or another selection with no enabled buttons.
  peer.wantConcession = true;
  const deadline = Date.now() + 60_000;
  for (;;) {
    if (Date.now() >= deadline) throw new Error('Bot did not reach a button prompt for concession');
    await new Promise(resolve => setTimeout(resolve, 50));
    if (!peer.conceding) continue;
    // Let an already-sent OK reach the server before trusting the latest prompt.
    await new Promise(resolve => setTimeout(resolve, 500));
    const latest = peer.messages.findLast(m => m.type === 'state');
    if (latest?.prompt.ok.enabled || latest?.prompt.cancel.enabled) break;
    peer.conceding = false;
  }
  peer.wantConcession = false;
  peer.send({ type: 'action', action: 'concede' });
}

try {
  // RE_FORGE_RELAY_URL tests a published relay instead of the local runtime.
  if (relayed && !process.env.RE_FORGE_RELAY_URL) {
    relayServer = await startRelay();
    console.log(`relay: local Cloudflare runtime ${relayServer.url}`);
  } else if (relayed) console.log(`relay: ${process.env.RE_FORGE_RELAY_URL}`);
  // Main writes a profile beside the shared assets. Wait for READY before starting the second JVM.
  const host = await startEngine('host');
  const guest = await startEngine('guest');
  const port = await freePort();
  await expectError(guest, { type: 'joinGame', name: 'Guest', address: 'not a valid address' });
  host.send({ type: 'listDecks' });
  const decks = (await host.wait((m) => m.type === 'decks')).commander;
  assert.ok(decks.length > 1);
  host.send(relayed ? { type: 'hostGame', name: 'Host', transport: 'relay' } : { type: 'hostGame', name: 'Host', port, upnp: false });
  const opened = await host.wait((m) => m.type === 'lobby' && m.host);
  if (relayed) {
    assert.equal(opened.transport, 'relay');
    assert.equal(opened.addresses.length, 0, 'relay shares a code, not network addresses');
    await expectError(guest, { type: 'joinGame', name: 'Guest', transport: 'relay', code: 'bad' });
    const missing = await expectError(guest, { type: 'joinGame', name: 'Guest', transport: 'relay', code: 'ZZZZZZZZ' });
    assert.equal(missing.code, 'relayRoomMissing', 'missing rooms have a translatable error code');
  }
  guest.send(relayed ? { type: 'joinGame', name: 'Guest', transport: 'relay', code: opened.roomCode.toLowerCase() }
    : { type: 'joinGame', name: 'Guest', address: `127.0.0.1:${port}` });
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
  const humans = [host, guest];
  for (let index = 2; index < humanCount; index++) {
    const extra = await startEngine(`guest-${index}`);
    host.send({ type: 'addSlot' });
    await host.wait(m => m.type === 'lobby' && m.slots.length === index + 1);
    extra.send(relayed ? { type: 'joinGame', name: `Guest ${index}`, transport: 'relay', code: opened.roomCode }
      : { type: 'joinGame', name: `Guest ${index}`, address: `127.0.0.1:${port}` });
    await extra.wait(m => m.type === 'lobby' && m.localSlot === index);
    humans.push(extra);
  }
  for (const [index, peer] of humans.entries()) peer.send({ type: 'setSlot', index, deck: decks[index] });
  await host.wait((m) => m.type === 'lobby' && m.slots.every((s) => s.deck));
  await guest.wait((m) => m.type === 'lobby' && m.slots.every((s) => s.deck));
  for (const peer of humans) peer.send({ type: 'setReady', ready: true });
  await host.wait((m) => m.type === 'lobby' && m.slots.every((s) => s.ready));
  console.log(`lobby: ${humanCount} human seats, deck exchange, AI seat, readiness and chat OK`);
  guest.send({ type: 'setPhaseStops', stops: { mine: ['UPKEEP'], opponents: [], autoPass: true } });
  await guest.wait((m) => m.type === 'engineInfo' && m.phaseStops.mine.length === 1 && m.phaseStops.mine[0] === 'UPKEEP');
  host.send({ type: 'startOnlineMatch' });
  humans.forEach(autoplay);
  for (const peer of humans) {
    const state = await peer.wait((m) => m.type === 'state' && m.players.some((p) => p.isLocal && p.zones.hand.length));
    assert.equal(state.players.length, humanCount + aiCount);
    assert.equal(state.players.filter((p) => p.isLocal).length, 1);
    assert.equal(state.players.filter((p) => p.isAi).length, aiCount);
    const me = state.players.find((p) => p.isLocal);
    assert.ok(me.zones.hand.every((c) => c.name), 'own hand visible');
    assert.ok(state.players.filter(p => !p.isLocal).every(p => p.zones.hand.every(c => c.hidden)), 'every remote hand hidden');
    assert.ok(me.zones.command.length, 'Commander command zone');
    assert.equal(me.life, 40);
  }
  await host.wait((m) => m.type === 'state' && m.turn >= 4, 0, 90_000);
  await guest.wait((m) => m.type === 'state' && m.turn >= 4, 0, 90_000);
  console.log('game: both clients reached turn 4, local hands private, remote deltas/input OK');
  // Keep answering priority on opponents' turns until the guest actually reaches its upkeep.
  guest.pauseAtUpkeep = true;
  const isLocalStop = (m, phase) => m.type === 'state' && m.phase === phase && m.prompt.ok.enabled
    && m.players.some((p) => p.isLocal && p.id === m.activePlayerId);
  if (!isLocalStop(guest.messages.findLast((m) => m.type === 'state'), 'UPKEEP')) {
    await guest.wait((m) => isLocalStop(m, 'UPKEEP'), guest.messages.length, 60_000);
  }
  const changedAt = guest.messages.length;
  guest.send({ type: 'setPhaseStops', stops: { mine: ['DRAW'], opponents: [] } });
  await guest.wait((m) => isLocalStop(m, 'DRAW'), changedAt);
  guest.pauseAtUpkeep = false;
  guest.pauseActions = false;
  console.log('settings: guest stops at upkeep; live change releases upkeep and stops at draw on the host');
  const beforeCancel = guest.messages.length;
  const cancelTurn = guest.messages.findLast(m => m.type === 'state').turn;
  guest.cancelNextConcession = true;
  await concede(guest);
  await guest.wait(m => m.type === 'choice' && m.kind === 'confirm', beforeCancel);
  await guest.wait(m => m.type === 'state' && m.turn > cancelTurn && m.players.some(p => p.isLocal && !p.hasLost), beforeCancel);
  console.log('concession: cancel keeps the guest in the game and turns continue');
  // A remote concession checks client→server controller calls and the end state on both peers.
  for (const peer of humans.slice(1)) {
    await concede(peer);
    if (humanCount > 2 || aiCount) await peer.wait(m => m.type === 'state' && (m.gameOver || !m.players.some(p => p.isLocal && !p.hasLost)));
  }
  if (aiCount) {
    await guest.wait((m) => m.type === 'state' && m.players.some((p) => p.isLocal && p.hasLost));
    await concede(host);
  }
  const ended = await Promise.all(humans.map((peer) => peer.wait((m) => m.type === 'state' && m.gameOver, 0, 30_000)));
  assert.ok(ended.every(state => state.winner === ended[0].winner));
  console.log(`OK: online game over, winner ${ended[0].winner}`);
  for (const peer of humans.slice(1)) {
    const since = peer.messages.length;
    peer.send({ type: 'leaveLobby' });
    await peer.wait(m => m.type === 'lobbyClosed', since);
  }
  let since = host.messages.length;
  host.send({ type: 'leaveLobby' });
  await host.wait((m) => m.type === 'lobbyClosed', since);
  since = host.messages.length;
  host.send(relayed ? { type: 'hostGame', name: 'Host again', transport: 'relay' } : { type: 'hostGame', name: 'Host again', port, upnp: false });
  const reopened = await host.wait((m) => m.type === 'lobby' && m.slots[0].name === 'Host again', since);
  if (relayed) assert.notEqual(reopened.roomCode, opened.roomCode);
  let guestClosedAt;
  if (relayed) {
    guestClosedAt = guest.messages.length;
    guest.send({ type: 'joinGame', name: 'Guest again', transport: 'relay', code: reopened.roomCode });
    await guest.wait(m => m.type === 'lobby' && m.slots[1]?.name === 'Guest again', guestClosedAt);
  }
  host.send({ type: 'leaveLobby' });
  if (relayed) await guest.wait(m => m.type === 'lobbyClosed', guestClosedAt);
  console.log(relayed ? 'cleanup: left both lobbies and created a fresh room' : 'cleanup: left both lobbies and hosted again on the same port');
} catch (error) {
  console.error('FAIL:', error);
  process.exitCode = 1;
} finally { await cleanup(); }
