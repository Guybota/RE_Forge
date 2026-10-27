// Deck tools ported from Central, fed by real Forge deck previews: bracket, Commander check, roles, groups,
// compare, combo cuts and game plans. Run with: npm run engine:smoke-decktools   (after npm run engine:build)
import { spawn } from 'node:child_process';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { deckFromLines, visualFromCatalog } from '../ui/src/deckTools/cardVisual.ts';
import { estimateBracket } from '../ui/src/deckTools/bracket.ts';
import { checkCommanderDeck } from '../ui/src/deckTools/commander-check.ts';
import { readDeckRoles } from '../ui/src/deckTools/deck-roles.ts';
import { groupDeckCards } from '../ui/src/deckTools/card-groups.ts';
import { compareDecks } from '../ui/src/deckTools/compare.ts';
import { rankComboCuts } from '../ui/src/deckTools/combo-cuts.ts';
import { buildGamePlans, readDeck } from '../ui/src/deckTools/improve-plans.ts';
import { tagOf } from '../ui/src/deckTools/card-tags.ts';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const data = mkdtempSync(path.join(os.tmpdir(), 'reforge-decktools-'));
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
  run(Number(m[1])).catch((err) => fail(err.stack ?? err.message));
});

async function run(port) {
  const ws = new WebSocket(`ws://127.0.0.1:${port}`);
  const waiting = new Map();
  ws.onmessage = (event) => {
    const msg = JSON.parse(event.data);
    if (msg.type === 'error') fail(`engine error: ${msg.message}`);
    if (msg.requestId && waiting.has(msg.requestId)) { waiting.get(msg.requestId)(msg); waiting.delete(msg.requestId); }
  };
  await new Promise((resolve) => { ws.onopen = resolve; });
  let id = 0;
  const preview = (text, name) => new Promise((resolve) => {
    const requestId = `r${++id}`;
    waiting.set(requestId, resolve);
    ws.send(JSON.stringify({ type: 'previewDeck', requestId, text, name }));
  });
  const tools = async (text, name) => {
    const p = await preview(text, name);
    return deckFromLines(name, p.lines, p.identity);
  };

  // A real precon-sized list: Forge's shapes must reach the tools.
  const rohan = await tools(readFileSync(path.join(root, 'scripts/fixtures/riders-of-rohan-arena.txt'), 'utf8'), 'Rohan');
  const get = (n) => rohan.visuals.get(n);
  assert.equal(rohan.deck.commanders[0].name, 'Éowyn, Shieldmaiden');
  assert.deepEqual(rohan.deck.colorIdentity, ['W', 'U', 'R']);
  assert.match(get('Arcane Signet').oracleText, /Add one mana of any color in your commander's color identity/);
  assert.equal(get('Arcane Signet').manaCost, '{2}');
  assert.match(get('Banishing Light').manaCost, /^\{2\}\{W\}$/);
  assert.equal(get('Arcane Signet').commanderLegality, 'legal');
  const check = checkCommanderDeck(rohan.deck, get);
  assert.equal(check.size, 100, 'commander + 99');
  assert.ok(check.ok, `real list passes the Commander check: ${JSON.stringify(check.issues)}`);
  const roles = readDeckRoles(rohan.deck, get);
  const role = (k) => roles.roles.find((r) => r.key === k).count;
  assert.ok(role('lands') >= 30 && role('lands') <= 40, `lands counted from Forge types: ${role('lands')}`);
  assert.ok(role('ramp') >= 3, `ramp read from English rules text: ${role('ramp')}`);
  assert.ok(role('removal') >= 2, `removal: ${role('removal')}`);
  assert.equal(roles.loaded, roles.total, 'every card has text or a basic name');
  const groups = groupDeckCards(rohan.deck.cards, get, rohan.deck.commanders);
  assert.ok(groups.some((g) => g.cards.some((c) => c.name === 'Arcane Signet')), 'grouped by Forge type line');
  assert.ok(buildGamePlans(rohan.deck).plans.length > 0, 'game plans from a real list');
  assert.ok(readDeck(rohan.deck), 'deck reading');
  assert.ok(tagOf('Arcane Signet'), 'bundled card tags');

  // Bracket triggers, illegal cards, identity, singleton and sideboard from a crafted list.
  const crafted = await tools([
    'Commander', '1 Éowyn, Shieldmaiden', '', 'Deck', '1 Sol Ring', '1 Rhystic Study', '1 Armageddon',
    '2 Arcane Signet', '1 Llanowar Elves', '1 Channel', '10 Plains', '', 'Sideboard', '1 Swords to Plowshares',
  ].join('\n'), 'Crafted');
  const cget = (n) => crafted.visuals.get(n);
  assert.deepEqual(crafted.deck.sideboard.map((c) => c.name), ['Swords to Plowshares'], 'sideboard kept out of the 99');
  const bracket = estimateBracket(crafted.deck);
  assert.ok(bracket.gameChangers.includes('Rhystic Study'), 'game changer');
  assert.ok(bracket.fastMana.includes('Sol Ring'), 'fast mana');
  assert.ok(bracket.massLandDenial.includes('Armageddon'), 'mass land denial');
  assert.equal(bracket.bracket, 4);
  const cc = checkCommanderDeck(crafted.deck, cget);
  const kinds = new Set(cc.issues.map((i) => i.kind));
  assert.equal(cget('Channel').commanderLegality, 'banned', "Forge's Commander ban list");
  assert.ok(kinds.has('banned') && kinds.has('color-identity') && kinds.has('singleton') && kinds.has('deck-size'),
    `issues: ${[...kinds]}`);
  assert.ok(cc.issues.find((i) => i.kind === 'color-identity').names.includes('Llanowar Elves'));

  // Compare and combo cuts across the two lists.
  const diff = compareDecks(rohan.deck, crafted.deck);
  assert.ok(diff.rows.some((r) => r.kind === 'qtyDiff' && r.name === 'Arcane Signet' && r.delta === 1));
  assert.ok(diff.rows.some((r) => r.kind === 'onlyA' && r.name === 'Banishing Light'));
  assert.ok(diff.rows.some((r) => r.kind === 'onlyB' && r.name === 'Rhystic Study'));
  const cuts = rankComboCuts(rohan.deck, get, []);
  assert.ok(cuts.length > 0 && cuts.every((c) => c.name !== 'Éowyn, Shieldmaiden'), 'cuts never the commander');

  // A catalog search result has the same fields as a deck line.
  const search = await new Promise((resolve) => {
    waiting.set(-1, resolve);
    ws.onmessage = (event) => { const msg = JSON.parse(event.data); if (msg.type === 'cardResults') resolve(msg); };
    ws.send(JSON.stringify({ type: 'searchCards', query: 'rhystic study' }));
  });
  assert.match(visualFromCatalog(search.cards[0]).oracleText, /Whenever an opponent casts a spell/);

  clearTimeout(timeout);
  engine.kill();
  console.log('OK deck tools: real lists, bracket, Commander check, roles, groups, compare, cuts, plans');
  process.exit(0);
}
