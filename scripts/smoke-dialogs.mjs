// Test-only Java launcher: real Forge views, rejected answers and a deterministic double block.
import { spawn } from 'node:child_process';
import { mkdtempSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const data = mkdtempSync(path.join(os.tmpdir(), 'reforge-dialogs-'));
writeFileSync(path.join(data, 'reforge.properties'), 'language=en-US\nskin=mesa\n');
const java = process.env.JAVA_HOME ? path.join(process.env.JAVA_HOME, 'bin', 'java') : 'java';
const classpath = [path.join(root, 'engine/target/test-classes'), path.join(root, 'engine/target/re-forge-engine.jar')].join(path.delimiter);
const engine = spawn(java, ['-cp', classpath, 'reforge.engine.DialogHarness', '--scenario', 'suite',
  '--assets', path.join(root, 'forge/forge-gui'), '--data', data, '--port', '0', '--exit-with-parent'], { cwd: root });
let output = '', ws, latest, choiceOpen = false, suiteDone = false, realDamage = false, realBlock = false, done = false;
const rejected = new Set(), counts = new Map();
const timeout = setTimeout(() => fail('dialog smoke timed out'), 150_000);
function fail(message) {
  if (done) return;
  done = true;
  console.error(`FAIL: ${message}\n${output.slice(-4000)}`);
  cleanup();
  process.exitCode = 1;
}
function cleanup() { clearTimeout(timeout); clearInterval(tick); ws?.close(); engine.kill(); }
const send = (message) => ws.send(JSON.stringify(message));
engine.stderr.on('data', (chunk) => { output += chunk; });
engine.stdout.on('data', (chunk) => {
  output += chunk;
  const ready = output.match(/^READY (\d+)$/m);
  if (!ready || ws) return;
  ws = new WebSocket(`ws://127.0.0.1:${ready[1]}`);
  ws.onopen = () => send({ type: 'startMatch', opponents: 1 });
  ws.onclose = () => { if (!done) fail('socket closed'); };
  ws.onmessage = (event) => {
    try { handle(JSON.parse(event.data)); }
    catch (error) { fail(error.stack ?? error.message); }
  };
});
engine.on('error', (error) => fail(error.message));
engine.on('exit', (code) => { if (!done) fail(`engine exited ${code}`); });

function handle(msg) {
  if (process.env.SMOKE_DEBUG && msg.type !== 'state') console.log(JSON.stringify(msg).slice(0, 1000));
  if (msg.type === 'error' || msg.type === 'notice' && msg.kind === 'error') throw new Error(msg.message ?? msg.text);
  if (msg.type === 'notice' && msg.text === 'DIALOG_SUITE_OK') { suiteDone = true; console.log('callbacks: damage, trample, deathtouch, caps, numbers, modes, order, library and reveal OK'); }
  if (msg.type === 'choice') {
    choiceOpen = true;
    const { kind, title } = msg;
    const n = msg.options?.length ?? 0;
    if (msg.invalid) rejected.add(title || kind);
    let answer;
    if (kind === 'amounts') {
      if (msg.maySkip) answer = { skip: true };
      else if (!suiteDone && !msg.invalid) {
        answer = { amounts: !msg.lethal && n === 3 ? [2, 0, 0] : msg.total === 8 ? [2, 3, 3] : msg.total === 2 ? [0.5, 1.5] : msg.total === 5 ? [0, 5] : [2, 4] };
      } else {
        answer = { amounts: msg.initialAmounts };
        assert.equal(answer.amounts.reduce((a, b) => a + b, 0), msg.total);
        if (suiteDone) {
          assert.equal(msg.options.length, 2, 'nontrampling creature cannot damage the defender');
          assert.deepEqual(msg.lethal, [3, 3]);
          assert.deepEqual(answer.amounts, [3, 3]);
          realDamage = true;
        }
      }
    } else if (kind === 'text' && title === 'Bounded number') {
      const attempts = counts.get(title) ?? 0;
      answer = { value: attempts === 0 ? '2147483648' : attempts === 1 ? '-6' : '257' };
      counts.set(title, attempts + 1);
    } else if (kind === 'text') answer = { value: null };
    else if (title === 'Choose two modes') answer = { picked: msg.invalid ? [0, 2] : [0, 0] };
    else if (title === 'Order triggers') answer = { picked: msg.invalid ? [2, 0, 1] : [2, 0] };
    else if (title === 'Insert trigger') answer = { picked: [3, 0, 1, 2] };
    else if (kind === 'order' && msg.min === 0 && msg.options.every((o) => o.card)) answer = { picked: [0] };
    else if (kind === 'arrange') {
      assert.deepEqual(msg.movable, [0, 1]);
      assert.ok(msg.options[0].card.name && msg.options[1].card.name, 'movable revealed cards have details');
      for (const option of msg.options.slice(2)) {
        assert.equal(option.label, '', 'unknown library names are not sent');
        assert.deepEqual(Object.keys(option.card).sort(), ['hidden', 'id']);
      }
      answer = { picked: msg.invalid ? [1, 2, 3, 4, 0] : [0, 1, 3, 2, 4] };
    } else if (kind === 'reveal') {
      assert.equal(n, 2);
      assert.ok(msg.options.every((o) => o.card?.name), 'explicit reveal has inspectable card details');
      answer = { picked: [] };
    } else if (title === 'Optional target') answer = { picked: [] };
    else answer = { picked: [...Array(Math.min(Math.max(0, msg.min ?? 0), n)).keys()] };
    send({ type: 'answer', id: msg.id, ...answer });
    return;
  }
  if (msg.type !== 'state') return;
  latest = msg;
  choiceOpen = false;
  if (msg.combat.some((attack) => attack.blockerIds.length === 2)) realBlock = true;
  const defender = msg.players.find((p) => !p.isLocal);
  const me = msg.players.find((p) => p.isLocal);
  if (suiteDone && realDamage && msg.phase === 'MAIN2') {
    assert.ok(realBlock, 'actual combat had two blockers');
    assert.equal(defender.zones.graveyard.filter((c) => c.name === 'Hill Giant').length, 2, 'both blockers died from assigned damage');
    assert.ok(me.zones.graveyard.some((c) => c.name === 'Craw Wurm'), 'the attacker received both blockers damage');
    assert.equal(defender.life, 40, 'nontrample did not damage the player');
    assert.ok(rejected.size >= 6, 'invalid answers were rejected and asked again');
    assert.equal(counts.get('Bounded number'), 3, 'overflow and range checked');
    done = true;
    console.log(`OK: real double block resolved 3+3, both blockers and attacker died; ${rejected.size} invalid-choice cases rejected`);
    cleanup();
  }
}

let acted = '', actedAt = 0;
const tick = setInterval(() => {
  if (done || !latest || choiceOpen || latest.gameOver) return;
  const signature = JSON.stringify([latest.turn, latest.phase, latest.prompt]);
  if (signature === acted && Date.now() - actedAt < 1500) return;
  acted = signature; actedAt = Date.now();
  const { ok, selectable, chosen } = latest.prompt;
  if (ok.enabled) send({ type: 'action', action: 'ok' });
  else {
    const id = selectable.cards.find((id) => !chosen.cards.includes(id));
    const player = selectable.players.find((id) => !chosen.players.includes(id));
    if (id !== undefined) send({ type: 'action', action: 'card', id });
    else if (player !== undefined) send({ type: 'action', action: 'player', id: player });
  }
}, 120);
