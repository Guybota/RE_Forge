// Online lobby comings and goings between two engines: a guest leaves and joins again, a guest's window closes,
// the host closes the room, and the host kicks a guest. Every engine must be able to open or join a room again.
// Run with: npm run engine:smoke-online-lobby   (--relay goes through a local relay Worker)
import { spawn } from 'node:child_process';
import { mkdtempSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import net from 'node:net';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { startRelay } from './relay-test-server.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const relayed = process.argv.includes('--relay');
const java = process.env.JAVA_HOME ? path.join(process.env.JAVA_HOME, 'bin', 'java') : 'java';
const children = [], sockets = [];
let relayServer;
const timeout = setTimeout(async () => { console.error('FAIL: timed out'); await cleanup(); process.exit(1); }, 240_000);
async function cleanup() {
  clearTimeout(timeout);
  sockets.forEach((ws) => ws.close());
  children.forEach((child) => child.kill());
  if (relayServer) await relayServer.close();
}

async function startEngine(label) {
  const data = mkdtempSync(path.join(os.tmpdir(), `reforge-lobby-${label}-`));
  writeFileSync(path.join(data, 'reforge.properties'), 'language=en-US\nskin=mesa\n');
  const child = spawn(java, ['-jar', path.join(root, 'engine/target/re-forge-engine.jar'),
    '--assets', path.join(root, 'forge/forge-gui'), '--data', data, '--port', '0', '--exit-with-parent'], {
    env: { ...process.env, ...(relayServer ? { RE_FORGE_RELAY_URL: relayServer.url } : {}) },
  });
  children.push(child);
  let output = '', errors = '';
  child.stderr.on('data', (chunk) => { errors += chunk; });
  const port = await new Promise((resolve, reject) => {
    child.on('exit', (code) => reject(new Error(`${label} exited ${code}: ${errors.slice(-2000)}`)));
    child.stdout.on('data', (chunk) => {
      output += chunk;
      const ready = output.match(/^READY (\d+)$/m);
      if (ready) resolve(Number(ready[1]));
    });
  });
  const peer = { label, port, errors: () => errors };
  await connect(peer);
  return peer;
}

/** A (new) UI connection to the engine, like the window being reopened. */
async function connect(peer) {
  const ws = new WebSocket(`ws://127.0.0.1:${peer.port}`);
  sockets.push(ws);
  const messages = [];
  ws.onmessage = (event) => {
    const msg = JSON.parse(event.data);
    messages.push(msg);
    if (process.env.SMOKE_DEBUG) console.log(peer.label, JSON.stringify(msg).slice(0, 300));
  };
  await new Promise((resolve, reject) => { ws.onopen = resolve; ws.onerror = reject; });
  Object.assign(peer, {
    ws, messages,
    send: (msg) => ws.send(JSON.stringify(msg)),
    mark: () => messages.length,
    async wait(predicate, since = 0, limit = 25_000) {
      const end = Date.now() + limit;
      while (Date.now() < end) {
        const found = messages.slice(since).find(predicate);
        if (found) return found;
        const error = messages.slice(since).find((m) => m.type === 'error');
        if (error) throw new Error(`${peer.label}: ${error.message}`);
        await new Promise((resolve) => setTimeout(resolve, 50));
      }
      throw new Error(`${peer.label}: timed out; last ${JSON.stringify(messages.slice(-3)).slice(0, 800)}; stderr ${peer.errors().slice(-1500)}`);
    },
  });
}

async function freePort() {
  const server = net.createServer();
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const port = server.address().port;
  await new Promise((resolve) => server.close(resolve));
  return port;
}

async function host(peer) {
  const since = peer.mark();
  const port = await freePort();
  peer.send(relayed ? { type: 'hostGame', name: 'Host', transport: 'relay' } : { type: 'hostGame', name: 'Host', port, upnp: false });
  const lobby = await peer.wait((m) => m.type === 'lobby' && m.host, since);
  return relayed ? { transport: 'relay', code: lobby.roomCode } : { address: `127.0.0.1:${port}` };
}

async function join(peer, room, name) {
  const since = peer.mark();
  peer.send({ type: 'joinGame', name, ...room });
  return peer.wait((m) => m.type === 'lobby' && m.localSlot >= 1, since);
}

/** Waits until the host's lobby has no human in seat 1 (open or gone). */
const seatFree = (peer, since) => peer.wait((m) => m.type === 'lobby' && (m.slots[1] === undefined || m.slots[1].kind === 'open'), since);

try {
  // RE_FORGE_RELAY_URL tests a published relay instead of the local runtime.
  if (relayed && !process.env.RE_FORGE_RELAY_URL) relayServer = await startRelay();
  const a = await startEngine('host');
  const b = await startEngine('guest');

  // 1. The guest leaves and joins the same room again.
  let room = await host(a);
  await join(b, room, 'Guest');
  let since = a.mark();
  const left = b.mark();
  b.send({ type: 'leaveLobby' });
  await b.wait((m) => m.type === 'lobbyClosed', left);
  await seatFree(a, since);
  await join(b, room, 'Guest');
  console.log('guest left and joined again');

  // 2. The guest's window closes in the lobby; a new window joins again.
  since = a.mark();
  b.ws.close();
  await seatFree(a, since);
  await connect(b);
  await join(b, room, 'Guest');
  console.log('guest window closed and a new one joined');

  // 3. The host closes the room; both can open or join another one.
  since = b.mark();
  a.send({ type: 'leaveLobby' });
  await b.wait((m) => m.type === 'lobbyClosed', since, 30_000);
  room = await host(b);
  await join(a, room, 'Former host');
  console.log('host closed the room; roles swapped in a new one');

  // 4. The host kicks the guest, who is told so and can join again; others can't kick.
  since = b.mark();
  const kicked = a.mark();
  a.send({ type: 'kickPlayer', index: 1 });
  const lobbyClosed = await a.wait((m) => m.type === 'lobbyClosed' || m.type === 'error', kicked, 30_000);
  assert.equal(lobbyClosed.type, 'error', 'a guest cannot kick');
  a.messages.splice(a.messages.indexOf(lobbyClosed), 1);
  b.send({ type: 'kickPlayer', index: 1 });
  const notice = await a.wait((m) => m.type === 'error' && m.code === 'kicked', kicked, 30_000);
  assert.ok(notice, 'kicked guest is told');
  await a.wait((m) => m.type === 'lobbyClosed', kicked);
  await seatFree(b, since);
  a.messages.splice(a.messages.indexOf(notice), 1);
  await join(a, room, 'Former host');
  console.log('host kicked the guest, who joined again');

  await cleanup();
  console.log(`OK: lobby leave/rejoin, closed window, closed room and kick${relayed ? ' through the relay' : ''}`);
  process.exit(0);
} catch (e) {
  console.error(`FAIL: ${e.message}`);
  await cleanup();
  process.exit(1);
}
