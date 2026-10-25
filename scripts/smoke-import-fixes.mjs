// Import helpers: commanders from MTGO sideboards and by choice, suggestions for misspelt cards, deck links.
// Uses a throw-away data folder in Portuguese. Links need the network (Archidekt and Moxfield); SMOKE_OFFLINE=1
// skips them. Run with: npm run engine:smoke-import-fixes   (after npm run engine:build)
import { spawn } from 'node:child_process';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const data = mkdtempSync(path.join(os.tmpdir(), 'reforge-import-fixes-'));
writeFileSync(path.join(data, 'reforge.properties'), 'language=pt-BR\nskin=mesa\n');
const java = process.env.JAVA_HOME ? path.join(process.env.JAVA_HOME, 'bin', 'java') : 'java';
const engine = spawn(java, ['-jar', path.join(root, 'engine/target/re-forge-engine.jar'), '--port', '0',
  '--assets', path.join(root, 'forge/forge-gui'), '--data', data, '--exit-with-parent']);

const timeout = setTimeout(() => fail('timed out'), 180_000);
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
    // An error answers whoever expects one, or fails the run.
    const i = waiting.findIndex((w) => w.type === msg.type || msg.type === 'error' && w.allowError);
    if (i >= 0) waiting.splice(i, 1)[0].resolve(msg);
    else if (msg.type === 'error') fail(`engine error: ${msg.message}`);
  };
  await new Promise((resolve) => { ws.onopen = resolve; });
  const ask = (message, type, allowError = false) =>
    new Promise((resolve) => { waiting.push({ type, resolve, allowError }); ws.send(JSON.stringify(message)); });
  const preview = (text) => ask({ type: 'previewDeck', text }, 'deckPreview');
  const choose = async (text, name) => (await ask({ type: 'chooseCommander', text, name }, 'deckText')).text;

  // MTGO puts the commanders in the sideboard; Forge moves one, we also move a partner pair.
  const body = ['1 Sol Ring', '1 Arcane Signet', '1 Swords to Plowshares', '1 Brainstorm', '30 Plains', '30 Island'].join('\n');
  const mtgo = await preview(`${body}\n\n1 Tymna the Weaver\n1 Thrasios, Triton Hero\n`);
  assert.deepEqual([...mtgo.commanders].sort(), ['Thrasios, Triton Hero', 'Tymna the Weaver'], 'sideboard partners lead');
  assert.equal(mtgo.identity, 1 | 2 | 4 | 16, 'combined identity');
  const single = await preview(`1 Krenko, Mob Boss\n${body}\n\n1 Atraxa, Praetors' Voice\n`);
  assert.deepEqual(single.commanders, ["Atraxa, Praetors' Voice"], 'last block leads even with other legends');
  const labelled = await preview(`Deck\n${body}\n\nSideboard\n1 Tymna the Weaver\n1 Thrasios, Triton Hero\n`);
  assert.equal(labelled.commanders.length, 2, 'labelled sideboard partners lead');

  // Several legendary candidates inside the deck: Forge only warns; the player picks one. (Legends on top of a
  // list without sections are Forge's commanders.)
  const loose = `${body}\n1 Atraxa, Praetors' Voice\n1 Krenko, Mob Boss\n`;
  assert.deepEqual((await preview(loose)).commanders, [], 'no guess between candidates');
  const atraxa = await choose(loose, "Atraxa, Praetors' Voice");
  assert.match(atraxa, /^Commander\n1 Atraxa, Praetors' Voice\n\nDeck\n/, 'chosen commander on top, no printing added');
  const chosen = await preview(atraxa);
  assert.deepEqual(chosen.commanders, ["Atraxa, Praetors' Voice"]);
  assert.equal(chosen.cards, 66, 'no card lost or duplicated');

  // Another commander replaces it and Atraxa goes back to the deck; a partner joins instead.
  const krenkoText = await choose(atraxa, 'Krenko, Mob Boss');
  assert.equal(krenkoText.match(/^Deck$/gm).length, 1, 'one Deck header after rewriting twice');
  const krenko = await preview(krenkoText);
  assert.deepEqual(krenko.commanders, ['Krenko, Mob Boss']);
  assert.ok(krenko.lines.some((l) => l.nameEn === "Atraxa, Praetors' Voice" && l.group !== 'commander'), 'old commander kept in the deck');
  assert.equal(krenko.cards, 66);
  const tymna = await choose(`1 Tymna the Weaver\n1 Thrasios, Triton Hero\n1 Kraum, Ludevic's Opus\n${body}\n`, 'Tymna the Weaver');
  const pair = await preview(await choose(tymna, 'Thrasios, Triton Hero'));
  assert.deepEqual([...pair.commanders].sort(), ['Thrasios, Triton Hero', 'Tymna the Weaver'], 'partner joins');
  const swapped = await preview(await choose(await choose(tymna, 'Thrasios, Triton Hero'), 'Kraum, Ludevic\'s Opus'));
  assert.equal(swapped.commanders.length, 1, 'a third partner replaces the pair');

  // Misspelt, partial and translated names get suggestions.
  const started = Date.now();
  const typos = await preview('1 Lightnig Bolt\n1 Swords to Plowshare\n1 Espadas em Arado\n1 Atraxa\n1 Qwxzv Plmk\n');
  if (process.env.SMOKE_DEBUG) console.log(JSON.stringify(typos.lines.map(({ text, status, requested, suggestions }) => ({ text, status, requested, suggestions }))));
  const suggestions = (requested) => typos.lines.find((l) => l.requested === requested)?.suggestions.map((s) => s.nameEn) ?? [];
  assert.equal(suggestions('Lightnig Bolt')[0], 'Lightning Bolt', 'typo');
  assert.equal(suggestions('Swords to Plowshare')[0], 'Swords to Plowshares', 'missing letter');
  assert.equal(suggestions('Espadas em Arado')[0], 'Swords to Plowshares', 'Portuguese name');
  assert.ok(suggestions('Atraxa').length && suggestions('Atraxa').every((n) => n.startsWith('Atraxa')), 'partial name');
  assert.deepEqual(suggestions('Qwxzv Plmk'), [], 'nonsense has no suggestion');
  const suggestionTime = Date.now() - started;

  // Links: anything but Archidekt and Moxfield is refused before any request.
  const refused = await ask({ type: 'fetchDeck', url: 'http://127.0.0.1:7777/decks/1' }, 'deckText', true);
  assert.equal(refused.code, 'linkUnsupported', 'other hosts refused');
  let linked = 'skipped (SMOKE_OFFLINE)';
  if (!process.env.SMOKE_OFFLINE) {
    const archidekt = await ask({ type: 'fetchDeck', url: 'https://archidekt.com/decks/2000000/yuriko' }, 'deckText', true);
    assert.equal(archidekt.type, 'deckText', `Archidekt: ${archidekt.message}`);
    const a = await preview(archidekt.text);
    assert.ok(a.commanders.includes("Yuriko, the Tiger's Shadow") && a.cards >= 90, 'Archidekt deck with its commander');
    assert.equal(a.unknown, 0, 'every Archidekt card recognised');
    const moxfield = await ask({ type: 'fetchDeck', url: 'https://moxfield.com/decks/j-0aJlxuOUm9FnKRvJcfZw' }, 'deckText', true);
    assert.equal(moxfield.type, 'deckText', `Moxfield: ${moxfield.message}`);
    const m = await preview(moxfield.text);
    if (process.env.SMOKE_DEBUG) console.log(m.lines.filter((l) => l.status !== 'ok').map((l) => `${l.status}: ${l.text} ${l.message ?? ''}`).join('\n'));
    assert.ok(m.commanders.length >= 1 && m.cards >= 90, 'Moxfield deck with its commander');
    assert.equal(m.unknown, 0, 'promo and flavour-name printings fall back to the card');
    const missing = await ask({ type: 'fetchDeck', url: 'https://archidekt.com/decks/3000000' }, 'deckText', true);
    assert.equal(missing.code, 'linkNotFound', 'missing deck');
    linked = `Archidekt "${archidekt.name}" ${a.cards} cards (${a.unknown} unknown), Moxfield "${moxfield.name}" ${m.cards} cards (${m.unknown} unknown)`;
  }

  clearTimeout(timeout);
  console.log(`OK: sideboard partners, chosen/replaced/partnered commanders, suggestions (${suggestionTime} ms for 5 unknown lines), links: ${linked}`);
  ws.close();
  engine.kill();
}
