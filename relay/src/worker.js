import { DurableObject } from 'cloudflare:workers';

// The relay never decodes Forge events. Each guest has its own byte stream to the host.
const ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const CODE = /^[A-HJ-NP-Z2-9]{8}$/;
const MAX_FRAME = 32 * 1024 + 4;
const MAX_ROOM_AGE = 24 * 60 * 60 * 1000;
// A host whose connection drops (not a deliberate leave) keeps the room this long to reconnect.
const HOST_GRACE = 3 * 60 * 1000;
// The close a host sends when it really leaves; anything else counts as a dropped connection.
const HOST_LEFT = 'Host left';
const json = (body, status = 200) => Response.json(body, {
  status, headers: { 'Cache-Control': 'no-store' },
});

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (request.method === 'GET' && url.pathname === '/health') return json({ service: 'reforge-relay', version: 1 });
    if (env.CONNECT_LIMIT) {
      const { success } = await env.CONNECT_LIMIT.limit({ key: request.headers.get('CF-Connecting-IP') || 'local' });
      if (!success) return json({ error: 'Too many connection attempts. Try again shortly.' }, 429);
    }
    if (request.method === 'POST' && url.pathname === '/rooms') {
      // Codes contain 40 random bits; a separate secret authorizes the host connection.
      for (let attempt = 0; attempt < 3; attempt++) {
        const code = Array.from(crypto.getRandomValues(new Uint8Array(8)), b => ALPHABET[b & 31]).join('');
        const token = Array.from(crypto.getRandomValues(new Uint8Array(32)), b => b.toString(16).padStart(2, '0')).join('');
        const room = env.ROOMS.getByName(code);
        const result = await room.fetch(new Request('https://room/create', {
          method: 'POST', body: JSON.stringify({ token }),
        }));
        if (result.ok) return json({ code, hostToken: token }, 201);
      }
      return json({ error: 'Could not create a room' }, 503);
    }
    const match = url.pathname.match(/^\/rooms\/([^/]+)$/);
    if (!match || !CODE.test(match[1]) || request.method !== 'GET') return json({ error: 'Room not found' }, 404);
    if (request.headers.get('Upgrade')?.toLowerCase() !== 'websocket') return json({ error: 'WebSocket required' }, 426);
    return env.ROOMS.getByName(match[1]).fetch(request);
  },
};

export class RelayRoom extends DurableObject {
  async fetch(request) {
    const url = new URL(request.url);
    if (url.pathname === '/create' && request.method === 'POST') {
      if (await this.ctx.storage.get('room')) return json({ error: 'Room already exists' }, 409);
      const { token } = await request.json();
      await this.ctx.storage.put('room', { token, nextChannel: 1, expires: Date.now() + MAX_ROOM_AGE });
      // Remove abandoned rooms too. No interval prevents WebSocket hibernation.
      await this.ctx.storage.setAlarm(Date.now() + MAX_ROOM_AGE);
      return json({ ok: true }, 201);
    }
    const room = await this.ctx.storage.get('room');
    if (!room || room.closed || Date.now() >= room.expires) return json({ error: 'Room not found or expired' }, 404);
    const role = url.searchParams.get('role');
    const sockets = this.ctx.getWebSockets().filter(ws => ws.readyState === 1);
    const host = sockets.find(ws => ws.deserializeAttachment().role === 'host');
    if (role === 'host') {
      if (request.headers.get('Authorization') !== `Bearer ${room.token}`) return json({ error: 'Invalid host token' }, 403);
      // A reconnecting host may arrive before the edge noticed its old connection died: the token wins.
      if (host) { host.serializeAttachment({ ...host.deserializeAttachment(), replaced: true }); try { host.close(1000, 'Replaced'); } catch { /* already closed */ } }
      // Guests still on streams from before the drop can't be resumed: they reconnect through Forge.
      for (const guest of sockets) {
        if (guest.deserializeAttachment().role === 'guest') try { guest.close(1001, 'Host reconnecting'); } catch { /* already closed */ }
      }
      if (room.hostAway) { delete room.hostAway; await this.scheduleAlarm(room); }
    } else if (role === 'guest') {
      if (!host) return json({ error: 'Host is not connected' }, 409);
      if (sockets.filter(ws => ws.deserializeAttachment().role === 'guest').length >= 3) return json({ error: 'Room is full' }, 423);
    } else return json({ error: 'Invalid role' }, 400);

    const channel = role === 'host' ? 0 : room.nextChannel++;
    // Persist IDs before accepting a connection, including across hibernation. Never reuse an old stream ID.
    await this.ctx.storage.put('room', room);
    const [client, server] = Object.values(new WebSocketPair());
    server.serializeAttachment({ role, channel });
    this.ctx.acceptWebSocket(server);
    server.send(JSON.stringify({ type: 'ready', channel }));
    if (role === 'guest') host.send(JSON.stringify({ type: 'peerJoined', channel }));
    return new Response(null, { status: 101, webSocket: client });
  }

  webSocketMessage(ws, message) {
    const sender = ws.deserializeAttachment();
    const sockets = this.ctx.getWebSockets().filter(s => s.readyState === 1);
    if (typeof message === 'string') {
      // Only the host may close an individual guest stream (e.g. Forge rejected its login).
      if (message.length > 256 || sender.role !== 'host') return this.reject(ws);
      let control;
      try { control = JSON.parse(message); } catch { return this.reject(ws); }
      if (control.type !== 'disconnect' || !Number.isSafeInteger(control.channel)) return this.reject(ws);
      const guest = sockets.find(s => s.deserializeAttachment().channel === control.channel && s !== ws);
      if (guest) guest.close(1000, 'Game connection closed');
      return;
    }
    if (!(message instanceof ArrayBuffer) || message.byteLength <= 4 || message.byteLength > MAX_FRAME) return this.reject(ws);
    const channel = new DataView(message).getUint32(0);
    if (sender.role === 'guest' && channel !== sender.channel) return this.reject(ws);
    const target = sockets.find(s => {
      const peer = s.deserializeAttachment();
      return sender.role === 'host' ? peer.role === 'guest' && peer.channel === channel : peer.role === 'host';
    });
    // A late frame after a guest left must not reach a different guest.
    if (target) target.send(message);
  }

  reject(ws) { ws.close(1008, 'Invalid relay frame'); }

  async webSocketClose(ws, code, reason) {
    const sender = ws.deserializeAttachment();
    try { ws.close(1000, 'Connection closed'); } catch { /* already closed */ }
    if (sender.role === 'host') {
      if (sender.replaced) return; // a reconnected host took its place
      const room = await this.ctx.storage.get('room');
      if (room && code === 1000 && reason === HOST_LEFT) room.closed = true;
      else if (room) room.hostAway = Date.now();
      if (room) { await this.ctx.storage.put('room', room); await this.scheduleAlarm(room); }
      // Guests reconnect through Forge once the host is back; their old streams can't be resumed byte by byte.
      for (const peer of this.ctx.getWebSockets()) {
        if (peer === ws) continue;
        try { peer.close(1001, room?.closed ? 'Host disconnected' : 'Host reconnecting'); } catch { /* already closed */ }
      }
    } else {
      for (const peer of this.ctx.getWebSockets()) {
        if (peer.readyState === 1 && peer.deserializeAttachment().role === 'host') {
          peer.send(JSON.stringify({ type: 'peerLeft', channel: sender.channel }));
        }
      }
    }
  }

  async webSocketError(ws) { await this.webSocketClose(ws, 1006, ''); }

  /** One alarm: the room's 24 h expiry, or the end of a dropped host's grace period if that comes first. */
  async scheduleAlarm(room) {
    await this.ctx.storage.setAlarm(room.hostAway ? Math.min(room.expires, room.hostAway + HOST_GRACE) : room.expires);
  }

  async alarm() {
    const room = await this.ctx.storage.get('room');
    const now = Date.now();
    const hostBack = this.ctx.getWebSockets().some(ws => ws.readyState === 1 && ws.deserializeAttachment().role === 'host');
    const graceOver = room?.hostAway && !hostBack && now >= room.hostAway + HOST_GRACE;
    if (room && now < room.expires && !graceOver && !room.closed) return this.scheduleAlarm(room);
    for (const ws of this.ctx.getWebSockets()) {
      try { ws.close(1001, 'Room expired'); } catch { /* already closed */ }
    }
    await this.ctx.storage.deleteAll();
  }
}
