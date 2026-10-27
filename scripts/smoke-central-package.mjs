// Exercise the staged production server with a supplied engine port; never launch Java.
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { existsSync, mkdtempSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));
const resources = process.argv[2] ? path.resolve(process.argv[2]) : null;
const serverRoot = resources ? path.join(resources, 'central', 'central') : path.join(root, 'build', 'central', 'central');
const wrapper = resources ? path.join(resources, 'central-server.cjs') : path.join(root, 'desktop', 'central-server.cjs');
assert.ok(existsSync(path.join(serverRoot, '.next', 'BUILD_ID')), 'build the Central production server before testing');
const data = mkdtempSync(path.join(os.tmpdir(), 'reforge-central-package-'));
const child = spawn(process.execPath, [wrapper], {
  cwd: serverRoot,
  env: { ...process.env, RE_FORGE_CENTRAL_ROOT: serverRoot, RE_FORGE_CENTRAL_PORT: '0', RE_FORGE_ENGINE_PORT: '54321', RE_FORGE_ROOT: data, RE_FORGE_DATA: data },
  windowsHide: true,
  stdio: ['ignore', 'pipe', 'pipe'],
});
let output = '';
let errors = '';
try {
  const port = await new Promise((resolve, reject) => {
    const deadline = setTimeout(() => reject(new Error(`Central startup timed out\n${output}\n${errors}`)), 45_000);
    child.stdout.on('data', chunk => {
      output = (output + chunk).slice(-16_384);
      const match = output.match(/^CENTRAL_READY (\d+)\r?$/m);
      if (match) { clearTimeout(deadline); resolve(Number(match[1])); }
    });
    child.stderr.on('data', chunk => { errors = (errors + chunk).slice(-16_384); });
    child.once('error', err => { clearTimeout(deadline); reject(err); });
    child.once('exit', code => { clearTimeout(deadline); reject(new Error(`Central exited (${code})\n${errors}`)); });
  });
  assert.ok(port > 0 && port <= 65535);
  const base = `http://127.0.0.1:${port}`;
  const engine = await fetch(`${base}/api/play/engine`, { method: 'POST' });
  assert.equal(engine.status, 200);
  assert.equal((await engine.json()).port, 54321, 'the server reuses the engine supplied by Electron');
  for (const route of ['/decks', '/play', '/reforge/index.html']) {
    const response = await fetch(`${base}${route}`);
    assert.equal(response.status, 200, `${route} is included in the staged package`);
    assert.match(response.headers.get('content-type') ?? '', /text\/html/);
    const html = await response.text();
    if (route === '/reforge/index.html') {
      const asset = html.match(/src="([^\"]+\.js)"/);
      assert.ok(asset, 'the shared game UI references a built script');
      const js = await fetch(new URL(asset[1], `${base}/reforge/index.html`));
      assert.equal(js.status, 200, 'the shared game UI assets are served');
      assert.match(await js.text(), /central:ready/, 'the package contains the current Central-aware game UI');
    }
  }
  assert.doesNotMatch(output, /^READY \d+$/m, 'the smoke test never starts another engine');
  console.log('OK: staged Central production server, shared game UI assets and Electron engine reuse');
} finally {
  child.kill();
}
