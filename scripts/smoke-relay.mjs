import assert from 'node:assert/strict';
import { startRelay } from './relay-test-server.mjs';

const relay = await startRelay();
const sockets = [];
const deadline = setTimeout(() => { console.error('FAIL: relay smoke timed out'); process.exit(1); }, 90_000);
async function create() {
  const response = await relay.mf.dispatchFetch(`${relay.url}/rooms`, { method: 'POST' });
  assert.equal(response.status, 201);
  const room = await response.json();
  assert.match(room.code, /^[A-HJ-NP-Z2-9]{8}$/);
  assert.equal(room.hostToken.length, 64);
  return room;
}
async function upgrade(room, role, token) {
  return relay.mf.dispatchFetch(`${relay.url}/rooms/${room.code}?role=${role}`, {
    headers: { Upgrade: 'websocket', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
  });
}
async function connect(room, role, token) {
  const response = await upgrade(room, role, token);
  assert.equal(response.status, 101);
  const ws = response.webSocket;
  const messages = [];
  let closed = false;
  ws.addEventListener('message', event => messages.push(typeof event.data === 'string' ? JSON.parse(event.data) : event.data));
  ws.addEventListener('close', () => { closed = true; });
  sockets.push(ws);
  ws.accept();
  const peer = {
    ws, messages, closed: () => closed,
    async wait(test) {
      for (let n = 0; n < 200; n++) {
        const found = messages.find(test);
        if (found) return found;
        await new Promise(resolve => setTimeout(resolve, 10));
      }
      throw new Error(`Timed out waiting for relay event; closed=${closed}`);
    },
  };
  peer.channel = (await peer.wait(m => m.type === 'ready')).channel;
  return peer;
}
function frame(channel, data) {
  const payload = Buffer.from(data);
  const result = Buffer.alloc(payload.length + 4);
  result.writeUInt32BE(channel);
  payload.copy(result, 4);
  return result;
}
function payload(message) { return Buffer.from(message).subarray(4).toString(); }

try {
  assert.equal((await relay.mf.dispatchFetch(`${relay.url}/health`)).status, 200);
  assert.equal((await upgrade({ code: 'BAD' }, 'guest')).status, 404);
  const room = await create();
  assert.equal((await upgrade(room, 'guest')).status, 409, 'guest cannot enter without host');
  assert.equal((await upgrade(room, 'host', 'wrong')).status, 403, 'room code does not authorize hosting');
  const host = await connect(room, 'host', room.hostToken);
  const guests = [];
  for (let n = 0; n < 3; n++) guests.push(await connect(room, 'guest'));
  assert.equal((await upgrade(room, 'guest')).status, 423, 'four players maximum');
  for (const guest of guests) {
    await host.wait(m => m.type === 'peerJoined' && m.channel === guest.channel);
    guest.ws.send(frame(guest.channel, `input-${guest.channel}`));
    await host.wait(m => m instanceof ArrayBuffer && payload(m) === `input-${guest.channel}`);
    host.ws.send(frame(guest.channel, `private-${guest.channel}`));
    await guest.wait(m => m instanceof ArrayBuffer && payload(m) === `private-${guest.channel}`);
  }
  for (const guest of guests) {
    assert.deepEqual(guest.messages.filter(m => m instanceof ArrayBuffer).map(payload), [`private-${guest.channel}`], 'only own stream visible');
  }
  for (let n = 0; n < 20; n++) host.ws.send(frame(guests[1].channel, `ordered-${n}`));
  await guests[1].wait(m => m instanceof ArrayBuffer && payload(m) === 'ordered-19');
  assert.deepEqual(guests[1].messages.filter(m => m instanceof ArrayBuffer).map(payload).slice(1),
    Array.from({ length: 20 }, (_, n) => `ordered-${n}`), 'stream ordering preserved');
  // A separate room must not receive any of this room's traffic.
  const other = await create();
  const otherHost = await connect(other, 'host', other.hostToken);
  const otherGuest = await connect(other, 'guest');
  guests[0].ws.send(frame(guests[0].channel, 'room-isolation'));
  await host.wait(m => m instanceof ArrayBuffer && payload(m) === 'room-isolation');
  assert.equal(otherHost.messages.filter(m => m instanceof ArrayBuffer).length, 0);
  assert.equal(otherGuest.messages.filter(m => m instanceof ArrayBuffer).length, 0);

  // An authenticated guest still cannot impersonate another channel.
  guests[0].ws.send(frame(guests[1].channel, 'spoofed'));
  await host.wait(m => m.type === 'peerLeft' && m.channel === guests[0].channel);
  assert.ok(!host.messages.some(m => m instanceof ArrayBuffer && payload(m) === 'spoofed'));
  const replacement = await connect(room, 'guest');
  assert.ok(replacement.channel > guests[2].channel, 'closed stream IDs are not reused');
  host.ws.send(frame(guests[0].channel, 'stale-private-data'));
  host.ws.send(frame(replacement.channel, 'new-stream'));
  await replacement.wait(m => m instanceof ArrayBuffer && payload(m) === 'new-stream');
  assert.ok(!replacement.messages.some(m => m instanceof ArrayBuffer && payload(m) === 'stale-private-data'));
  replacement.ws.send(Buffer.alloc(32 * 1024 + 5));
  await host.wait(m => m.type === 'peerLeft' && m.channel === replacement.channel);
  host.ws.send(JSON.stringify({ type: 'disconnect', channel: guests[1].channel }));
  await host.wait(m => m.type === 'peerLeft' && m.channel === guests[1].channel);

  host.ws.close(1000, 'Host left');
  for (let n = 0; n < 200 && !guests[2].closed(); n++) await new Promise(resolve => setTimeout(resolve, 10));
  assert.ok(guests[2].closed(), 'host departure closes guests');
  assert.equal((await upgrade(room, 'guest')).status, 404, 'closed room cannot be joined');
  assert.equal((await upgrade(room, 'host', room.hostToken)).status, 404, 'old token cannot reopen a room');
  // A host whose connection drops keeps the room: guests are sent back to reconnect, the token lets the host in again.
  const dropRoom = await create();
  const dropHost = await connect(dropRoom, 'host', dropRoom.hostToken);
  const dropGuest = await connect(dropRoom, 'guest');
  await dropHost.wait(m => m.type === 'peerJoined' && m.channel === dropGuest.channel);
  dropHost.ws.close(4000, 'Network lost');
  // Miniflare takes ~10 s to finish a close with a non-1000 code; a real drop has no close handshake at all.
  for (let n = 0; n < 1500 && !dropGuest.closed(); n++) await new Promise(resolve => setTimeout(resolve, 10));
  assert.ok(dropGuest.closed(), 'guests reconnect after a host drop');
  assert.equal((await upgrade(dropRoom, 'guest')).status, 409, 'guests wait while the host is away');
  const back = await connect(dropRoom, 'host', dropRoom.hostToken);
  const rejoined = await connect(dropRoom, 'guest');
  await back.wait(m => m.type === 'peerJoined' && m.channel === rejoined.channel);
  assert.ok(rejoined.channel > dropGuest.channel, 'a rejoining guest gets a fresh stream');
  // A host back before the edge saw the old connection die replaces it; that guest's stream restarts too.
  const replacing = await connect(dropRoom, 'host', dropRoom.hostToken);
  for (let n = 0; n < 1500 && !(back.closed() && rejoined.closed()); n++) await new Promise(resolve => setTimeout(resolve, 10));
  assert.ok(back.closed() && rejoined.closed(), 'the stale host and its guests are closed');
  assert.equal((await upgrade(dropRoom, 'guest')).status, 101, 'the room stays open with the new host');
  replacing.ws.close(1000, 'Host left');

  let limited = false;
  for (let n = 0; n < 40; n++) {
    const response = await upgrade({ code: 'ZZZZZZZZ' }, 'guest');
    if (response.status === 429) { limited = true; break; }
  }
  assert.ok(limited, 'connection attempts are rate limited before allocating more objects');
  console.log('OK: real Worker/SQLite DO; host authentication, four seats, private ordered channels, room isolation, spoof/size rejection, host drop and reconnection, and cleanup');
} finally {
  clearTimeout(deadline);
  sockets.forEach(ws => { try { ws.close(); } catch { /* already closed */ } });
  await relay.close();
}
