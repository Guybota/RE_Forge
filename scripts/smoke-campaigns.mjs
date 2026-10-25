// Native Quest campaign and integrated Adventure over the real production protocol.
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { mkdtempSync, mkdirSync, symlinkSync, writeFileSync, readFileSync, existsSync } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const data = mkdtempSync(path.join(os.tmpdir(), 'reforge-campaigns-'));
const assets = path.join(data, 'assets');
mkdirSync(assets);
symlinkSync(path.join(root, 'forge/forge-gui/res'), path.join(assets, 'res'), process.platform === 'win32' ? 'junction' : 'dir');
writeFileSync(path.join(data, 'reforge.properties'), 'language=en-US\nskin=mesa\n');
const java = process.env.JAVA_HOME ? path.join(process.env.JAVA_HOME, 'bin/java') : 'java';
let child, ws;
const deadline = setTimeout(() => { child?.kill(); console.error('FAIL: campaigns timed out'); process.exit(1); }, 240_000);
async function boot() {
  child = spawn(java, ['-jar', path.join(root, 'engine/target/re-forge-engine.jar'), '--assets', assets, '--data', data, '--port', '0', '--exit-with-parent']);
  let output = '';
  const port = await new Promise((resolve, reject) => {
    child.on('error', reject); child.on('exit', code => reject(new Error(`Engine exited ${code}: ${output.slice(-6000)}`)));
    const append = chunk => { output = (output + chunk).slice(-16000); const ready = output.match(/^READY (\d+)\r?\n/m); if (ready) resolve(Number(ready[1])); };
    child.stdout.on('data', append); child.stderr.on('data', append);
  });
  ws = new WebSocket(`ws://127.0.0.1:${port}`);
  const messages = [];
  ws.onmessage = event => {
    const m = JSON.parse(event.data); messages.push(m);
    if (m.type === 'choice') {
      const n = m.options?.length ?? 0;
      const answer = m.kind === 'text' ? { value: m.initial ?? '' } : m.kind === 'amounts' ? { amounts: m.initialAmounts } : { picked: Array.from({ length: m.kind === 'arrange' ? n : Math.min(n, m.min ?? 0) }, (_, i) => i) };
      ws.send(JSON.stringify({ type: 'answer', id: m.id, ...answer }));
    }
  };
  await new Promise((resolve, reject) => { ws.onopen = resolve; ws.onerror = reject; });
  const peer = {
    messages,
    async wait(predicate, since = 0, timeout = 30000) {
      const end = Date.now() + timeout;
      while (Date.now() < end) {
        const slice = messages.slice(since), error = slice.find(m => m.type === 'error');
        if (error) throw new Error(`${error.message}\n${output.slice(-5000)}`);
        const found = slice.find(predicate); if (found) return found;
        await new Promise(resolve => setTimeout(resolve, 30));
      }
      throw new Error(`No reply: ${predicate}\n${output.slice(-5000)}\n${JSON.stringify(messages.slice(-3)).slice(-3000)}`);
    },
    async request(message, type = 'campaign') { const since = messages.length; ws.send(JSON.stringify(message)); return peer.wait(m => m.type === type, since); },
    async invalid(message) {
      const since = messages.length; ws.send(JSON.stringify(message));
      const end = Date.now() + 10000;
      while (Date.now() < end) {
        const e = messages.slice(since).find(m => m.type === 'error');
        if (e) { messages.splice(messages.indexOf(e), 1); return e; }
        await new Promise(resolve => setTimeout(resolve, 30));
      }
      throw new Error('Invalid campaign input was accepted');
    },
  };
  return peer;
}
async function stop() { ws?.close(); if (child?.exitCode === null && child.signalCode === null) { const exited = once(child, 'exit'); child.stdin.end(); await exited; } }
const cmd = (action, rest = {}) => ({ type: 'campaign', action, ...rest });
try {
  let peer = await boot();
  const quests = await peer.request(cmd('list', { mode: 'quest' }), 'campaigns');
  assert.ok(quests.starters.length > 0);
  let quest = await peer.request(cmd('create', { mode: 'quest', name: 'Quest smoke', difficulty: 0, starter: quests.starters.find(s => s.id === 'Air Forces')?.id ?? quests.starters[0].id }));
  assert.ok(quest.duels.length > 0 && quest.cards.reduce((n, c) => n + c.qty, 0) >= 40);
  const questId = quest.id;
  await peer.invalid(cmd('deck', { entries: [] }));
  const cheapest = [...quest.shop].sort((a, b) => a.price - b.price).find(c => c.price <= quest.credits);
  if (cheapest) {
    const before = quest.credits;
    quest = await peer.request(cmd('buy', { key: cheapest.key }));
    assert.equal(quest.credits, before - cheapest.price);
  }
  await peer.invalid(cmd('buy', { key: 'missing' }));
  let since = peer.messages.length;
  ws.send(JSON.stringify(cmd('duel', { target: quest.duels[0].id })));
  await peer.wait(m => m.type === 'state' && (m.prompt.ok.enabled || m.prompt.cancel.enabled), since, 60000);
  ws.send(JSON.stringify({ type: 'action', action: 'concede' }));
  quest = await peer.wait(m => m.type === 'campaign' && m.losses === 1, since);
  await peer.request(cmd('close'), 'campaignClosed');
  quest = await peer.request(cmd('open', { id: questId }));
  assert.equal(quest.losses, 1, 'Quest result persists exactly once');
  await peer.request(cmd('close'), 'campaignClosed');
  console.log('Quest: native starter, duels, owned-card validation, shop, real concession and persistent native result OK');

  const adventures = await peer.request(cmd('list', { mode: 'adventure' }), 'campaigns');
  assert.ok(adventures.heroes.length >= 10 && adventures.heroes.every(h => h.portraits.male?.frames.length && h.portraits.female?.frames.length));
  await peer.invalid(cmd('create', { mode: 'adventure', name: 'Bad hero', difficulty: 0, starter: 'G', hero: 'Nobody', sex: 'male' }));
  let adventure = await peer.request(cmd('create', { mode: 'adventure', name: 'Adventure smoke', difficulty: 0, starter: 'G', hero: 'Elf', sex: 'female' }));
  assert.match(adventure.player, /elf_f\.atlas#/);
  const adventureId = adventure.id;
  assert.equal(adventure.life, 16); assert.equal(adventure.gold, 500);
  await peer.invalid(cmd('enter', { region: '../outside' }));
  const world = adventure.world, land = (x, y) => world.cells[Math.floor(y / world.tiles) * world.size + Math.floor(x / world.tiles)] !== '0';
  assert.equal(world.cells.length, world.size ** 2); assert.ok(land(adventure.x, adventure.y));
  for (const biome of world.biomes) assert.ok(biome.tiles?.frames[0][2] === 48 && biome.terrain.every(t => t.tiles), `${biome.name} has Forge autotiles`);
  assert.ok(world.biomes.some(b => b.decorations.length > 0));
  assert.equal((await fetch(adventure.assetBase + encodeURIComponent(world.biomes[1].tiles.image))).status, 200);
  for (const kind of ['town', 'dungeon', 'enemy']) assert.ok(adventure.objects.some(o => o.kind === kind && adventure.sprites[o.sprite]?.frames.length), `world has ${kind} with a Forge sprite`);
  const hero = adventure.sprites[adventure.player];
  assert.ok(hero.frames.every(f => f.length === 4 && f[2] > 0 && f[3] > 0));
  assert.equal((await fetch(adventure.assetBase + encodeURIComponent(hero.image))).status, 200);
  const distant = adventure.objects.find(o => Math.max(Math.abs(o.x - adventure.x), Math.abs(o.y - adventure.y)) > world.tiles);
  await peer.invalid(cmd('interact', { target: distant.id }));
  await peer.invalid(cmd('duel', { target: adventure.objects.find(o => o.kind === 'enemy').id }));
  for (const [dx, dy] of [[1, 0], [0, 1], [-1, 0], [0, -1]]) {
    const before = [adventure.x, adventure.y];
    adventure = await peer.request(cmd('move', { dx, dy }));
    assert.ok(land(adventure.x, adventure.y) && Math.abs(adventure.x - before[0]) + Math.abs(adventure.y - before[1]) <= 1);
  }
  for (const region of ['rat', 'spider', 'snake']) {
    if (adventure.map) adventure = await peer.request(cmd('leave'));
    adventure = await peer.request(cmd('enter', { region }));
    assert.ok(adventure.map.tilesets.length > 0 && adventure.map.layers.some(l => l.gids.some(g => g !== 0)));
    assert.ok(adventure.objects.some(o => o.kind === 'enemy'));
  }
  const texture = await fetch(adventure.assetBase + encodeURIComponent(adventure.map.tilesets[0].image));
  assert.equal(texture.status, 200); assert.match(texture.headers.get('content-type'), /image/);
  const denied = await fetch(adventure.assetBase + encodeURIComponent('../../languages/en-US.properties'));
  assert.equal(denied.status, 404);
  await peer.invalid(cmd('move', { dx: 2, dy: 0 }));
  const far = adventure.objects.find(o => o.kind === 'enemy' && Math.hypot(o.x - adventure.x, o.y - adventure.y) > 30);
  if (far) await peer.invalid(cmd('duel', { target: far.id }));
  adventure = await peer.request(cmd('move', { dx: 0, dy: -1 }));
  const position = [adventure.region, adventure.x, adventure.y];
  await stop(); peer = await boot();
  adventure = await peer.request(cmd('open', { id: adventureId }));
  assert.deepEqual([adventure.region, adventure.x, adventure.y], position);
  adventure = await peer.request(cmd('leave'));
  assert.deepEqual(adventure.world, world, 'Seeded world is identical after restart');
  quest = await peer.request(cmd('open', { id: questId }));
  assert.equal(quest.losses, 1, 'Native Quest save survives JVM restart without duplicate result');
  assert.ok(readFileSync(path.join(assets, 'forge.profile.properties'), 'utf8').includes('reforge-campaigns-'));
  assert.ok(existsSync(path.join(data, 'user/reforge-campaigns', `${questId}.json`)));
  assert.ok(existsSync(path.join(data, 'user/reforge-campaigns', `${adventureId}.json`)));
  console.log('Adventure: seeded Shandalar world, original maps/tilesets, safe textures, movement validation, proximity guard and position across restart OK');
  await peer.invalid(cmd('delete', { id: questId }));
  await peer.request(cmd('close'), 'campaignClosed');
  const questSave = path.join(data, 'user/quest/saves', `reforge-${questId}.dat`);
  assert.ok(existsSync(questSave), `native Quest save at ${questSave}`);
  let remaining = await peer.request(cmd('delete', { id: questId }), 'campaigns');
  assert.ok(!remaining.campaigns.some(c => c.id === questId) && !existsSync(questSave) && !existsSync(questSave + '.bak'));
  remaining = await peer.request(cmd('delete', { id: adventureId }), 'campaigns');
  assert.ok(!remaining.campaigns.some(c => c.id === adventureId) && !existsSync(path.join(data, 'user/reforge-campaigns', `${adventureId}.json`)));
  console.log('Campaigns: hero choice, open campaign guarded, Quest native save and Adventure deleted OK');
  console.log(`OK: campaigns; temporary data ${data}`);
} catch (error) { console.error('FAIL:', error); process.exitCode = 1; }
finally { clearTimeout(deadline); await stop(); }
