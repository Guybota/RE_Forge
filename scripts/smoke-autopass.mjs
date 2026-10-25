// Auto-pass on opponents' turns: Forge's "no actions" yield switched on live, and off again on our own turn.
import { spawn } from 'node:child_process';
import { mkdtempSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const data = mkdtempSync(path.join(os.tmpdir(), 'reforge-autopass-'));
const every = 'UPKEEP,DRAW,MAIN1,COMBAT_BEGIN,COMBAT_DECLARE_ATTACKERS,COMBAT_DECLARE_BLOCKERS,COMBAT_DAMAGE,COMBAT_END,MAIN2,END_OF_TURN';
writeFileSync(path.join(data, 'reforge.properties'), `language=en-US\nskin=mesa\nphaseStops.opponents=${every}\nautoPass=false\n`);
const java = process.env.JAVA_HOME ? path.join(process.env.JAVA_HOME, 'bin', 'java') : 'java';
const classpath = [path.join(root, 'engine/target/test-classes'), path.join(root, 'engine/target/re-forge-engine.jar')].join(path.delimiter);
const engine = spawn(java, ['-cp', classpath, 'reforge.engine.DialogHarness', '--scenario', 'autopass',
  '--assets', path.join(root, 'forge/forge-gui'), '--data', data, '--port', '0', '--exit-with-parent'], { cwd: root });
let output = '', ws, step = 'first stop', lastPhase, done = false;
const timeout = setTimeout(() => fail(`timed out at: ${step}`), 120_000);
function fail(message) {
  if (done) return;
  done = true;
  console.error(`FAIL: ${message}\n${output.slice(-3000)}`);
  finish(1);
}
function finish(code) { done = true; clearTimeout(timeout); ws?.close(); engine.kill(); process.exitCode = code; }
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
    try { handle(JSON.parse(event.data)); } catch (error) { fail(error.stack ?? error.message); }
  };
});
engine.on('exit', (code) => { if (!done) fail(`engine exited ${code}`); });

function handle(msg) {
  if (msg.type === 'error' || msg.type === 'notice' && msg.kind === 'error') throw new Error(msg.message ?? msg.text);
  if (msg.type === 'choice') throw new Error(`unexpected choice ${msg.kind}: ${msg.title}`);
  if (msg.type === 'state' && msg.phase) lastPhase = msg.phase;
  if (msg.type !== 'state' || !msg.prompt.ok.enabled) return;
  if (process.env.SMOKE_DEBUG) console.log(step, msg.turn, msg.phase, msg.activePlayerId, msg.prompt.message, msg.prompt.ok.label);
  // Keep the opening hand; the fixture replaces the board once the game starts.
  if (!msg.phase) return send({ type: 'action', action: 'ok' });
  const mine = msg.players.find((p) => p.isLocal)?.id === msg.activePlayerId;
  if (step === 'first stop') {
    if (mine) throw new Error('the opponent stop was never offered without auto-pass');
    // Not answered: the game must wait here, and switching auto-pass on must release this very prompt.
    step = 'waiting';
    const at = msg.phase;
    setTimeout(() => {
      if (lastPhase !== at) return fail(`the game left ${at} without an answer while auto-pass was off`);
      step = 'released';
      send({ type: 'setPhaseStops', stops: { mine: ['MAIN1'], opponents: every.split(','), autoPass: true } });
    }, 3000);
  } else if (step === 'released' && mine) {
    // Never answered: reaching our own turn means every opponent stop passed by itself; here it must wait again.
    step = 'own turn';
    const at = msg.phase;
    setTimeout(() => {
      if (lastPhase !== at) return fail(`auto-pass also passed our own ${at}`);
      console.log(`OK: opponent's turn passed on its own; own turn waits again at ${at}`);
      finish(0);
    }, 3000);
  }
}
