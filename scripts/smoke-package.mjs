// Test the shipped JRE, jar and assets, without using Java on PATH or the owner's data.
// npm run package:smoke -- [path/to/resources]
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { existsSync, mkdtempSync, readFileSync, readdirSync, statSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const resources = path.resolve(process.argv[2] ?? path.join(root, 'dist-app/win-unpacked/resources'));
const java = path.join(resources, 'runtime/bin/java.exe');
const jar = path.join(resources, 'engine/re-forge-engine.jar');
const assets = path.join(resources, 'forge-gui');
const data = mkdtempSync(path.join(os.tmpdir(), 'reforge-package-'));
const verifyImages = process.env.SMOKE_PACKAGE_IMAGES === '1';
for (const file of [java, jar, path.join(assets, 'res/editions'), path.join(resources, 'ui/index.html')]) {
  assert.ok(existsSync(file), `Missing packaged resource: ${file}`);
}
let child, socket;
const deadline = setTimeout(() => {
  console.error('FAIL: packaged smoke timed out');
  child?.kill();
  process.exit(1);
}, 180_000);

async function boot() {
  child = spawn(java, ['-jar', jar, '--assets', assets, '--data', data, '--port', '0', '--exit-with-parent'], {
    cwd: resources, windowsHide: true,
  });
  let output = '';
  const port = await new Promise((resolve, reject) => {
    child.on('error', reject);
    child.on('exit', (code) => reject(new Error(`Engine exited ${code}: ${output.slice(-4000)}`)));
    const append = (chunk) => {
      output = (output + chunk).slice(-16000);
      const ready = output.match(/^READY (\d+)$/m);
      if (ready) resolve(Number(ready[1]));
    };
    child.stdout.on('data', append);
    child.stderr.on('data', append);
  });
  socket = new WebSocket(`ws://127.0.0.1:${port}`);
  const messages = [];
  socket.onmessage = (event) => messages.push(JSON.parse(event.data));
  await new Promise((resolve, reject) => { socket.onopen = resolve; socket.onerror = reject; });
  return {
    async request(message, type) {
      const since = messages.length;
      socket.send(JSON.stringify(message));
      const end = Date.now() + 30_000;
      while (Date.now() < end) {
        const replies = messages.slice(since);
        const error = replies.find((m) => m.type === 'error');
        if (error) throw new Error(error.message);
        const reply = replies.find((m) => m.type === type);
        if (reply) return reply;
        if (child.exitCode !== null) throw new Error(`Engine exited: ${output.slice(-4000)}`);
        await new Promise((resolve) => setTimeout(resolve, 30));
      }
      throw new Error(`No ${type} for ${message.type}: ${output.slice(-4000)}`);
    },
  };
}

async function stop() {
  socket?.close();
  if (child && child.exitCode === null && child.signalCode === null) {
    const exited = once(child, 'exit');
    // Same shutdown mechanism as closing Electron's parent pipe.
    child.stdin.end();
    await exited;
  }
}

async function picture(base, key) {
  const url = new URL(base);
  url.search = new URLSearchParams({ key, format: 'full', lang: 'en-US' }).toString();
  const response = await fetch(url, { signal: AbortSignal.timeout(30_000) });
  assert.equal(response.status, 200, 'card image HTTP status');
  assert.match(response.headers.get('content-type') ?? '', /image\/jpeg/);
  const bytes = Buffer.from(await response.arrayBuffer());
  assert.equal(bytes.readUInt16BE(0), 0xffd8, 'real JPEG from the shipped runtime');
  return bytes;
}

try {
  let peer = await boot();
  let info = await peer.request({ type: 'hello' }, 'engineInfo');
  assert.ok(info.cards > 20000 && info.editions > 100);
  assert.ok(!info.language && !info.skin, 'clean data starts with first-run choices');
  await peer.request({ type: 'setLanguage', language: 'pt-BR' }, 'engineInfo');
  await peer.request({ type: 'setSkin', skin: 'editorial' }, 'engineInfo');
  const decks = await peer.request({ type: 'listDecks' }, 'decks');
  assert.ok(decks.commander.length > 0, 'packaged Commander precons');
  const result = await peer.request({ type: 'searchCards', query: 'lightning bolt' }, 'cardResults');
  const bolt = result.cards.find((c) => c.nameEn === 'Lightning Bolt');
  assert.ok(bolt);
  const image = verifyImages ? await picture(info.imageBase, bolt.imageKey) : null;
  const imageCache = path.join(data, 'cache/reforge-art');
  const cachedImages = image ? readdirSync(imageCache).filter((file) => file.endsWith('.jpg'))
    .map((file) => ({ file, modified: statSync(path.join(imageCache, file)).mtimeMs })) : [];
  if (image) assert.ok(cachedImages.length > 0, 'download persisted in the temporary cache');
  const text = readFileSync(path.join(root, 'scripts/fixtures/riders-of-rohan-arena.txt'), 'utf8');
  const name = 'Packaged runtime smoke';
  const saved = await peer.request({ type: 'saveDeck', text, name }, 'decks');
  assert.ok(saved.mine.includes(name), 'save deck using shipped resources');
  const detail = await peer.request({ type: 'getDeck', name }, 'deckDetail');
  assert.equal(detail.cards, 100);
  await stop();

  peer = await boot();
  info = await peer.request({ type: 'hello' }, 'engineInfo');
  assert.equal(info.language, 'pt-BR');
  assert.equal(info.skin, 'editorial');
  assert.ok((await peer.request({ type: 'listDecks' }, 'decks')).mine.includes(name));
  if (image) {
    assert.deepEqual(await picture(info.imageBase, bolt.imageKey), image, 'cached image survives restart');
    for (const cached of cachedImages) {
      assert.equal(statSync(path.join(imageCache, cached.file)).mtimeMs, cached.modified, 'cache is reused without rewriting');
    }
    console.log(`OK: real Scryfall image and persistent cache (${image.length} bytes)`);
  }
  const profile = readFileSync(path.join(assets, 'forge.profile.properties'), 'utf8');
  assert.ok(profile.includes('reforge-package-'), 'Forge profile points at temporary data');
  const game = await peer.request({ type: 'startMatch', deck: name, opponents: 1 }, 'state');
  assert.equal(game.players.length, 2, 'Commander match starts from the installed deck');
  assert.ok(game.players.some((p) => p.isLocal));
  console.log(`OK: shipped JRE, ${info.cards} cards, ${decks.commander.length} precons, catalog, 100-card import, settings and deck survive restart, local match starts`);
  console.log(`Temporary data: ${data}`);
} catch (error) {
  console.error('FAIL:', error);
  process.exitCode = 1;
} finally {
  clearTimeout(deadline);
  await stop();
}
