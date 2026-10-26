// Wishclaw Talisman through the socket: the library search shows off-table cards, the pick reaches the hand,
// the library is shuffled and the opponent gains control. Portuguese, so the zone prompt is checked too;
// cards are told apart by their English type.
import { spawn } from 'node:child_process';
import { mkdtempSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const data = mkdtempSync(path.join(os.tmpdir(), 'reforge-tutor-'));
writeFileSync(path.join(data, 'reforge.properties'), 'language=pt-BR\nskin=mesa\n');
const java = process.env.JAVA_HOME ? path.join(process.env.JAVA_HOME, 'bin', 'java') : 'java';
const classpath = [path.join(root, 'engine/target/test-classes'), path.join(root, 'engine/target/re-forge-engine.jar')].join(path.delimiter);
const engine = spawn(java, ['-cp', classpath, 'reforge.engine.DialogHarness', '--scenario', 'tutor',
  '--assets', path.join(root, 'forge/forge-gui'), '--data', data, '--port', '0', '--exit-with-parent'], { cwd: root });
let output = '', ws, latest, activated = false, searched = false, shuffled = false, done = false;
const timeout = setTimeout(() => fail('tutor smoke timed out'), 120_000);
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
  if (msg.type === 'error' || msg.type === 'notice' && msg.kind === 'error') throw new Error(msg.message ?? msg.text);
  if (msg.type === 'notice' && msg.text === 'SHUFFLED Human' && searched) shuffled = true;
  // Only one opponent: Forge picks it without asking; anything else gets the first option.
  if (msg.type === 'choice') send({ type: 'answer', id: msg.id, picked: [...Array(Math.max(0, msg.min ?? 0)).keys()] });
  if (msg.type !== 'state') return;
  latest = msg;
  const [me, defender] = msg.players;
  const offered = msg.prompt.cards;
  if (offered.length && !searched) {
    // The library search: every card is named, selectable and none comes from the table.
    assert.ok(offered.every((c) => c.name), 'library cards are revealed to the searcher');
    assert.deepEqual(offered.map((c) => c.typeEn).sort(), ['Basic Land - Forest', 'Basic Land - Swamp', 'Creature - Angel', 'Creature - Elf Druid', 'Instant']);
    assert.deepEqual(offered.map((c) => c.id).sort(), [...msg.prompt.selectable.cards].sort());
    assert.equal(msg.prompt.message.split('\n').pop(), 'Escolha uma carta: grimório de você');
    searched = true;
    send({ type: 'action', action: 'card', id: offered.find((c) => c.typeEn === 'Creature - Angel').id });
    return;
  }
  const talisman = defender.zones.battlefield.find((c) => c.typeEn === 'Artifact');
  if (searched && shuffled && talisman && me.zones.hand.some((c) => c.typeEn === 'Creature - Angel')) {
    assert.equal(me.librarySize, 4, 'the chosen card left the library');
    assert.ok(!me.zones.battlefield.some((c) => c.typeEn === 'Artifact'), 'the human no longer controls the talisman');
    assert.equal(talisman.counters.Wish, 2, 'one wish counter paid');
    done = true;
    console.log('OK: Wishclaw Talisman searched the library ("Escolha uma carta: grimório de você"), Serra Angel in hand, library shuffled, Defender controls it');
    cleanup();
  }
}

let acted = '', actedAt = 0;
const tick = setInterval(() => {
  if (done || !latest || latest.gameOver || searched) return;
  const signature = JSON.stringify([latest.turn, latest.phase, latest.prompt]);
  if (signature === acted && Date.now() - actedAt < 1500) return;
  acted = signature; actedAt = Date.now();
  const me = latest.players[0];
  // Keep the hand, activate the talisman once in main phase 1, then confirm the cost (Auto mana, remove the counter).
  const talisman = me.zones.battlefield.find((c) => c.typeEn === 'Artifact');
  if (!activated && latest.phase === 'MAIN1' && latest.prompt.ok.label === 'OK' && talisman) {
    activated = true;
    send({ type: 'action', action: 'card', id: talisman.id });
  } else if (latest.prompt.ok.enabled) send({ type: 'action', action: 'ok' });
}, 120);
