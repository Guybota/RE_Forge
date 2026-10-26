// Real Forge permissions and native input: top-card visibility, casting with life and similar effects.
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtempSync, mkdirSync, symlinkSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const data = mkdtempSync(path.join(os.tmpdir(), 'reforge-library-'));
const assets = path.join(data, 'assets'); mkdirSync(assets);
symlinkSync(path.join(root, 'forge/forge-gui/res'), path.join(assets, 'res'), process.platform === 'win32' ? 'junction' : 'dir');
writeFileSync(path.join(data, 'reforge.properties'), 'language=en-US\nskin=mesa\n');
const java = process.env.JAVA_HOME ? path.join(process.env.JAVA_HOME, 'bin', 'java') : 'java';
const engine = spawn(java, ['-cp', [path.join(root, 'engine/target/test-classes'), path.join(root, 'engine/target/re-forge-engine.jar')].join(path.delimiter),
  'reforge.engine.DialogHarness', '--scenario', 'library', '--assets', assets, '--data', data, '--port', '0', '--exit-with-parent'], { cwd: root, windowsHide: true });
let output = '', ws, latest, messages = [], mode = 'off', revision = 0, acted = -1;
let castingSeen = false;
engine.stdout.on('data', d => { output += d; }); engine.stderr.on('data', d => { output += d; });
const send = message => ws.send(JSON.stringify(message));
const wait = async (predicate, limit = 30000) => {
  const end = Date.now() + limit;
  while (Date.now() < end) {
    const value = predicate(); if (value) return value;
    if (engine.exitCode !== null) throw Error('Engine stopped: ' + output.slice(-3000));
    await new Promise(resolve => setTimeout(resolve, 30));
  }
  throw Error(`Timed out; choices ${JSON.stringify(messages.filter(m => m.type === 'choice').map(m => ({ title: m.title, min: m.min, max: m.max, options: m.options?.map(o => o.label) })))}; last state ${JSON.stringify(latest).slice(-1800)}\n${output.slice(-1200)}`);
};
const me = state => state?.players.find(p => p.isLocal);
const timer = setTimeout(() => { console.error('FAIL: library smoke deadline'); engine.kill(); process.exit(1); }, 240000);
const tick = setInterval(() => {
  if (!latest || mode === 'off' || revision === acted) return;
  if (mode === 'opening' && me(latest)?.zones.hand.some(c => c.name === 'Naturalize')) return;
  if (mode === 'resolve' && me(latest)?.zones.battlefield.some(c => c.name === 'Sol Ring')) { mode = 'off'; return; }
  if (mode === 'resolve' && !castingSeen && !/pay|life/i.test(latest.prompt.message)) return;
  acted = revision;
  if (latest.prompt.ok.enabled) send({ type: 'action', action: 'ok' });
  else if (latest.prompt.selectable.players.length) send({ type: 'action', action: 'player', id: latest.prompt.selectable.players[0] });
}, 120);
try {
  const port = await wait(() => output.match(/^READY (\d+)$/m)?.[1], 90000);
  const progress = [...output.matchAll(/^PROGRESS (\d+)$/gm)].map(m => Number(m[1]));
  assert.ok(progress.length > 2 && progress[0] === 5 && progress.at(-1) === 95, 'native startup reports real stages');
  assert.deepEqual(progress, [...progress].sort((a, b) => a - b), 'progress never goes backwards');
  ws = new WebSocket(`ws://127.0.0.1:${port}`);
  ws.onmessage = event => {
    const m = JSON.parse(event.data); messages.push(m);
    if (m.type === 'state') { latest = m; revision++; if (m.stack.some(s => s.card?.name === 'Sol Ring')) castingSeen = true;
      if (mode === 'resolve' && process.env.SMOKE_DEBUG) console.log('CAST', m.turn, m.phase, me(m)?.libraryTop?.name, m.prompt.message, m.prompt.ok, m.stack.map(s => s.text)); }
    if (m.type === 'choice') send({ type: 'answer', id: m.id, picked: Array.from({ length: Math.max(m.kind === 'choose' && m.max === 1 && m.options?.length ? 1 : 0, m.min ?? 1) }, (_, i) => i) });
  };
  await new Promise((resolve, reject) => { ws.onopen = resolve; ws.onerror = reject; });
  const cases = [
    ['citadel', 'Forest', true], ['future', 'Forest', true], ['oracle', 'Forest', true], ['courser', 'Forest', true],
    ['mystic', 'Sol Ring', true], ['mystic-land', 'Forest', false], ['vizier', 'Llanowar Elves', true],
    ['vizier-spell', 'Sol Ring', false], ['chip', 'Sol Ring', false], ['chip-attached', 'Sol Ring', true], ['hidden', null, false],
  ];
  for (const [variant, top, playable] of cases) {
    latest = null; messages = []; mode = 'opening';
    send({ type: 'startMatch', deck: variant, opponents: 1, aiProfiles: [] });
    const state = await wait(() => latest?.phase === 'MAIN1' && !latest.gameOver && !me(latest)?.hasLost
      && latest.gameId === messages.findLast(m => m.type === 'openingCoin')?.gameId
      && me(latest)?.zones.hand.some(c => c.name === 'Naturalize') && latest.prompt.priority && latest);
    mode = 'off';
    const own = me(state), other = state.players.find(p => !p.isLocal);
    assert.equal(own.libraryTop?.name ?? null, top, `${variant}: visible top; ${JSON.stringify(messages.filter(m => m.type === 'notice'))}; board ${own.zones.battlefield.map(c => c.name)}`);
    assert.equal(!!own.libraryTop?.actionable, playable, `${variant}: native play permission`);
    assert.equal(other.libraryTop, undefined, `${variant}: unknown opponent top stays private`);
    const coins = messages.filter(m => m.type === 'openingCoin');
    assert.equal(coins.length, 1, `${variant}: exactly one native opening toss`);
    assert.ok(messages.findIndex(m => m.type === 'openingCoin') < messages.findIndex(m => m.type === 'state' && m.gameId === coins[0].gameId && m.turn >= 1), 'the native toss precedes turn one of that game');
    if (variant === 'citadel') {
      send({ type: 'action', action: 'card', id: own.libraryTop.id });
      await wait(() => me(latest)?.libraryTop?.name === 'Sol Ring' && me(latest).libraryTop.actionable && latest.prompt.priority);
      assert.equal(me(latest).life, 40, 'playing a land from Citadel does not cost life');
      mode = 'resolve';
      castingSeen = false;
      send({ type: 'action', action: 'card', id: me(latest).libraryTop.id });
      await wait(() => me(latest)?.zones.battlefield.some(c => c.name === 'Sol Ring') && me(latest).libraryTop?.name === 'Llanowar Elves');
      mode = 'off';
      assert.equal(me(latest).life, 39, 'Citadel uses native life payment equal to mana value');
    }
    send({ type: 'action', action: 'concede' });
    await wait(() => me(latest)?.hasLost || latest?.gameOver);
    console.log(`OK: ${variant}, ${top ?? 'hidden'}, playable=${playable}`);
  }
  console.log('OK: Citadel land/cast/life payment; Future Sight, Oracle, Courser, Mystic Forge, Vizier, Reality Chip; privacy, native toss ordering and startup progress');
} finally {
  clearTimeout(timer); clearInterval(tick); ws?.close(); engine.kill();
}
