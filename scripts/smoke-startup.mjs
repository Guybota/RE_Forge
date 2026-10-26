import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { EventEmitter } from 'node:events';
import { mkdtempSync, readFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';
const require = createRequire(import.meta.url);
const { createStartupParser, splashHtml } = require('../desktop/startup.cjs');
const values = [], ports = [];
const parse = createStartupParser(value => values.push(value), port => ports.push(port));
parse('Log line\nPROG'); parse('RESS 5\r\nPROGRESS 34\nPROGRESS 30\n');
parse('PROGRESS 101\nPROGRESS -1\nPROGRESS <script>\nREADY 99999\nPROGRESS 90\nRE');
parse('ADY 7777\r\nPROGRESS 95\nREADY 9999\n');
assert.deepEqual(values, [5, 34, 90], 'split lines, monotonic progress and invalid/untrusted output');
assert.deepEqual(ports, [7777], 'readiness is delivered exactly once');
assert.match(splashHtml('pt-PT'), /<progress[^>]+max="100" value="0"/);
assert.match(splashHtml('en-US'), /Loading cards and decks/);
assert.match(splashHtml('pt-PT'), /A carregar cartas e decks/);
// Exercise the real Electron startup flow without launching Java or touching the user's profile.
const desktop = fileURLToPath(new URL('../desktop/', import.meta.url));
const data = mkdtempSync(path.join(os.tmpdir(), 'reforge-startup-'));
const events = [], progressScripts = [], taskbar = [];
let loaded;
const ready = new Promise(resolve => { loaded = resolve; });
const fakeApp = {
  isPackaged: false, getVersion: () => 'test', getPath: () => data, getLocale: () => 'pt-PT',
  requestSingleInstanceLock: () => true, whenReady: () => Promise.resolve(), on() {}, quit() {}, setAppUserModelId() {},
};
class FakeWindow {
  constructor() { this.webContents = { executeJavaScript: script => { progressScripts.push(script); return Promise.resolve(); } }; }
  async loadURL(url) { assert.ok(url.startsWith('data:text/html')); events.push('splash'); }
  async loadFile(file, options) { events.push('ui'); assert.equal(options.query.enginePort, '7777'); loaded(); }
  isDestroyed() { return false; }
  setProgressBar(value) { taskbar.push(value); }
}
function fakeSpawn() {
  events.push('engine'); const child = new EventEmitter(); child.stdout = new EventEmitter(); child.stderr = new EventEmitter(); child.kill = () => {};
  setImmediate(() => child.stdout.emit('data', Buffer.from('PROGRESS 5\nPROGRESS 40\nPROGRESS 95\nREADY 7777\n')));
  return child;
}
vm.runInNewContext(readFileSync(path.join(desktop, 'main.cjs'), 'utf8'), {
  require: id => id === 'electron' ? { app: fakeApp, BrowserWindow: FakeWindow, dialog: { showErrorBox: (...args) => { throw Error(args.join(' ')); } } }
    : id === 'node:child_process' ? { spawn: fakeSpawn }
    : id.startsWith('./') ? require(path.join(desktop, id)) : require(id),
  __dirname: desktop, process: { platform: 'win32', env: {}, stdout: { write() {} }, stderr: { write() {} } },
  setTimeout, clearTimeout, console, module: { exports: {} },
});
await ready;
await new Promise(resolve => setImmediate(resolve));
assert.deepEqual(events, ['splash', 'engine', 'ui'], 'the loading bar is visible before engine startup begins');
assert.deepEqual(taskbar, [0.05, 0.4, 0.95, -1], 'the actual window receives progress and clears it after UI load');
assert.equal(progressScripts.length, 3);
assert.match(progressScripts[1], /value = 40/);
console.log('OK: real startup progress parser, split chunks, invalid values, readiness and pt/en splash');
