// Actual Forge Scry/Surveil/Explore callbacks, including the one-card prompt and native answer contracts.
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtempSync, mkdirSync, symlinkSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const data = mkdtempSync(path.join(os.tmpdir(), 'reforge-look-'));
const assets = path.join(data, 'assets'); mkdirSync(assets);
symlinkSync(path.join(root, 'forge/forge-gui/res'), path.join(assets, 'res'), process.platform === 'win32' ? 'junction' : 'dir');
writeFileSync(path.join(data, 'reforge.properties'), `language=${process.env.SMOKE_LANGUAGE ?? 'en-US'}\nskin=mesa\n`);
const java = process.env.JAVA_HOME ? path.join(process.env.JAVA_HOME, 'bin', 'java') : 'java';
const child = spawn(java, ['-cp', [path.join(root, 'engine/target/test-classes'), path.join(root, 'engine/target/re-forge-engine.jar')].join(path.delimiter),
  'reforge.engine.DialogHarness', '--scenario', 'look', '--assets', assets, '--data', data, '--port', '0', '--exit-with-parent'], { cwd: root, windowsHide: true });
let output = '', ws, done = false, latest, stage = 0, nativeSingle = 0, lastNative = '';
const send = m => ws.send(JSON.stringify(m));
const deadline = setTimeout(() => fail('deadline'), 120000);
function fail(message) { if (done) return; done = true; console.error('FAIL:', message, output.slice(-2000)); finish(1); }
function finish(code) { clearTimeout(deadline); clearInterval(tick); ws?.close(); child.kill(); process.exitCode = code; }
child.on('error', e => fail(e.message)); child.on('exit', code => { if (!done) fail('engine exit ' + code); });
child.stderr.on('data', d => output += d);
child.stdout.on('data', d => {
  output += d; const ready = output.match(/^READY (\d+)$/m); if (!ready || ws) return;
  ws = new WebSocket(`ws://127.0.0.1:${ready[1]}`);
  ws.onopen = () => send({ type: 'startMatch', opponents: 1 });
  ws.onmessage = event => { try { handle(JSON.parse(event.data)); } catch (e) { fail(e.stack); } };
});
function handle(m) {
  if (m.type === 'error' || m.type === 'notice' && m.kind === 'error') throw Error(m.message ?? m.text);
  if (m.type === 'notice' && m.text === 'LOOK CHOICES OK') {
    assert.equal(stage, 4); assert.equal(nativeSingle, 2);
    done = true; console.log('OK: native Scry, Surveil 1/2/3, ordered survivors and Explore use the shared interface; hidden library cards stay hidden'); finish(0); return;
  }
  if (m.type === 'choice') {
    let picked;
    if (m.kind === 'arrange') {
      assert.deepEqual(m.movable, [0, 1]);
      assert.ok(m.options.slice(2).every(o => o.card.hidden && !o.card.name));
      picked = [1, ...m.options.map((_, i) => i).slice(2), 0]; stage++;
    } else if (m.placement === 'graveyard') { picked = [m.options.length === 3 ? 1 : 0]; stage++; }
    else if (m.placement === 'top') { picked = [1, 0]; stage++; }
    else picked = Array.from({ length: Math.max(0, m.min ?? 0) }, (_, i) => i);
    send({ type: 'answer', id: m.id, picked }); return;
  }
  if (m.type !== 'state') return;
  latest = m;
  if (m.prompt.placement) {
    const key = `${m.prompt.message}:${m.prompt.placement.card.id}`;
    if (key === lastNative) { latest = null; return; }
    lastNative = key;
    assert.equal(m.prompt.placement.destination, 'graveyard');
    assert.ok(m.prompt.placement.card.name && !m.prompt.placement.card.hidden);
    if (nativeSingle === 0) assert.equal(m.prompt.placement.moveAction, 'cancel', 'Surveil keeps on Yes and moves on No');
    else assert.equal(m.prompt.placement.moveAction, 'ok', 'Explore moves on Yes');
    nativeSingle++;
    send({ type: 'action', action: m.prompt.placement.moveAction });
    latest = null;
  }
}
const tick = setInterval(() => {
  if (!latest || latest.players.some(p => p.isLocal && p.zones.hand.some(c => c.name === 'Preordain')) || !ws) return;
  const state = latest; latest = null;
  if (state.prompt.ok.enabled) send({ type: 'action', action: 'ok' });
  else if (state.prompt.selectable.players.length) send({ type: 'action', action: 'player', id: state.prompt.selectable.players[0] });
}, 120);
