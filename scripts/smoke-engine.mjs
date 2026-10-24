// Smoke test: starts the engine jar, connects over WebSocket, checks the card database loaded.
// Run with: npm run engine:smoke   (after npm run engine:build)
import { spawn } from 'node:child_process';
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const java = process.env.JAVA_HOME ? path.join(process.env.JAVA_HOME, 'bin', 'java') : 'java';
const engine = spawn(java, ['-jar', path.join(root, 'engine/target/re-forge-engine.jar'),
  '--port', '0', '--assets', path.join(root, 'forge/forge-gui'), '--exit-with-parent']);
engine.stderr.pipe(process.stderr);

const timeout = setTimeout(() => fail('engine did not print READY within 120 s'), 120_000);
function fail(message) {
  engine.kill();
  console.error(`FAIL: ${message}`);
  process.exit(1);
}

let out = '';
engine.stdout.on('data', (chunk) => {
  out += chunk;
  const match = out.match(/^READY (\d+)$/m);
  if (!match) return;
  clearTimeout(timeout);
  engine.stdout.removeAllListeners('data');

  const ws = new WebSocket(`ws://127.0.0.1:${match[1]}`);
  let answered = false;
  ws.onopen = () => ws.send(JSON.stringify({ type: 'hello' }));
  ws.onerror = () => { if (!answered) fail('could not connect to the engine socket'); };
  ws.onmessage = (event) => {
    answered = true;
    const info = JSON.parse(event.data);
    try {
      assert.equal(info.type, 'engineInfo');
      assert.ok(info.cards > 20000, `expected over 20000 cards, got ${info.cards}`);
      assert.ok(info.editions > 100, `expected over 100 editions, got ${info.editions}`);
    } catch (err) {
      fail(err.message);
    }
    console.log(`OK: ${info.cards} cards, ${info.editions} editions`);
    ws.close();
    engine.kill();
  };
});
engine.on('exit', (code) => {
  if (code !== null && code !== 0 && !out.includes('READY')) fail(`engine exited with code ${code}`);
});
