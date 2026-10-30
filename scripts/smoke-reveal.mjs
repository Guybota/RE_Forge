// Peek looks at the opponent's hand through Forge's showRevealedCards prompt, then draws a card.
import { spawn } from 'node:child_process';
import { mkdtempSync, mkdirSync, symlinkSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const data = mkdtempSync(path.join(os.tmpdir(), 'reforge-reveal-'));
const assets = path.join(data, 'assets'); mkdirSync(assets);
symlinkSync(path.join(root, 'forge/forge-gui/res'), path.join(assets, 'res'), process.platform === 'win32' ? 'junction' : 'dir');
writeFileSync(path.join(data, 'reforge.properties'), `language=${process.env.SMOKE_LANGUAGE ?? 'en-US'}\nskin=mesa\n`);
const java = process.env.JAVA_HOME ? path.join(process.env.JAVA_HOME, 'bin', 'java') : 'java';
const engine = spawn(java, ['-cp', [path.join(root, 'engine/target/test-classes'), path.join(root, 'engine/target/re-forge-engine.jar')].join(path.delimiter),
  'reforge.engine.CodieHarness', '--scenario', 'reveal', '--assets', assets, '--data', data, '--port', '0', '--exit-with-parent'], { cwd: root, windowsHide: true });
let output = '', ws, latest, done = false, cast = false, revealed = false, acknowledged = false, choiceOpen = false;
const timeout = setTimeout(() => fail('Peek hand reveal timed out'), 120_000);
function cleanup() { clearTimeout(timeout); clearInterval(tick); ws?.close(); engine.kill(); }
function fail(message) { if (done) return; done = true; console.error(`FAIL: ${message}\n${JSON.stringify({ cast, revealed, acknowledged, phase: latest?.phase, prompt: latest?.prompt })}\n${output.slice(-4000)}`); cleanup(); process.exitCode = 1; }
const send = message => ws.send(JSON.stringify(message));
engine.stderr.on('data', chunk => { output += chunk; });
engine.stdout.on('data', chunk => {
  output += chunk; const ready = output.match(/^READY (\d+)$/m); if (!ready || ws) return;
  ws = new WebSocket(`ws://127.0.0.1:${ready[1]}`);
  ws.onopen = () => send({ type: 'startMatch', opponents: 1 });
  ws.onclose = () => { if (!done) fail('socket closed'); };
  ws.onmessage = event => { try { handle(JSON.parse(event.data)); } catch (error) { fail(error.stack ?? error.message); } };
});
engine.on('error', error => fail(error.message)); engine.on('exit', code => { if (!done) fail(`engine exited ${code}`); });
function handle(msg) {
  if (process.env.SMOKE_DEBUG && msg.type !== 'state') console.log(JSON.stringify(msg).slice(0, 1200));
  if (msg.type === 'error' || msg.type === 'notice' && msg.kind === 'error') throw new Error(msg.message ?? msg.text);
  if (msg.type === 'choice') {
    choiceOpen = true;
    assert.notEqual(msg.kind, 'reveal', 'Peek uses the native board prompt, not an unrelated reveal dialog');
    send({ type: 'answer', id: msg.id, picked: Array.from({ length: Math.max(0, msg.min ?? 0) }, (_, i) => i) }); return;
  }
  if (msg.type !== 'state') return;
  latest = msg; choiceOpen = false;
  const me = msg.players.find(p => p.isLocal), opponent = msg.players.find(p => !p.isLocal);
  if (!cast) assert.ok(opponent.zones.hand.every(c => c.hidden && !c.name), 'opponent hand is private before Peek');
  if (msg.prompt.cards.length) {
    assert.equal(msg.prompt.cards.length, 3);
    assert.ok(msg.prompt.cards.every(c => !c.hidden && c.name && c.imageKey), 'every explicitly revealed card has inspectable details');
    assert.deepEqual(msg.prompt.cards.map(c => c.typeEn).sort(), ['Basic Land - Forest', 'Creature - Angel', 'Instant']);
    assert.ok(msg.prompt.cards.every(c => !msg.prompt.selectable.cards.includes(c.id)), 'revealed cards are visible without becoming selectable');
    assert.ok(msg.prompt.ok.enabled, 'the native prompt can be acknowledged');
    assert.equal(msg.prompt.priority, false, 'acknowledging a reveal is not resolving or passing priority');
    assert.ok(!msg.players.some(p => p.libraryTop), 'revealing a hand does not reveal a library');
    revealed = true;
  }
  if (acknowledged && revealed && me.zones.hand.some(c => c.typeEn === 'Creature - Elf Druid') && !msg.stack.length) {
    assert.deepEqual(msg.prompt.cards, [], 'the reveal list is cleared after acknowledgement');
    assert.ok(opponent.zones.hand.every(c => c.hidden && !c.name), 'opponent hand returns to private after the prompt');
    done = true; console.log('OK: Peek reveals the three opponent hand cards in its native prompt, clears them after OK, draws a card and preserves hidden libraries'); cleanup();
  }
}
let acted = '', actedAt = 0;
const tick = setInterval(() => {
  if (done || choiceOpen || !latest || latest.gameOver) return;
  if (Date.now() - actedAt < 300) return;
  // Stack updates can arrive while the payment prompt is still being replaced. One action per prompt
  // prevents a second queued OK from accidentally acknowledging the next native reveal prompt.
  const signature = JSON.stringify([latest.turn, latest.phase, latest.prompt]);
  if (signature === acted && Date.now() - actedAt < 1500) return;
  acted = signature; actedAt = Date.now();
  const me = latest.players.find(p => p.isLocal), opponent = latest.players.find(p => !p.isLocal);
  if (process.env.SMOKE_DEBUG) console.log('ACT', latest.phase, latest.prompt.message, latest.prompt.ok, latest.stack.map(s => s.text));
  if (!cast && latest.phase === 'MAIN1' && latest.prompt.priority && me.zones.hand.some(c => c.typeEn === 'Instant')) {
    cast = true; send({ type: 'action', action: 'card', id: me.zones.hand.find(c => c.typeEn === 'Instant').id });
  } else if (!revealed && latest.prompt.selectable.players.includes(opponent.id)) send({ type: 'action', action: 'player', id: opponent.id });
  else if (latest.prompt.ok.enabled) { if (revealed && latest.prompt.cards.length) acknowledged = true; send({ type: 'action', action: 'ok' }); }
}, 120);
