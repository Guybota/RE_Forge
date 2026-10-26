// A room-code game survives dropped relay connections: a TCP proxy between the engines and a local relay cuts the
// guest's connection, then the host's, mid-game (no close handshake, like a network failure). Forge must resume
// both players and the game must go on, with no lobby closing and no winner declared.
// Run with: npm run engine:smoke-relay-drop   (after npm run engine:build)
import { spawn } from 'node:child_process';
import { mkdtempSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import net from 'node:net';
import tls from 'node:tls';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { startRelay } from './relay-test-server.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const java = process.env.JAVA_HOME ? path.join(process.env.JAVA_HOME, 'bin', 'java') : 'java';
const children = [], sockets = [], bots = [], engines = [];
let relay, proxy;
const timeout = setTimeout(async () => { console.error('FAIL: timed out'); await cleanup(); process.exit(1); }, 420_000);
async function cleanup() {
  clearTimeout(timeout);
  bots.forEach(clearInterval);
  sockets.forEach((ws) => ws.close());
  children.forEach((child) => child.kill());
  proxy?.server.close();
  if (relay) await relay.close();
}

/**
 * Forwards TCP to the relay and can cut every connection of one role ("host" or "guest") at once. An HTTPS relay
 * (SMOKE_RELAY_URL, e.g. the published one) is reached over TLS with its own Host header; engines talk plain HTTP to
 * the proxy on loopback.
 */
async function startProxy(target) {
  const { hostname, port, protocol } = new URL(target);
  const secure = protocol === 'https:';
  const live = new Set();
  const server = net.createServer((client) => {
    const upstream = secure ? tls.connect(Number(port || 443), hostname, { servername: hostname }) : net.connect(Number(port), hostname);
    const entry = { client, upstream, role: null };
    live.add(entry);
    // Java may reuse the connection that created the room, so the upgrade isn't always the first request on it.
    client.on('data', (chunk) => {
      const text = chunk.toString('latin1');
      entry.role ??= /role=(host|guest)/.exec(text)?.[1] ?? null;
      upstream.write(secure && /^(GET|POST) /.test(text) ? Buffer.from(text.replace(/\r\nHost: [^\r]+/i, `\r\nHost: ${hostname}`), 'latin1') : chunk);
    });
    upstream.pipe(client);
    const end = () => { live.delete(entry); client.destroy(); upstream.destroy(); };
    client.on('error', end); upstream.on('error', end); client.on('close', end); upstream.on('close', end);
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  return {
    server,
    url: `http://127.0.0.1:${server.address().port}`,
    cut(role) {
      let n = 0;
      // A TCP reset (a plain close over TLS): neither side gets a WebSocket close.
      for (const entry of [...live]) if (entry.role === role) { entry.client.resetAndDestroy(); secure ? entry.upstream.destroy() : entry.upstream.resetAndDestroy(); n++; }
      return n;
    },
  };
}

async function startEngine(label) {
  const data = mkdtempSync(path.join(os.tmpdir(), `reforge-drop-${label}-`));
  writeFileSync(path.join(data, 'reforge.properties'), 'language=en-US\nskin=mesa\n');
  const child = spawn(java, ['-jar', path.join(root, 'engine/target/re-forge-engine.jar'),
    '--assets', path.join(root, 'forge/forge-gui'), '--data', data, '--port', '0', '--exit-with-parent'], {
    env: { ...process.env, RE_FORGE_RELAY_URL: proxy.url },
  });
  children.push(child);
  let output = '', errors = '';
  child.stderr.on('data', (chunk) => { errors += chunk; if (process.env.SMOKE_DEBUG) for (const l of String(chunk).split(/\r?\n/)) if (l.startsWith('Relay:')) console.log(label, l); });
  const port = await new Promise((resolve, reject) => {
    child.on('exit', (code) => reject(new Error(`${label} exited ${code}: ${errors.slice(-2000)}`)));
    child.stdout.on('data', (chunk) => {
      output += chunk;
      const ready = output.match(/^READY (\d+)$/m);
      if (ready) resolve(Number(ready[1]));
    });
  });
  const ws = new WebSocket(`ws://127.0.0.1:${port}`);
  sockets.push(ws);
  const messages = [];
  ws.onmessage = (event) => messages.push(JSON.parse(event.data));
  await new Promise((resolve, reject) => { ws.onopen = resolve; ws.onerror = reject; });
  console.log(`${label}: data ${data}`);
  return {
    label, messages, relayLog: () => errors.split(/\r?\n/).filter((l) => l.startsWith('Relay:')),
    send: (msg) => ws.send(JSON.stringify(msg)),
    async wait(predicate, since = 0, limit = 60_000) {
      const end = Date.now() + limit;
      while (Date.now() < end) {
        const fresh = messages.slice(since);
        const found = fresh.find(predicate);
        if (found) return found;
        const closed = fresh.find((m) => m.type === 'lobbyClosed');
        if (closed) throw new Error(`${label}: the lobby closed; relay log: ${errors.split(/\r?\n/).filter((l) => l.startsWith('Relay:')).join(' | ')}`);
        await new Promise((resolve) => setTimeout(resolve, 50));
      }
      throw new Error(`${label}: timed out; last ${JSON.stringify(messages.slice(-2)).slice(0, 600)}`);
    },
  };
}

/** Keeps a player moving: answers choices with their first options, presses OK or picks the first selectable. */
function autoplay(peer) {
  let seq = 0, last = null, actedAt = 0;
  bots.push(setInterval(() => {
    for (; seq < peer.messages.length; seq++) {
      const msg = peer.messages[seq];
      if (msg.type === 'choice') {
        const n = msg.options?.length ?? 0;
        const answer = msg.kind === 'text' ? { value: msg.initial ?? '' } : msg.kind === 'amounts' ? { amounts: msg.initialAmounts ?? [msg.total] }
          : msg.kind === 'arrange' ? { picked: [...Array(n).keys()] } : { picked: [...Array(Math.min(Math.max(0, msg.min ?? 0), n)).keys()] };
        peer.send({ type: 'answer', id: msg.id, ...answer });
      }
      if (msg.type === 'state') last = msg;
    }
    if (!last || last.gameOver || Date.now() - actedAt < 400) return;
    actedAt = Date.now();
    const { ok, selectable, chosen } = last.prompt;
    if (ok.enabled) { peer.send({ type: 'action', action: 'ok' }); return; }
    // Discards, targets and the opening coin toss: pick the first card or player still free.
    const card = selectable.cards.find((id) => !chosen.cards.includes(id));
    if (card !== undefined) { peer.send({ type: 'action', action: 'card', id: card }); return; }
    const player = selectable.players.find((id) => !chosen.players.includes(id));
    if (player !== undefined) peer.send({ type: 'action', action: 'player', id: player });
  }, 150));
}

const turn = (peer) => peer.messages.filter((m) => m.type === 'state').pop()?.turn ?? 0;

try {
  if (!process.env.SMOKE_RELAY_URL) relay = await startRelay();
  proxy = await startProxy(process.env.SMOKE_RELAY_URL || relay.url);
  console.log('relay:', process.env.SMOKE_RELAY_URL || 'local');
  const host = await startEngine('host');
  const guest = await startEngine('guest');
  engines.push(host, guest);
  host.send({ type: 'listDecks' });
  const decks = (await host.wait((m) => m.type === 'decks')).commander;
  host.send({ type: 'hostGame', name: 'Host', transport: 'relay' });
  const room = await host.wait((m) => m.type === 'lobby' && m.host);
  guest.send({ type: 'joinGame', name: 'Guest', transport: 'relay', code: room.roomCode });
  await guest.wait((m) => m.type === 'lobby' && m.localSlot === 1);
  host.send({ type: 'setSlot', index: 0, deck: decks[0] });
  guest.send({ type: 'setSlot', index: 1, deck: decks[1] });
  await host.wait((m) => m.type === 'lobby' && m.slots.every((s) => s.deck));
  host.send({ type: 'setReady', ready: true });
  guest.send({ type: 'setReady', ready: true });
  await host.wait((m) => m.type === 'lobby' && m.slots.every((s) => s.ready));
  host.send({ type: 'startOnlineMatch' });
  autoplay(host); autoplay(guest);
  await host.wait((m) => m.type === 'state' && m.turn >= 2, 0, 120_000);
  await guest.wait((m) => m.type === 'state' && m.turn >= 2, 0, 120_000);
  console.log('game running through the proxy, turn', turn(host));

  for (const role of (process.env.SMOKE_DROP_ROLES ?? 'guest,host').split(',')) {
    const before = turn(host), hostSince = host.messages.length, guestSince = guest.messages.length;
    const started = Date.now();
    assert.ok(proxy.cut(role) > 0, `${role} relay connection cut`);
    await guest.wait((m) => m.type === 'connection' && m.reconnecting, guestSince, 60_000);
    await guest.wait((m) => m.type === 'connection' && !m.reconnecting, guestSince, 180_000);
    const resumed = Date.now() - started;
    // The game goes on: both see later turns, nobody has won.
    await host.wait((m) => m.type === 'state' && m.turn >= before + 2, hostSince, 180_000);
    await guest.wait((m) => m.type === 'state' && m.turn >= before + 2, guestSince, 180_000);
    assert.ok(!host.messages.slice(hostSince).some((m) => m.type === 'state' && m.gameOver), 'no winner after the drop');
    console.log(`${role} drop: guest resumed after ${(resumed / 1000).toFixed(1)} s, game reached turn ${turn(host)}`);
    if (process.env.SMOKE_DEBUG) console.log(host.relayLog().join('\n'), '\n', guest.relayLog().join('\n'));
  }

  console.log('OK: guest and host relay drops mid-game; Forge resumed the guest each time and the game went on');
  await cleanup();
  process.exit(0);
} catch (e) {
  console.error(`FAIL: ${e.message}`);
  if (process.env.SMOKE_DEBUG) for (const peer of engines) {
    const last = peer.messages.filter((m) => m.type === 'state').pop();
    console.error(peer.label, 'last state turn', last?.turn, last?.phase, 'priority', last?.priorityPlayerId, 'prompt', JSON.stringify(last?.prompt).slice(0, 300));
    console.error(peer.label, 'recent', peer.messages.slice(-8).map((m) => m.type + (m.type === 'connection' ? ':' + m.reconnecting : '')).join(','));
  }
  await cleanup();
  process.exit(1);
}
