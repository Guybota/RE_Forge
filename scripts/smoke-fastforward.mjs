// Native yielding with a playable response, real AI spells, cancellation, own turn and combat interruption.
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { mkdtempSync, mkdirSync, symlinkSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const resources = process.argv[2] ? path.resolve(process.argv[2]) : null;
const java = resources ? path.join(resources, 'runtime/bin', process.platform === 'win32' ? 'java.exe' : 'java')
  : process.env.JAVA_HOME ? path.join(process.env.JAVA_HOME, 'bin/java') : 'java';
const jar = resources ? path.join(resources, 'engine/re-forge-engine.jar') : path.join(root, 'engine/target/re-forge-engine.jar');
const phases = ['UPKEEP', 'DRAW', 'MAIN1', 'COMBAT_BEGIN', 'COMBAT_DECLARE_ATTACKERS', 'COMBAT_DECLARE_BLOCKERS', 'COMBAT_DAMAGE', 'COMBAT_END', 'MAIN2', 'END_OF_TURN'];
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
let child, ws, output = '';
const timeout = setTimeout(() => { child?.kill(); console.error('FAIL: fast-forward timed out'); process.exit(1); }, 150_000);
async function stop() {
  ws?.close();
  if (child?.exitCode === null && child.signalCode === null) {
    const exited = once(child, 'exit'); child.stdin.end(); await exited;
  }
}
async function boot(scenario) {
  const data = mkdtempSync(path.join(os.tmpdir(), 'reforge-fastforward-'));
  const assets = path.join(data, 'assets'); mkdirSync(assets);
  symlinkSync(resources ? path.join(resources, 'forge-gui/res') : path.join(root, 'forge/forge-gui/res'), path.join(assets, 'res'), process.platform === 'win32' ? 'junction' : 'dir');
  writeFileSync(path.join(data, 'reforge.properties'), `language=en-US\nskin=mesa\nphaseStops.mine=${phases.join(',')}\nphaseStops.opponents=${phases.join(',')}\nautoPass=false\n`);
  output = '';
  child = spawn(java, ['-cp', [path.join(root, 'engine/target/test-classes'), jar].join(path.delimiter),
    'reforge.engine.DialogHarness', '--scenario', scenario, '--assets', assets, '--data', data, '--port', '0', '--exit-with-parent'], { cwd: root, windowsHide: true });
  const port = await new Promise((resolve, reject) => {
    child.on('error', reject); child.on('exit', code => reject(new Error(`Engine exited ${code}: ${output.slice(-4000)}`)));
    const append = chunk => { output = (output + chunk).slice(-16000); const match = output.match(/^READY (\d+)\r?$/m); if (match) resolve(Number(match[1])); };
    child.stdout.on('data', append); child.stderr.on('data', append);
  });
  ws = new WebSocket(`ws://127.0.0.1:${port}`);
  const messages = [];
  ws.onmessage = e => {
    const msg = JSON.parse(e.data); messages.push(msg);
    if (msg.type === 'state' && !msg.phase && msg.prompt.ok.enabled) send({ type: 'action', action: 'ok' });
  };
  await new Promise((resolve, reject) => { ws.onopen = resolve; ws.onerror = reject; });
  const peer = {
    messages,
    async wait(predicate, since = 0) {
      const end = Date.now() + 30_000;
      while (Date.now() < end) {
        const slice = messages.slice(since);
        const error = slice.find(m => m.type === 'error' || m.type === 'choice');
        if (error) throw new Error(JSON.stringify(error));
        const found = slice.find(predicate); if (found) return found;
        if (child.exitCode !== null) throw new Error(output.slice(-4000));
        await delay(20);
      }
      throw new Error(`No expected reply\n${JSON.stringify(messages.slice(-2)).slice(-4000)}\n${output.slice(-3000)}`);
    },
    last() { return messages.filter(m => m.type === 'state').at(-1); },
  };
  send({ type: 'startMatch', opponents: 1 });
  return peer;
}
function send(message) { ws.send(JSON.stringify(message)); }
const own = state => state.activePlayerId === state.players.find(p => p.isLocal).id;
const priority = m => m.type === 'state' && m.phase && m.prompt.priority && m.prompt.ok.enabled;
try {
  let peer = await boot('fastforward');
  let state = await peer.wait(m => priority(m) && !own(m) && m.stack.length > 0);
  assert.ok(state.players.find(p => p.isLocal).zones.hand.some(c => c.name === 'Shock' && c.actionable), 'human can respond');
  let since = peer.messages.length;
  send({ type: 'action', action: 'fastForward', enabled: true });
  await peer.wait(m => m.type === 'state' && m.fastForward, since);
  since = peer.messages.length;
  send({ type: 'action', action: 'fastForward', enabled: false });
  state = await peer.wait(m => priority(m) && !m.fastForward && !own(m), since);
  await delay(700);
  assert.equal(peer.last().turn, state.turn); assert.equal(peer.last().phase, state.phase, 'cancel returns control');
  since = peer.messages.length;
  send({ type: 'action', action: 'fastForward', enabled: true });
  state = await peer.wait(m => priority(m) && own(m), since);
  assert.equal(state.fastForward, false, 'yield expires before own priority');
  assert.ok(state.players.find(p => !p.isLocal).zones.battlefield.some(c => c.name === 'Hill Giant'), 'opponent spell resolved without a human response');
  assert.ok(state.players.find(p => p.isLocal).zones.hand.some(c => c.name === 'Shock'), 'response was passed, not played');
  await delay(700);
  assert.equal(peer.last().phase, state.phase, 'own turn stays manual');
  console.log('OK: real stack with a legal response, cancel, opponent spell resolution and automatic stop on own turn');
  await stop();

  peer = await boot('fastcombat');
  await peer.wait(m => priority(m) && !own(m));
  since = peer.messages.length;
  send({ type: 'action', action: 'fastForward', enabled: true });
  state = await peer.wait(m => priority(m) && m.combat.length > 0 && !m.fastForward, since);
  assert.equal(state.phase, 'COMBAT_DECLARE_ATTACKERS', 'attacker declaration interrupts before blockers');
  since = peer.messages.length;
  send({ type: 'action', action: 'ok' });
  state = await peer.wait(m => m.type === 'state' && m.phase === 'COMBAT_DECLARE_BLOCKERS' && !m.prompt.priority && m.prompt.ok.enabled, since);
  await delay(700);
  assert.equal(peer.last().phase, 'COMBAT_DECLARE_BLOCKERS', 'block decision cannot pass itself');
  const blocker = state.players.find(p => p.isLocal).zones.battlefield.find(c => c.name === 'Grizzly Bears');
  since = peer.messages.length;
  send({ type: 'action', action: 'card', id: blocker.id });
  await peer.wait(m => m.type === 'state' && m.combat.some(a => a.blockerIds.includes(blocker.id)), since);
  since = peer.messages.length;
  send({ type: 'action', action: 'ok' });
  state = await peer.wait(m => priority(m) && m.phase === 'COMBAT_DECLARE_BLOCKERS', since);
  assert.ok(state.combat.some(a => a.blockerIds.includes(blocker.id)), 'confirmed blocker remains assigned');
  console.log('OK: combat interrupts fast-forward; the human still selects blockers and confirms combat');
} catch (error) { console.error('FAIL:', error); process.exitCode = 1; }
finally { clearTimeout(timeout); await stop(); }
