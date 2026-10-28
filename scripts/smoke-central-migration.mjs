// Real Electron, temporary profile: a page on Central's old origin stores a library in localStorage (as Central did),
// then desktop/central-library.cjs reads it back; a taken port answers "busy", an empty origin answers null.
// Run with: npm run desktop:smoke-migration
import { spawn } from 'node:child_process';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import os from 'node:os';
import path from 'node:path';

const root = fileURLToPath(new URL('../', import.meta.url));
const require = createRequire(import.meta.url);
const electron = require('electron');
const directory = mkdtempSync(path.join(os.tmpdir(), 'reforge-central-migration-'));
const library = JSON.stringify({ version: 1, decks: [{ id: 'a', name: 'Angels', format: 'commander', commanders: [], cards: [], createdAt: '', updatedAt: '' }] });
writeFileSync(path.join(directory, 'package.json'), JSON.stringify({ name: 'reforge-migration-smoke', main: 'main.cjs' }));
writeFileSync(path.join(directory, 'main.cjs'), `
const { app, BrowserWindow } = require('electron');
const http = require('node:http');
const net = require('node:net');
const assert = require('node:assert/strict');
const { readCentralLibrary, KEY } = require(${JSON.stringify(path.join(root, 'desktop/central-library.cjs'))});
app.setPath('userData', ${JSON.stringify(path.join(directory, 'profile'))});
app.disableHardwareAcceleration();
app.on('window-all-closed', () => {});
const deadline = setTimeout(() => { console.error('timed out'); app.exit(1); }, 45000);
const freePort = () => new Promise(resolve => { const s = net.createServer().listen(0, '127.0.0.1', () => { const p = s.address().port; s.close(() => resolve(p)); }); });
const page = () => http.createServer((req, res) => { res.writeHead(200, { 'Content-Type': 'text/html' }); res.end('<!doctype html><title>old Central</title>'); });
app.whenReady().then(async () => {
  try {
    const port = await freePort();
    // The old Central stores its library on its own origin.
    const central = page();
    await new Promise(r => central.listen(port, '127.0.0.1', r));
    const writer = new BrowserWindow({ show: false });
    await writer.loadURL('http://127.0.0.1:' + port + '/');
    await writer.webContents.executeJavaScript('localStorage.setItem(' + JSON.stringify(KEY) + ', ' + JSON.stringify(${JSON.stringify(library)}) + ')');
    writer.destroy();
    await new Promise(r => central.close(r));

    const read = await readCentralLibrary({ BrowserWindow, http, port });
    assert.deepEqual(read, { status: 'ok', json: ${JSON.stringify(library)} }, 'the library comes back from the same origin');
    // The port is free again: Central can still start later on the same origin.
    const again = page();
    await new Promise((r, j) => { again.once('error', j); again.listen(port, '127.0.0.1', r); });
    assert.deepEqual(await readCentralLibrary({ BrowserWindow, http, port }), { status: 'busy' }, 'a taken port is left alone');
    await new Promise(r => again.close(r));
    assert.deepEqual(await readCentralLibrary({ BrowserWindow, http, port: await freePort() }), { status: 'ok', json: null }, 'another origin has nothing');
    console.log('MIGRATION_OK');
    clearTimeout(deadline);
    app.exit(0);
  } catch (error) {
    console.error(error.stack || error);
    app.exit(1);
  }
});
`);
const env = { ...process.env };
delete env.ELECTRON_RUN_AS_NODE; // any value, even empty, would start Electron as plain Node
const child = spawn(electron, [directory], { stdio: ['ignore', 'pipe', 'inherit'], env });
let out = '';
child.stdout.on('data', chunk => { out += chunk; });
child.on('exit', code => {
  if (code !== 0 || !out.includes('MIGRATION_OK')) {
    console.error(`FAIL: Electron exited ${code}\n${out}`);
    process.exit(1);
  }
  console.log('OK: old Central library read from its origin in a real Electron profile; taken port and empty origin');
});
