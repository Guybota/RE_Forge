// Cast real Counterspell/Stifle and select their targets by stack instance over the UI socket.
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtempSync, mkdirSync, symlinkSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const java = process.env.JAVA_HOME ? path.join(process.env.JAVA_HOME, 'bin', 'java') : 'java';
for (const variant of process.env.SMOKE_STACK_VARIANT ? [process.env.SMOKE_STACK_VARIANT] : ['counterspell', 'stifle']) await run(variant);

async function run(variant) {
  const data = mkdtempSync(path.join(os.tmpdir(), `reforge-stack-${variant}-`));
  const assets = path.join(data, 'assets'); mkdirSync(assets);
  symlinkSync(path.join(root, 'forge/forge-gui/res'), path.join(assets, 'res'), process.platform === 'win32' ? 'junction' : 'dir');
  writeFileSync(path.join(data, 'reforge.properties'), 'language=en-US\nskin=mesa\n');
  await new Promise((resolve, reject) => {
    const child = spawn(java, ['-cp', [path.join(root, 'engine/target/test-classes'), path.join(root, 'engine/target/re-forge-engine.jar')].join(path.delimiter),
      'reforge.engine.StackTargetHarness', '--assets', assets, '--data', data, '--port', '0', '--exit-with-parent'], { cwd: root, windowsHide: true });
    let output = '', ws, latest, done = false, cast = false, selected = false, counterStackSeen = false, targetId;
    let acted = '', actedAt = 0;
    const send = m => ws.send(JSON.stringify(m));
    const finish = error => {
      if (done) return; done = true; clearInterval(tick); clearTimeout(deadline); ws?.close(); child.kill();
      if (error) reject(Error(`${variant}: ${error}\n${output.slice(-3500)}`)); else resolve();
    };
    const deadline = setTimeout(() => finish('deadline'), 120_000);
    const tick = setInterval(() => {
      if (!latest || done) return;
      try {
        const m = latest, me = m.players.find(p => p.isLocal);
        const key = JSON.stringify([m.phase, m.prompt, m.stack.map(s => s.id), me.zones.hand.map(c => [c.id, c.actionable])]);
        if (key === acted && Date.now() - actedAt < 1400) return;
        acted = key; actedAt = Date.now();
        if (!cast && m.stack.length && m.prompt.priority) {
          const card = me.zones.hand.find(c => c.name === (variant === 'stifle' ? 'Stifle' : 'Counterspell'));
          if (!card) return;
          cast = true; send({ type: 'action', action: 'card', id: card.id });
        } else if (!selected && m.prompt.selectable.stack.length) {
          const ids = m.prompt.selectable.stack;
          assert.equal(ids.length, variant === 'stifle' ? 2 : 1);
          const offered = m.stack.filter(s => ids.includes(s.id));
          assert.equal(offered.length, ids.length);
          if (variant === 'stifle') {
            assert.equal(new Set(offered.map(s => s.sourceCardId)).size, 1, 'same source, separate activations');
            assert.equal(new Set(ids).size, 2, 'stack instances use distinct ids');
          }
          targetId = ids.at(-1); selected = true;
          send({ type: 'action', action: 'stack', id: targetId });
        } else if (m.prompt.ok.enabled) send({ type: 'action', action: 'ok' });
      } catch (error) { finish(error.stack); }
    }, 120);
    child.on('error', e => finish(e.message)); child.on('exit', code => { if (!done) finish(`engine exit ${code}`); });
    child.stderr.on('data', d => output += d);
    child.stdout.on('data', d => {
      output += d; const ready = output.match(/^READY (\d+)$/m); if (!ready || ws) return;
      ws = new WebSocket(`ws://127.0.0.1:${ready[1]}`);
      ws.onopen = () => send({ type: 'startMatch', deck: variant, opponents: 1 });
      ws.onmessage = event => {
        try {
          const m = JSON.parse(event.data);
          if (process.env.SMOKE_DEBUG) console.log(JSON.stringify(m));
          if (m.type === 'error' || m.type === 'notice' && m.kind === 'error') throw Error(m.message ?? m.text);
          if (m.type === 'choice') {
            // Stack targets must travel through prompt ids, rather than the legacy modal fallback.
            assert.ok(!m.options?.some(o => /Rod of Ruin|Lightning Bolt/.test(o.label)), 'no fallback stack choice');
            send({ type: 'answer', id: m.id, picked: Array.from({ length: Math.max(0, m.min ?? 0) }, (_, i) => i) });
          }
          if (m.type !== 'state') return;
          latest = m;
          if (selected && m.stack.some(s => s.card?.name === (variant === 'stifle' ? 'Stifle' : 'Counterspell'))) {
            counterStackSeen = true;
            assert.ok(m.stack[0].targetStackIds.includes(targetId), 'counter points to chosen stack instance');
          }
          if (selected && counterStackSeen && m.stack.length === 0) {
            const me = m.players.find(p => p.isLocal);
            assert.equal(me.life, variant === 'stifle' ? 39 : 40, 'selected instance is countered; other activation resolves');
            assert.ok(me.zones.graveyard.some(c => c.name === (variant === 'stifle' ? 'Stifle' : 'Counterspell')));
            console.log(`OK: ${variant}, instance target ${targetId}, stack target metadata and native resolution`);
            finish();
          }
        } catch (error) { finish(error.stack); }
      };
    });
  });
}
