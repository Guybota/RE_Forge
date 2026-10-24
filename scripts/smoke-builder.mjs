// Deck builder catalog: search by name (any language), filters, colour identity, printings and builder fields.
// Uses a throw-away data folder in Portuguese. Run with: npm run engine:smoke-builder   (after npm run engine:build)
import { spawn } from 'node:child_process';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const data = mkdtempSync(path.join(os.tmpdir(), 'reforge-builder-'));
writeFileSync(path.join(data, 'reforge.properties'), 'language=pt-BR\nskin=mesa\n');
const java = process.env.JAVA_HOME ? path.join(process.env.JAVA_HOME, 'bin', 'java') : 'java';
const engine = spawn(java, ['-jar', path.join(root, 'engine/target/re-forge-engine.jar'), '--port', '0',
  '--assets', path.join(root, 'forge/forge-gui'), '--data', data, '--exit-with-parent']);

const timeout = setTimeout(() => fail('timed out'), 120_000);
function fail(message) {
  engine.kill();
  console.error(`FAIL: ${message}`);
  process.exit(1);
}

let out = '';
engine.stdout.on('data', (chunk) => {
  out += chunk;
  const m = out.match(/^READY (\d+)$/m);
  if (!m) return;
  engine.stdout.removeAllListeners('data');
  run(Number(m[1])).catch((err) => fail(err.message));
});

async function run(port) {
  const ws = new WebSocket(`ws://127.0.0.1:${port}`);
  const waiting = [];
  ws.onmessage = (event) => {
    const msg = JSON.parse(event.data);
    if (msg.type === 'error') fail(`engine error: ${msg.message}`);
    const i = waiting.findIndex((w) => w.type === msg.type);
    if (i >= 0) waiting.splice(i, 1)[0].resolve(msg);
  };
  await new Promise((resolve) => { ws.onopen = resolve; });
  const ask = (message, type) => new Promise((resolve) => { waiting.push({ type, resolve }); ws.send(JSON.stringify(message)); });
  const search = (q) => ask({ type: 'searchCards', ...q }, 'cardResults');
  const names = (r) => r.cards.map((c) => c.nameEn);

  // English and Portuguese names, accents ignored.
  assert.ok(names(await search({ query: 'lightning bolt' })).includes('Lightning Bolt'), 'English name');
  assert.ok(names(await search({ query: 'espadas em arados' })).includes('Swords to Plowshares'), 'Portuguese name');
  assert.equal((await search({ query: 'floresta' })).cards[0].nameEn, 'Forest', 'exact name first');
  assert.ok(!names(await search({ query: 'pass holder' })).includes('"Lifetime" Pass Holder'), 'Un-set acorn cards left out');
  const bolt = (await search({ query: 'lightning bolt' })).cards.find((c) => c.nameEn === 'Lightning Bolt');
  assert.equal(bolt.cmc, 1);
  assert.equal(bolt.group, 'instant');
  assert.ok(bolt.imageKey && bolt.set && bolt.number, 'default printing');

  // Filters: type, mana value, colour, commander identity and commanders only.
  const greenOnes = await search({ cardType: 'creature', cmc: 1, colors: 16 });
  assert.ok(greenOnes.cards.length > 0 && greenOnes.cards.every((c) => c.group === 'creature' && c.cmc === 1), 'type and cost filter');
  const monoGreen = await search({ query: 'bolt', identity: 16 });
  assert.ok(!names(monoGreen).includes('Lightning Bolt'), 'red card outside a green identity');
  const leaders = await search({ query: 'atraxa', commanders: true });
  assert.ok(leaders.cards.every((c) => c.canCommand) && names(leaders).some((n) => n.startsWith('Atraxa')), 'commanders only');
  const all = await search({});
  assert.ok(all.total > 20000 && all.cards.length === 60, `paged catalog (${all.total})`);
  const second = await search({ offset: 60 });
  assert.notEqual(second.cards[0].nameEn, all.cards[0].nameEn, 'second page');

  // Printings, and the builder fields on decklist lines (identity of the commander).
  const ring = await ask({ type: 'getPrintings', name: 'Sol Ring' }, 'printings');
  assert.ok(ring.printings.length > 5 && ring.printings.every((p) => p.set && p.imageKey), 'Sol Ring printings');
  const preview = await ask({ type: 'previewDeck', text: "Commander\n1 Atraxa, Praetors' Voice\n\nDeck\n1 Sol Ring\n" }, 'deckPreview');
  assert.equal(preview.identity, 1 | 2 | 4 | 16, 'Atraxa is WUBG');
  assert.ok(preview.lines.every((l) => l.nameEn && l.cmc !== undefined && l.set), 'lines carry builder fields');

  clearTimeout(timeout);
  console.log(`OK: catalog of ${all.total} cards, names in two languages, filters, identity, pages, printings`);
  ws.close();
  engine.kill();
}
