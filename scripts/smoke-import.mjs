// Imports a decklist (MTG Arena format fixture), saves it, plays a game with it, deletes it.
// Uses a throw-away data folder so the real deck list is untouched.
// Run with: npm run engine:smoke-import   (after npm run engine:build)
import { spawn } from 'node:child_process';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const list = readFileSync(path.join(root, 'scripts/fixtures/riders-of-rohan-arena.txt'), 'utf8');
const DECK = 'Teste Rohan';
const data = mkdtempSync(path.join(os.tmpdir(), 'reforge-import-'));
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
  run(Number(m[1]));
});

function run(port) {
  const ws = new WebSocket(`ws://127.0.0.1:${port}`);
  const send = (o) => ws.send(JSON.stringify(o));
  let step = 'preview';
  let finished = false;
  ws.onopen = () => send({ type: 'previewDeck', text: list + '\n1 Totally Not A Real Card\n' });
  ws.onclose = () => { if (!finished) fail('socket closed'); };
  ws.onmessage = (event) => {
    const msg = JSON.parse(event.data);
    try {
      if (msg.type === 'error') fail(`engine error in step ${step}: ${msg.message}`);
      if (step === 'preview' && msg.type === 'deckPreview') {
        assert.equal(msg.unknown, 1, 'one unknown line');
        assert.ok(msg.lines.some((l) => l.status === 'error' && l.text.includes('Totally Not A Real Card')), 'unknown line flagged');
        assert.equal(msg.cards, 100, '100 recognised cards');
        assert.deepEqual(msg.commanders, ['Éowyn, Shieldmaiden'], 'commander detected');
        console.log(`preview: ${msg.lines.length} lines, ${msg.unknown} unknown, problem: ${msg.problem ?? 'none'}`);
        step = 'save';
        send({ type: 'saveDeck', text: list, name: DECK });
      } else if (step === 'save' && msg.type === 'decks') {
        assert.ok(msg.mine.includes(DECK), 'saved deck is listed');
        step = 'play';
        send({ type: 'startMatch', deck: DECK, opponents: 1 });
      } else if (step === 'play' && msg.type === 'state') {
        const me = msg.players.find((p) => p.isLocal);
        if (!me.zones.command.length) return;
        assert.ok(me.zones.command.some((c) => c.typeEn?.includes('Legendary')), 'commander in the command zone');
        console.log(`playing with: ${me.zones.command.map((c) => c.name).join(', ')}`);
        step = 'concede';
        send({ type: 'action', action: 'concede' });
      } else if (step === 'concede' && msg.type === 'choice') {
        send({ type: 'answer', id: msg.id, picked: [0] });
      } else if (step === 'concede' && msg.type === 'state' && msg.gameOver) {
        step = 'delete';
        send({ type: 'deleteDeck', name: DECK });
      } else if (step === 'delete' && msg.type === 'decks') {
        assert.ok(!msg.mine.includes(DECK), 'deck deleted');
        finished = true;
        clearTimeout(timeout);
        console.log('OK: imported, saved, played and deleted');
        ws.close();
        engine.kill();
      }
    } catch (err) {
      fail(err.message);
    }
  };
}
