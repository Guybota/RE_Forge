// Deck tools ported from Central, fed by real Forge deck previews: bracket, Commander check, roles, groups,
// compare, combo cuts and game plans; tags/notes; prices, cheaper printings and combos against local stand-ins for
// Scryfall, EDHREC and Commander Spellbook (RE_FORGE_SERVICES_URL), then once against the real services unless
// SMOKE_OFFLINE=1. Run with: npm run engine:smoke-decktools   (after npm run engine:build)
import { spawn } from 'node:child_process';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { addAndCut, demoteCommander, mergeDecklists, moveCopy, promoteCommander, removeCopy, swapPrinting } from '../ui/src/deckText.ts';
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
const java = process.env.JAVA_HOME ? path.join(process.env.JAVA_HOME, 'bin', 'java') : 'java';
let engine = null;

const timeout = setTimeout(() => fail('timed out'), 240_000);
function fail(message) {
  engine?.kill();
  console.error(`FAIL: ${message}`);
  process.exit(1);
}

/** A fresh engine with a throw-away data folder; resolves with its port. */
function startEngine(env = {}) {
  const data = mkdtempSync(path.join(os.tmpdir(), 'reforge-decktools-'));
  writeFileSync(path.join(data, 'reforge.properties'), 'language=pt-BR\nskin=mesa\n');
  engine = spawn(java, ['-jar', path.join(root, 'engine/target/re-forge-engine.jar'), '--port', '0',
    '--assets', path.join(root, 'forge/forge-gui'), '--data', data, '--exit-with-parent'], { env: { ...process.env, ...env } });
  let out = '';
  return new Promise((resolve) => engine.stdout.on('data', (chunk) => {
    out += chunk;
    const m = out.match(/^READY (\d+)$/m);
    if (m) { engine.stdout.removeAllListeners('data'); resolve(Number(m[1])); }
  }));
}

async function connect(port) {
  const ws = new WebSocket(`ws://127.0.0.1:${port}`);
  const byType = [];
  ws.onmessage = (event) => {
    const msg = JSON.parse(event.data);
    const i = byType.findIndex((w) => w.types.includes(msg.type));
    if (i >= 0) byType.splice(i, 1)[0].resolve(msg);
    else if (msg.type === 'error') fail(`engine error: ${msg.message}`);
  };
  await new Promise((resolve) => { ws.onopen = resolve; });
  return { ws, ask: (message, ...types) => new Promise((resolve) => { byType.push({ types, resolve }); ws.send(JSON.stringify(message)); }) };
}

// Local stand-ins for the three services, with the answers' real shapes.
const services = { calls: [], printing: null, edhrecDown: false };
const fixture = createServer((req, res) => {
  let body = '';
  req.on('data', (c) => { body += c; });
  req.on('end', () => {
    const url = new URL(req.url, 'http://x');
    services.calls.push(`${req.method} ${url.pathname}`);
    const json = (status, value) => { res.writeHead(status, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(value)); };
    if (url.pathname === '/scryfall/cards/collection') {
      // Every exact printing costs 10 except Plains (no price) and Arcane Signet (unknown printing → by name, 3).
      const data = [];
      for (const id of JSON.parse(body).identifiers) {
        if (id.name) data.push({ name: id.name, set: 'xyz', collector_number: '1', prices: { eur: id.name === 'Arcane Signet' ? '3.00' : null } });
        else if (id.collector_number && services.unknown !== `${id.set}/${id.collector_number}`) {
          data.push({ name: '?', set: id.set, collector_number: id.collector_number, prices: { eur: id.set && services.plains === `${id.set}/${id.collector_number}` ? null : '10.00' } });
        }
      }
      return json(200, { data, not_found: [] });
    }
    if (url.pathname === '/scryfall/cards/named') {
      return url.searchParams.get('exact') === 'Sol Ring' ? json(200, { id: '00000000-0000-0000-0000-000000000001', name: 'Sol Ring' }) : json(404, {});
    }
    if (url.pathname === '/scryfall/cards/00000000-0000-0000-0000-000000000001/rulings') {
      return json(200, { data: [{ source: 'wotc', published_at: '2004-10-04', comment: 'Old ruling.' }] });
    }
    if (url.pathname === '/scryfall/cards/search') {
      // Sol Ring: a cheaper printing Forge lacks (skipped) and one Forge has; nothing else is cheaper.
      const q = url.searchParams.get('q');
      const data = q.includes('!"Sol Ring"') ? [
        { name: 'Sol Ring', set: 'zzz', collector_number: '1', prices: { eur: '0.01' } },
        { name: 'Sol Ring', set: services.printing.scryfall, collector_number: services.printing.number, prices: { eur: '0.50' } },
      ] : [];
      return data.length ? json(200, { data, has_more: false }) : json(404, { object: 'error' });
    }
    if (services.edhrecDown && url.pathname.startsWith('/edhrec/')) return json(500, {});
    if (url.pathname === '/edhrec/pages/combos/eowyn-shieldmaiden.json') {
      return json(200, { header: 'Éowyn Combos (1,234 Combos)', container: { json_dict: { cardlists: [
        { href: '/combos/mono-white/1-2', combo: { comboId: '1-2', count: 50, results: ['Infinite mana'] }, cardviews: [{ name: 'Sol Ring' }, { name: 'Arcane Signet' }] },
        { href: '/combos/mono-white/3-4--7', combo: { comboId: '3-4--7', count: 9, results: ['Infinite tokens'] }, cardviews: [{ name: 'Rhystic Study' }] },
      ] } } });
    }
    if (url.pathname === '/spellbook/find-my-combos/') {
      const sent = JSON.parse(body);
      services.spellbookBody = sent;
      return json(200, { results: { included: [{ id: '1-2', uses: [{ card: { name: 'Sol Ring' } }, { card: { name: 'Arcane Signet' } }],
        produces: [{ feature: { name: 'Infinite colorless mana' } }] }] } });
    }
    if (url.pathname === '/spellbook/templates/7/') return json(200, { name: 'Persist Creature', scryfallQuery: 't:creature o:persist' });
    if (url.pathname === '/edhrec/pages/combos/mono-white/3-4--7.json') {
      return json(200, { combo: { prerequisites: [{ description: 'A creature with persist.\nRhystic Study.' }], steps: ['Step one.', 'Step two.'] } });
    }
    json(404, {});
  });
});

await new Promise((resolve) => fixture.listen(0, '127.0.0.1', resolve));
run(await startEngine({ RE_FORGE_SERVICES_URL: `http://127.0.0.1:${fixture.address().port}` })).catch((err) => fail(err.stack ?? err.message));

async function run(port) {
  const ws = new WebSocket(`ws://127.0.0.1:${port}`);
  const waiting = new Map();
  const byType = [];
  ws.onmessage = (event) => {
    const msg = JSON.parse(event.data);
    const i = byType.findIndex((w) => w.types.includes(msg.type));
    if (i >= 0) { byType.splice(i, 1)[0].resolve(msg); return; }
    if (msg.type === 'error') fail(`engine error: ${msg.message}`);
    if (msg.requestId && waiting.has(msg.requestId)) { waiting.get(msg.requestId)(msg); waiting.delete(msg.requestId); }
  };
  const ask = (message, ...types) => new Promise((resolve) => { byType.push({ types, resolve }); ws.send(JSON.stringify(message)); });
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
  const search = await ask({ type: 'searchCards', query: 'rhystic study' }, 'cardResults');
  assert.match(visualFromCatalog(search.cards[0]).oracleText, /Whenever an opponent casts a spell/);

  // Tags, notes and intended bracket live in the Forge deck and survive an edit and a rename.
  const rohanText = readFileSync(path.join(root, 'scripts/fixtures/riders-of-rohan-arena.txt'), 'utf8');
  await ask({ type: 'saveDeck', text: rohanText, name: 'Rohan' }, 'decks');
  const notes = 'Linha 1\nLinha \\ 2, com vírgula';
  let detail = await ask({ type: 'setDeckMeta', name: 'Rohan', tags: ['Cavalaria', ' Casual ', 'casual'], notes, bracketIntent: 3, calculatedBracket: 4 }, 'deckDetail');
  assert.deepEqual(detail.tags, ['Casual', 'Cavalaria'], 'trimmed, case-insensitive, sorted by Forge');
  assert.equal(detail.notes, notes, 'line breaks and backslashes round-trip');
  assert.equal(detail.bracketIntent, 3);
  assert.equal(detail.calculatedBracket, 4, 'Analyze deck stamps a calculated bracket');
  await ask({ type: 'saveDeck', text: rohanText.replace('1 Arcane Signet', '1 Mind Stone'), name: 'Rohan 2', from: 'Rohan' }, 'decks');
  detail = await ask({ type: 'getDeck', name: 'Rohan 2' }, 'deckDetail');
  assert.deepEqual([detail.tags, detail.notes, detail.bracketIntent, detail.calculatedBracket], [['Casual', 'Cavalaria'], notes, 3, 4], 'edit keeps the metadata');
  await ask({ type: 'renameDeck', name: 'Rohan 2', to: 'Rohan 3' }, 'decks');
  detail = await ask({ type: 'getDeck', name: 'Rohan 3' }, 'deckDetail');
  assert.equal(detail.bracketIntent, 3, 'rename keeps the metadata');
  assert.equal(detail.calculatedBracket, 4, 'rename keeps the calculated bracket');
  const restart = await ask({ type: 'setDeckMeta', name: 'Rohan 3', tags: ['a,b'], notes: '', bracketIntent: 0 }, 'error');
  assert.match(restart.message, /Invalid tag/);
  assert.match((await ask({ type: 'setDeckMeta', name: 'Rohan 3', tags: ['reforge-won-1'], notes: '', bracketIntent: 0 }, 'error')).message, /Invalid tag/,
    'internal tags cannot be set');
  detail = await ask({ type: 'setDeckMeta', name: 'Rohan 3', tags: [], notes: '', bracketIntent: 0 }, 'deckDetail');
  assert.deepEqual([detail.tags, detail.notes, detail.bracketIntent], [[], '', 0], 'cleared intent');
  assert.equal(detail.calculatedBracket, 4, 'notes save without calculatedBracket leaves the stamp');
  detail = await ask({ type: 'setDeckMeta', name: 'Rohan 3', tags: [], notes: '', bracketIntent: 0, calculatedBracket: 0 }, 'deckDetail');
  assert.equal(detail.calculatedBracket, 0, 'calculated bracket cleared');

  // Decklist text edits used by "apply cheaper printings" and "add combo".
  const sample = 'Commander\n1 Éowyn, Shieldmaiden (LTC) 1\n\nDeck\n2 Arcane Signet (ELD) 331\n1 Sol Ring (LEA) 269\n\nSideboard\n1 Sol Ring (LEA) 269';
  assert.equal(swapPrinting(sample, 'Sol Ring', { set: 'LEA', number: '269' }, { set: 'C21', number: '263' }),
    sample.replaceAll('(LEA) 269', '(C21) 263'), 'every section switches printing');
  assert.equal(addAndCut(sample, ['Rhystic Study'], ['Arcane Signet', 'Sol Ring']),
    'Commander\n1 Éowyn, Shieldmaiden (LTC) 1\n\nDeck\n1 Rhystic Study\n1 Arcane Signet (ELD) 331\n\nSideboard\n1 Sol Ring (LEA) 269',
    'adds to the deck, cuts one copy from the deck only');
  assert.equal(mergeDecklists(sample, 'Commander\n1 Atraxa, Praetors\' Voice\n\nDeck\n1 Sol Ring (LEA) 269\n1 Rhystic Study\n\nMaybeboard\n1 Opt'),
    'Commander\n1 Éowyn, Shieldmaiden (LTC) 1\n\nDeck\n2 Arcane Signet (ELD) 331\n2 Sol Ring (LEA) 269\n1 Atraxa, Praetors\' Voice\n1 Rhystic Study\n\nSideboard\n1 Sol Ring (LEA) 269\n\nMaybeboard\n1 Opt',
    'adds cards into matching sections; imported commanders join the deck');
  assert.equal(removeCopy(sample, 'Sol Ring', { set: 'LEA', number: '269' }, 'deck'),
    'Commander\n1 Éowyn, Shieldmaiden (LTC) 1\n\nDeck\n2 Arcane Signet (ELD) 331\n\nSideboard\n1 Sol Ring (LEA) 269',
    'one copy leaves the deck, the sideboard copy stays');
  assert.equal(removeCopy(sample, 'Arcane Signet', { set: 'ELD', number: '331' }, 'deck'),
    sample.replace('2 Arcane Signet (ELD) 331', '1 Arcane Signet (ELD) 331'), 'a second copy stays');
  assert.equal(demoteCommander(sample, 'Éowyn, Shieldmaiden', { set: 'LTC', number: '1' }),
    'Deck\n1 Éowyn, Shieldmaiden (LTC) 1\n2 Arcane Signet (ELD) 331\n1 Sol Ring (LEA) 269\n\nSideboard\n1 Sol Ring (LEA) 269',
    'a commander moves into the deck');
  assert.equal(promoteCommander(sample, 'Sol Ring', { set: 'LEA', number: '269' }, 'deck'),
    'Commander\n1 Sol Ring (LEA) 269\n\nDeck\n2 Arcane Signet (ELD) 331\n1 Éowyn, Shieldmaiden (LTC) 1\n\nSideboard\n1 Sol Ring (LEA) 269',
    'a deck card becomes the commander and the old one returns to the deck');
  assert.equal(promoteCommander(sample, 'Sol Ring', { set: 'LEA', number: '269' }, 'sideboard', true),
    'Commander\n1 Éowyn, Shieldmaiden (LTC) 1\n1 Sol Ring (LEA) 269\n\nDeck\n2 Arcane Signet (ELD) 331\n1 Sol Ring (LEA) 269',
    'a partner joins the command zone from the sideboard');
  assert.equal(moveCopy(sample, 'Sol Ring', { set: 'LEA', number: '269' }, 'deck', 'maybeboard'),
    'Commander\n1 Éowyn, Shieldmaiden (LTC) 1\n\nDeck\n2 Arcane Signet (ELD) 331\n\nSideboard\n1 Sol Ring (LEA) 269\n\nMaybeboard\n1 Sol Ring (LEA) 269',
    'one copy moves to a new maybeboard');
  assert.equal(moveCopy(sample + '\n\nMaybeboard\n1 Sol Ring (LEA) 269', 'Sol Ring', { set: 'LEA', number: '269' }, 'maybeboard', 'sideboard'),
    'Commander\n1 Éowyn, Shieldmaiden (LTC) 1\n\nDeck\n2 Arcane Signet (ELD) 331\n1 Sol Ring (LEA) 269\n\nSideboard\n2 Sol Ring (LEA) 269',
    'a maybeboard copy joins the sideboard');

  // Prices: exact printings, unknown printing priced by name, a card without a price, cached afterwards.
  await ask({ type: 'saveDeck', text: rohanText, name: 'Rohan' }, 'decks');
  const rohanDetail = await ask({ type: 'getDeck', name: 'Rohan' }, 'deckDetail');
  const line = (n) => rohanDetail.lines.find((l) => l.nameEn === n);
  services.unknown = `${line('Arcane Signet').set.toLowerCase()}/${line('Arcane Signet').number}`;
  services.plains = `${line('Plains').set.toLowerCase()}/${line('Plains').number}`;
  const priced = await ask({ type: 'deckPrices', requestId: 1, name: 'Rohan' }, 'deckPrices', 'servicesError');
  assert.equal(priced.type, 'deckPrices', JSON.stringify(priced));
  const priceOf = (n) => priced.prices.find((p) => p.set === line(n).set && p.number === line(n).number);
  assert.deepEqual(priceOf('Banishing Light'), { eur: 10, exact: true, set: line('Banishing Light').set, number: line('Banishing Light').number });
  assert.deepEqual([priceOf('Arcane Signet').eur, priceOf('Arcane Signet').exact], [3, false], 'unknown printing priced by name');
  assert.ok(priceOf('Plains') && priceOf('Plains').eur == null, 'no price stays missing, never 0');
  const calls = services.calls.length;
  await ask({ type: 'deckPrices', requestId: 2, name: 'Rohan' }, 'deckPrices');
  assert.equal(services.calls.length, calls, 'second lookup comes from the cache');

  // Cheaper printings: only a printing Forge has, with progress.
  const printings = (await ask({ type: 'getPrintings', name: 'Sol Ring' }, 'printings')).printings;
  const target = printings.find((p) => p.set !== line('Sol Ring').set && /^[A-Z0-9]{3}$/.test(p.set));
  services.printing = { scryfall: target.set.toLowerCase(), number: target.number };
  let progressed = 0;
  const cheaperReply = new Promise((resolve) => {
    const previous = ws.onmessage;
    ws.onmessage = (event) => {
      const msg = JSON.parse(event.data);
      if (msg.type === 'cheaperProgress') { progressed = msg.done; return; }
      if (msg.requestId === 3) { ws.onmessage = previous; resolve(msg); return; }
      previous(event);
    };
  });
  ws.send(JSON.stringify({ type: 'cheaperPrintings', requestId: 3, name: 'Rohan' }));
  const cheaper = await cheaperReply;
  assert.equal(cheaper.type, 'cheaperPrintings', JSON.stringify(cheaper));
  assert.deepEqual(cheaper.offers.map((o) => [o.nameEn, o.to.set, o.to.number, o.to.eur, o.from.eur]),
    [['Sol Ring', target.set, target.number, 0.5, 10]], 'the printing Scryfall has but Forge lacks is skipped');
  assert.ok(cheaper.offers[0].to.imageKey && progressed > 0, 'image key and progress');

  // Combos: EDHREC page, Spellbook template piece, explanation; a broken service says unavailable.
  const combos = await ask({ type: 'deckCombos', requestId: 4, name: 'Rohan' }, 'deckCombos', 'servicesError');
  assert.equal(combos.type, 'deckCombos', JSON.stringify(combos));
  const group = combos.groups[0];
  assert.deepEqual([group.commander, group.total, group.url], ['Éowyn, Shieldmaiden', 1234, 'https://edhrec.com/combos/eowyn-shieldmaiden']);
  assert.deepEqual(group.combos.map((c) => [c.cardNames, c.results, c.decks, c.pieces]),
    [[['Sol Ring', 'Arcane Signet'], ['Infinite mana'], 50, []], [['Rhystic Study'], ['Infinite tokens'], 9, ['Persist Creature']]]);
  const explained = await ask({ type: 'comboDetail', requestId: 5, href: group.combos[1].href }, 'comboDetail', 'servicesError');
  assert.deepEqual([explained.prerequisites, explained.steps], [['A creature with persist.', 'Rhystic Study.'], ['Step one.', 'Step two.']]);
  const refused = await ask({ type: 'comboDetail', requestId: 6, href: 'https://example.com/combos/x/1-2' }, 'servicesError', 'comboDetail');
  assert.deepEqual([refused.type, refused.unavailable], ['servicesError', false], 'only EDHREC combo paths');
  // Combos already complete in the deck (Spellbook), another deck's lines and catalog cards by name.
  const complete = await ask({ type: 'deckSpellbook', requestId: 11, name: 'Rohan' }, 'deckSpellbook', 'servicesError');
  assert.deepEqual(complete.combos, [{ id: '1-2', cardNames: ['Sol Ring', 'Arcane Signet'], produces: ['Infinite colorless mana'] }]);
  assert.deepEqual(services.spellbookBody.commanders, [{ card: 'Éowyn, Shieldmaiden', quantity: 1 }], 'commanders apart from the main deck');
  assert.ok(services.spellbookBody.main.some((c) => c.card === 'Plains' && c.quantity > 1), 'quantities sent');
  const decks = await ask({ type: 'listDecks' }, 'decks');
  const precon = decks.commander[0];
  const theirs = await ask({ type: 'deckLines', requestId: 12, name: precon, source: 'precon' }, 'deckLines', 'servicesError');
  assert.deepEqual([theirs.type, theirs.name, theirs.source, theirs.cards], ['deckLines', precon, 'precon', 100], 'a precon read as lines');
  assert.equal((await ask({ type: 'deckLines', requestId: 13, name: 'Rohan', source: 'nowhere' }, 'deckLines', 'servicesError')).type, 'servicesError');
  const named = await ask({ type: 'cardsByName', requestId: 14, names: ['Rhystic Study', 'Not A Card'] }, 'cardsByName', 'servicesError');
  assert.deepEqual(named.cards.map((c) => [c.nameEn, c.name]), [['Rhystic Study', 'Estudo Rístico']], 'translated, unknown names left out');
  // Rules lookup: the card, its text in the player's language and Scryfall's rulings.
  const ruled = await ask({ type: 'cardRulings', requestId: 15, name: 'Sol Ring' }, 'cardRulings', 'servicesError');
  assert.deepEqual([ruled.card.nameEn, ruled.rulings], ['Sol Ring', [{ date: '2004-10-04', source: 'wotc', comment: 'Old ruling.' }]]);
  assert.ok(ruled.text && !ruled.text.includes('\\n') && ruled.text !== ruled.card.textEn, `translated text, real line breaks: ${ruled.text}`);
  const unruled = await ask({ type: 'cardRulings', requestId: 16, name: 'Grizzly Bears' }, 'cardRulings', 'servicesError');
  assert.deepEqual(unruled.rulings, [], 'unknown to Scryfall: no rulings, not an error');
  assert.equal((await ask({ type: 'cardRulings', requestId: 17, name: 'Not A Card' }, 'cardRulings', 'servicesError')).type, 'servicesError');
  const noTab = await ask({ type: 'deckCombos', requestId: 7, name: 'Crafted' }, 'deckCombos', 'servicesError');
  assert.equal(noTab.type, 'servicesError', 'Crafted is not saved');
  await ask({ type: 'saveDeck', text: "Commander\n1 Atraxa, Praetors' Voice\n\nDeck\n1 Sol Ring", name: 'Atraxa' }, 'decks');
  const missing = await ask({ type: 'deckCombos', requestId: 8, name: 'Atraxa' }, 'deckCombos', 'servicesError');
  assert.deepEqual([missing.groups, missing.missing], [[], ["Atraxa, Praetors' Voice"]], 'no EDHREC tab is "none", not an error');
  services.edhrecDown = true;
  assert.equal((await ask({ type: 'deckCombos', requestId: 9, name: 'Rohan' }, 'deckCombos', 'servicesError')).type, 'deckCombos',
    'a cached commander page answers while EDHREC is down');
  const down = await ask({ type: 'comboDetail', requestId: 10, href: group.combos[0].href }, 'servicesError', 'comboDetail');
  assert.deepEqual([down.type, down.unavailable], ['servicesError', true], 'a failing service is unavailable');

  // The old Central library: names never replace a deck, metadata comes along, unknown cards are counted.
  assert.equal((await ask({ type: 'hello' }, 'engineInfo')).centralMigrated, false);
  const card = (name, quantity = 1) => ({ name, quantity });
  const centralLibrary = { version: 1, decks: [
    { id: '1', name: 'Rohan', format: 'commander', commanders: [card('Éowyn, Shieldmaiden')], cards: [card('Sol Ring'), card('Plains', 98)],
      tags: ['angels', 'a,b', 'reforge-won-1'], notes: 'Linha 1\nLinha 2', bracketIntent: 2, createdAt: '', updatedAt: '' },
    { id: '2', name: 'Bad/Name', format: 'commander', commanders: [card("Atraxa, Praetors' Voice")], cards: [card('Sol Ring'), card('Not A Real Card')],
      createdAt: '', updatedAt: '' },
    { id: '3', name: 'Empty', format: 'commander', commanders: [], cards: [], createdAt: '', updatedAt: '' },
  ] };
  const migrated = await ask({ type: 'importCentral', json: JSON.stringify(centralLibrary), migration: true }, 'centralImport');
  assert.deepEqual(migrated.imported.map((d) => [d.from, d.name, d.unknown]), [['Rohan', 'Rohan (Central)', 0], ['Bad/Name', 'Bad-Name', 1]]);
  assert.deepEqual(migrated.failed.map((d) => d.name), ['Empty'], 'a deck without cards is reported, not saved');
  const kept = await ask({ type: 'getDeck', name: 'Rohan' }, 'deckDetail');
  assert.ok(kept.lines.some((l) => l.nameEn === 'Arcane Signet'), 'the existing Rohan is untouched');
  const brought = await ask({ type: 'getDeck', name: 'Rohan (Central)' }, 'deckDetail');
  assert.deepEqual([brought.tags, brought.notes, brought.bracketIntent, brought.cards], [['a b', 'angels'], 'Linha 1\nLinha 2', 2, 100]);
  assert.equal((await ask({ type: 'hello' }, 'engineInfo')).centralMigrated, true, 'the migration is remembered');
  const again = await ask({ type: 'importCentral', json: JSON.stringify(centralLibrary.decks[0]) }, 'centralImport');
  assert.deepEqual([again.migration, again.imported[0].name], [false, 'Rohan (Central 2)'], 'one deck by hand, another free name');
  assert.match((await ask({ type: 'importCentral', json: 'not json' }, 'error')).message, /Not a Central library/);
  engine.kill();

  let live = 'skipped (SMOKE_OFFLINE)';
  if (!process.env.SMOKE_OFFLINE) {
    const real = await connect(await startEngine());
    await real.ask({ type: 'saveDeck', text: rohanText, name: 'Rohan' }, 'decks');
    const p = await real.ask({ type: 'deckPrices', requestId: 1, name: 'Rohan' }, 'deckPrices', 'servicesError');
    const c = await real.ask({ type: 'deckCombos', requestId: 2, name: 'Rohan' }, 'deckCombos', 'servicesError');
    if (p.type === 'servicesError' || c.type === 'servicesError') live = `unavailable (${p.message ?? c.message})`;
    else {
      assert.ok(p.prices.filter((x) => x.eur != null).length > 50, 'most cards priced');
      assert.ok(c.groups[0].combos.length > 0, 'EDHREC combos');
      live = 'Scryfall prices and EDHREC combos';
    }
    engine.kill();
  }

  clearTimeout(timeout);
  fixture.close();
  console.log(`OK deck tools: real lists, bracket, Commander check, roles, groups, compare, cuts, plans, tags/notes/bracket, text edits, prices, cheaper printings, combos, complete combos, other decks, cards by name, rulings, Central library import; live: ${live}`);
  process.exit(0);
}
