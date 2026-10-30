// Real Codie activation -> WUBRG -> delayed trigger -> free spell from exile.
import { spawn } from 'node:child_process';
import { mkdtempSync, mkdirSync, symlinkSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const data = mkdtempSync(path.join(os.tmpdir(), 'reforge-codie-'));
const assets = path.join(data, 'assets'); mkdirSync(assets);
symlinkSync(path.join(root, 'forge/forge-gui/res'), path.join(assets, 'res'), process.platform === 'win32' ? 'junction' : 'dir');
writeFileSync(path.join(data, 'reforge.properties'), `language=${process.env.SMOKE_LANGUAGE ?? 'en-US'}\nskin=mesa\n`);
const java = process.env.JAVA_HOME ? path.join(process.env.JAVA_HOME, 'bin', 'java') : 'java';
const classpath = [path.join(root, 'engine/target/test-classes'), path.join(root, 'engine/target/re-forge-engine.jar')].join(path.delimiter);
const engine = spawn(java, ['-cp', classpath, 'reforge.engine.CodieHarness', '--assets', assets, '--data', data, '--port', '0', '--exit-with-parent'], { cwd: root, windowsHide: true });
let output = '', ws, latest, choiceOpen = false, done = false, step = 0, sawMana = false, sawTrigger = false, sawExile = false, sawFreeSpell = false;
const timeout = setTimeout(() => fail('Codie smoke timed out'), 120_000);
function cleanup() { clearTimeout(timeout); clearInterval(tick); ws?.close(); engine.kill(); }
function fail(message) { if (done) return; done = true; console.error(`FAIL: ${message}\n${output.slice(-5000)}`); cleanup(); process.exitCode = 1; }
const send = message => ws.send(JSON.stringify(message));
engine.stderr.on('data', chunk => { output += chunk; });
engine.stdout.on('data', chunk => {
  output += chunk;
  const ready = output.match(/^READY (\d+)$/m);
  if (!ready || ws) return;
  ws = new WebSocket(`ws://127.0.0.1:${ready[1]}`);
  ws.onopen = () => send({ type: 'startMatch', opponents: 1 });
  ws.onclose = () => { if (!done) fail('socket closed'); };
  ws.onmessage = event => { try { handle(JSON.parse(event.data)); } catch (error) { fail(error.stack ?? error.message); } };
});
engine.on('error', error => fail(error.message));
engine.on('exit', code => { if (!done) fail(`engine exited ${code}`); });

function handle(msg) {
  if (process.env.SMOKE_DEBUG && msg.type !== 'state') console.log(JSON.stringify(msg).slice(0, 1500));
  if (msg.type === 'error' || msg.type === 'notice' && msg.kind === 'error') throw new Error(msg.message ?? msg.text);
  if (msg.type === 'choice') {
    choiceOpen = true;
    if (process.env.SMOKE_DEBUG) console.log('CHOICE', msg.kind, msg.title, msg.options?.map(o => o.label));
    const picked = Array.from({ length: Math.max(0, msg.min ?? 0) }, (_, i) => i);
    send({ type: 'answer', id: msg.id, picked, amounts: msg.initialAmounts, value: msg.initial });
    return;
  }
  if (msg.type !== 'state') return;
  latest = msg; choiceOpen = false;
  const me = msg.players.find(p => p.isLocal), opponent = msg.players.find(p => !p.isLocal);
  if (me.manaPool === '{W}{U}{B}{R}{G}') sawMana = true;
  if (step >= 2 && msg.stack.some(s => !s.isSpell)) sawTrigger = true;
  const bolt = me.zones.exile.find(c => c.typeEn === 'Instant');
  if (bolt) {
    assert.ok(bolt.name && bolt.imageKey, 'Codie reveals an inspectable instant in exile');
    if (bolt.actionable) sawExile = true;
  }
  if (step >= 3 && msg.stack.some(s => s.isSpell && s.card?.typeEn === 'Instant')) sawFreeSpell = true;
  if (opponent.life === 37) {
    assert.ok(sawMana, 'mana ability produces all five colours');
    assert.ok(sawTrigger, 'the next spell puts the delayed ability on the stack');
    assert.ok(sawExile, 'the found instant is playable from exile');
    assert.ok(sawFreeSpell, 'the exiled card was cast');
    assert.ok(!me.zones.exile.some(c => c.typeEn === 'Creature - Elf Druid' || c.typeEn?.includes('Land')), 'other revealed cards returned to the library');
    done = true; console.log('OK: Codie produced WUBRG, triggered on Divination, exiled and cast Lightning Bolt for free, dealt 3 damage'); cleanup();
  }
}

let acted = '', actedAt = 0;
const tick = setInterval(() => {
  if (done || choiceOpen || !latest || latest.gameOver) return;
  if (Date.now() - actedAt < 300) return;
  const signature = JSON.stringify([step, latest.turn, latest.phase, latest.prompt]);
  if (signature === acted && Date.now() - actedAt < 1500) return;
  acted = signature; actedAt = Date.now();
  const me = latest.players.find(p => p.isLocal), opponent = latest.players.find(p => !p.isLocal);
  const priority = latest.prompt.priority;
  const codie = me.zones.battlefield.find(c => c.typeEn === 'Legendary Artifact Creature - Book Construct');
  if (process.env.SMOKE_DEBUG) console.log('ACT', step, latest.phase, latest.prompt.message, latest.prompt.ok, priority, me.manaPool, latest.stack.map(s => s.text));
  if (step === 0 && latest.phase === 'MAIN1' && priority && codie) {
    step = 1; send({ type: 'action', action: 'card', id: codie.id });
  } else if (step === 1 && sawMana && priority) {
    const spell = me.zones.hand.find(c => c.typeEn === 'Sorcery');
    assert.ok(spell.actionable); step = 2; send({ type: 'action', action: 'card', id: spell.id });
  } else if (step === 2 && sawExile && priority && latest.stack.length === 0) {
    step = 3; send({ type: 'action', action: 'card', id: me.zones.exile.find(c => c.typeEn === 'Instant').id });
  } else if (step === 3 && latest.prompt.selectable.players.includes(opponent.id)) send({ type: 'action', action: 'player', id: opponent.id });
  else if (latest.prompt.ok.enabled) send({ type: 'action', action: 'ok' });
}, 120);
