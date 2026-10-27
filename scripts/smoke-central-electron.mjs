// Optional native Electron check. No BrowserWindow, Java process or user profile is opened.
import { spawn } from 'node:child_process';
import { mkdtempSync, writeFileSync, existsSync, mkdirSync, copyFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import os from 'node:os';
import path from 'node:path';
import assert from 'node:assert/strict';

const root = fileURLToPath(new URL('../', import.meta.url));
const serverRoot = path.join(root, 'build/central/central');
assert.ok(existsSync(path.join(serverRoot, '.next/BUILD_ID')), 'Run npm run build first.');
const require = createRequire(import.meta.url);
const electron = require('electron');
const directory = mkdtempSync(path.join(os.tmpdir(), 'reforge-central-electron-'));
// Exercise the same ASAR entry-point layout used by the installed Electron app.
const asarSource = path.join(directory, 'wrapper');
mkdirSync(asarSource);
copyFileSync(path.join(root, 'desktop/central-server.cjs'), path.join(asarSource, 'central-server.cjs'));
await require('@electron/asar').createPackage(asarSource, path.join(directory, 'wrapper.asar'));
const wrapper = path.join(directory, 'wrapper.asar', 'central-server.cjs');
writeFileSync(path.join(directory, 'package.json'), JSON.stringify({ name: 'reforge-central-smoke', main: 'main.cjs' }));
writeFileSync(path.join(directory, 'main.cjs'), `
const { app, utilityProcess } = require('electron');
const assert = require('node:assert/strict');
app.setPath('userData', ${JSON.stringify(path.join(directory, 'profile'))});
app.disableHardwareAcceleration();
let worker;
const deadline = setTimeout(() => { if (worker) worker.kill(); app.exit(1); }, 45000);
app.whenReady().then(() => {
  worker = utilityProcess.fork(${JSON.stringify(wrapper)}, [], {
    cwd: ${JSON.stringify(serverRoot)}, stdio: 'pipe', serviceName: 'Central smoke',
    env: { ...process.env, RE_FORGE_CENTRAL_ROOT: ${JSON.stringify(serverRoot)}, RE_FORGE_CENTRAL_PORT: '0', RE_FORGE_ENGINE_PORT: '54321' },
  });
  let output = ''; let checked = false;
  worker.stderr.on('data', chunk => process.stderr.write(chunk));
  worker.stdout.on('data', async chunk => {
    output = (output + chunk).slice(-16000);
    const match = output.match(/^CENTRAL_READY (\\d+)\\r?$/m);
    if (!match || checked) return;
    checked = true;
    try {
      const base = 'http://127.0.0.1:' + match[1];
      const response = await fetch(base + '/api/play/engine', { method: 'POST' });
      assert.equal(response.status, 200); assert.equal((await response.json()).port, 54321);
      for (const route of ['/decks', '/reforge/index.html']) assert.equal((await fetch(base + route)).status, 200);
      console.log('SMOKE_CENTRAL_ELECTRON_OK');
      worker.kill();
    } catch (error) { console.error(error); worker.kill(); app.exit(1); }
  });
  worker.on('exit', code => { clearTimeout(deadline); app.exit(checked ? 0 : 1); });
}).catch(error => { console.error(error); clearTimeout(deadline); app.exit(1); });
`);
const env = { ...process.env };
delete env.ELECTRON_RUN_AS_NODE;
const child = spawn(electron, [directory], { cwd: root, env, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
let output = '', errors = '';
child.stdout.on('data', chunk => { output = (output + chunk).slice(-16_000); });
child.stderr.on('data', chunk => { errors = (errors + chunk).slice(-16_000); });
const result = await new Promise((resolve, reject) => {
  const deadline = setTimeout(() => { child.kill(); reject(new Error('Electron Central smoke timed out.')); }, 60_000);
  child.once('error', error => { clearTimeout(deadline); reject(error); });
  child.once('exit', code => { clearTimeout(deadline); resolve(code); });
});
assert.equal(result, 0, errors);
assert.match(output, /SMOKE_CENTRAL_ELECTRON_OK/, errors);
console.log('OK: native Electron utilityProcess from ASAR, loopback server, shared UI and engine reuse; no game or user data opened');
