// Launcher and bridge regressions; no Java process or user profile is touched.
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const ts = require('typescript');
const root = fileURLToPath(new URL('../', import.meta.url));
const source = path.join(root, 'central/src/lib/reforge-process.ts');
const transpile = file => ts.transpileModule(readFileSync(file, 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, esModuleInterop: true },
}).outputText;

function launcher(env = {}, platform = 'win32') {
  const children = [];
  const timers = new Set();
  const processMock = Object.assign(new EventEmitter(), {
    env: { RE_FORGE_ROOT: root, JAVA_HOME: 'C:/Java 21', ...env },
    platform, cwd: () => path.join(root, 'central'),
  });
  const mod = { exports: {} };
  vm.runInNewContext(transpile(source), {
    module: mod, exports: mod.exports, process: processMock,
    console: { log() {}, error() {}, warn() {} },
    setTimeout(fn, ms) {
      const timer = { fn, ms, unref() {} };
      timers.add(timer);
      return timer;
    },
    clearTimeout(timer) { timers.delete(timer); },
    require(name) {
      if (name === 'node:fs') return { existsSync: () => true };
      if (name === 'node:child_process') return {
        spawn(bin, args, options) {
          const child = new EventEmitter();
          child.stdout = new EventEmitter();
          child.stderr = new EventEmitter();
          child.stdout.setEncoding = child.stderr.setEncoding = () => {};
          child.stdin = { end() {} };
          child.exitCode = null;
          child.killed = false;
          child.kill = () => { child.killed = true; return true; };
          children.push({ child, bin, args, options });
          return child;
        },
      };
      return require(name);
    },
  }, { filename: source });
  return { ensure: mod.exports.ensureForgeEngine, children, timers };
}

const ready = (test, port = 43210) => {
  const child = test.children.at(-1).child;
  child.stdout.emit('data', 'Card database log\nRE');
  child.stdout.emit('data', `ADY ${port}\n`);
};

{
  const test = launcher({ RE_FORGE_DATA: 'C:/temporary/test-profile' });
  const first = test.ensure();
  const second = test.ensure();
  assert.equal(test.children.length, 1, 'concurrent requests share the engine startup');
  const call = test.children[0];
  assert.equal(call.bin, path.join('C:/Java 21', 'bin', 'java.exe'), 'Windows uses JAVA_HOME/java.exe');
  assert.equal(call.options.windowsHide, true, 'Java startup does not open a console window');
  assert.equal(call.args[call.args.indexOf('--data') + 1], 'C:/temporary/test-profile');
  ready(test);
  assert.deepEqual(await Promise.all([first, second]), [43210, 43210]);
  assert.equal(await test.ensure(), 43210, 'a ready engine is reused');
  assert.equal(test.children.length, 1);
  assert.equal(test.timers.size, 0, 'the startup deadline is cleared on readiness');
  call.child.exitCode = 1;
  call.child.emit('exit', 1);
  const again = test.ensure();
  assert.equal(test.children.length, 2, 'an exited engine can start again');
  ready(test, 43211);
  assert.equal(await again, 43211);
}

{
  const test = launcher({}, 'darwin');
  const request = test.ensure();
  assert.equal(test.children[0].bin, path.join('C:/Java 21', 'bin', 'java'), 'POSIX Java has no .exe suffix');
  ready(test);
  await request;
}

for (const failure of ['error', 'exit', 'timeout']) {
  const test = launcher();
  const first = test.ensure();
  const second = test.ensure();
  const rejected = [assert.rejects(first), assert.rejects(second)];
  const child = test.children[0].child;
  if (failure === 'error') child.emit('error', new Error('spawn ENOENT'));
  if (failure === 'exit') { child.exitCode = 7; child.emit('exit', 7); }
  if (failure === 'timeout') {
    const deadline = [...test.timers].find(timer => timer.ms === 120_000);
    assert.ok(deadline, 'startup has a bounded deadline');
    deadline.fn();
  }
  await Promise.all(rejected);
  const retry = test.ensure();
  assert.equal(test.children.length, 2, `${failure} clears the shared startup promise`);
  ready(test, 43212);
  assert.equal(await retry, 43212);
  child.exitCode = 7;
  child.emit('exit', 7);
  child.stdout.emit('data', 'READY 12345\n');
  assert.equal(await test.ensure(), 43212, 'late events from the failed child cannot replace the new engine');
  assert.equal(test.children.length, 2);
}

{
  const test = launcher({ RE_FORGE_ENGINE_PORT: '54321' });
  assert.deepEqual(await Promise.all([test.ensure(), test.ensure()]), [54321, 54321]);
  assert.equal(test.children.length, 0, 'Electron reuses its engine without another Java process');
}

for (const value of ['0', '65536', '-1', '1.5', 'abc']) {
  const test = launcher({ RE_FORGE_ENGINE_PORT: value });
  await assert.rejects(test.ensure(), `invalid external engine port ${value} is refused`);
  assert.equal(test.children.length, 0);
}

const desktopModule = { exports: {} };
vm.runInNewContext(readFileSync(path.join(root, 'desktop/central-launcher.cjs'), 'utf8'), {
  module: desktopModule, exports: desktopModule.exports,
  require: name => name === 'node:fs' ? { existsSync: () => true } : require(name),
  process: { env: {} }, setTimeout, clearTimeout, console,
});
{
  const children = [];
  const desktop = desktopModule.exports.createCentralLauncher({
    serverRoot: '/staged/central', enginePort: 54321,
    fork(env) {
      assert.equal(env.RE_FORGE_ENGINE_PORT, '54321');
      assert.equal(env.RE_FORGE_CENTRAL_ROOT, '/staged/central');
      const child = new EventEmitter();
      child.stdout = new EventEmitter(); child.stderr = new EventEmitter();
      child.kill = () => {};
      children.push(child);
      return child;
    },
  });
  const first = desktop.open(); const second = desktop.open();
  assert.equal(children.length, 1, 'concurrent desktop opens share the Next server');
  children[0].stdout.emit('data', 'CENTRAL_READY 43190\n');
  assert.deepEqual(await Promise.all([first, second]), ['http://127.0.0.1:43190/decks', 'http://127.0.0.1:43190/decks']);
  assert.equal(await desktop.open(), 'http://127.0.0.1:43190/decks');
  assert.equal(children.length, 1);
  children[0].emit('exit', 1);
  const retry = desktop.open();
  assert.equal(children.length, 2, 'an exited Central server can be restarted');
  children[1].stdout.emit('data', 'CENTRAL_READY 43191\n');
  assert.equal(await retry, 'http://127.0.0.1:43191/decks');
  desktop.close();
}
{
  const children = [];
  const desktop = desktopModule.exports.createCentralLauncher({
    serverRoot: '/staged/central', enginePort: 54321, timeoutMs: 1,
    fork() {
      const child = new EventEmitter();
      child.stdout = new EventEmitter(); child.stderr = new EventEmitter();
      child.killed = false; child.kill = () => { child.killed = true; };
      children.push(child);
      return child;
    },
  });
  await assert.rejects(desktop.open(), /timed out/);
  assert.equal(children[0].killed, true, 'a timed-out Central server is terminated');
  const retry = desktop.open();
  children[1].stdout.emit('data', 'CENTRAL_READY 43192\n');
  assert.equal(await retry, 'http://127.0.0.1:43192/decks');
  desktop.close();
}

const bridgeFile = path.join(root, 'ui/src/centralBridge.ts');
const bridgeModule = { exports: {} };
vm.runInNewContext(transpile(bridgeFile), {
  module: bridgeModule, exports: bridgeModule.exports, require,
}, { filename: bridgeFile });
const { parseCentralDeck, acceptsCentralMessage } = bridgeModule.exports;
const parent = {};
const origin = 'http://127.0.0.1:4317';
const message = { type: 'central:deck', deck: { id: 'a', name: 'Same deck name', text: 'Commander\n1 Giada, Font of Hope\n\nDeck\n99 Plains' } };
assert.equal(parseCentralDeck(message)?.id, 'a');
assert.equal(acceptsCentralMessage({ data: message, origin, source: parent }, parent, origin)?.id, 'a');
assert.equal(acceptsCentralMessage({ data: message, origin: 'https://untrusted.example', source: parent }, parent, origin), null);
assert.equal(acceptsCentralMessage({ data: message, origin, source: {} }, parent, origin), null);
for (const invalid of [null, {}, { ...message, type: 'saveDeck' }, { type: 'central:deck', deck: null },
  { ...message, deck: { ...message.deck, text: 'x'.repeat(1_000_001) } },
  { ...message, deck: { ...message.deck, id: 'x'.repeat(201) } },
  { ...message, deck: { ...message.deck, name: '' } }]) {
  assert.equal(parseCentralDeck(invalid), null, 'malformed or excessive deck messages are refused');
}
// Exercise the actual main-process IPC route, including electron-builder's external wrapper layout.
for (const packaged of [false, true]) {
  let window, finishLoad, forkedEntry;
  const handlers = new Map();
  const loaded = new Promise(resolve => { finishLoad = resolve; });
  const resources = path.join(root, 'test-resources');
  const desktop = path.join(root, 'desktop');
  class FakeWindow {
    constructor(options) {
      window = this;
      this.options = options;
      this.webContents = { mainFrame: {}, executeJavaScript: () => Promise.resolve() };
    }
    loadURL() { return Promise.resolve(); }
    loadFile() { finishLoad(); return Promise.resolve(); }
    setProgressBar() {}
    isDestroyed() { return false; }
  }
  const fakeApp = {
    isPackaged: packaged, getVersion: () => 'test', getPath: () => '/temporary/profile', getLocale: () => 'en-US',
    requestSingleInstanceLock: () => true, whenReady: () => Promise.resolve(), on() {}, quit() {}, setAppUserModelId() {},
  };
  vm.runInNewContext(readFileSync(path.join(desktop, 'main.cjs'), 'utf8'), {
    require(name) {
      if (name === 'electron') return {
        app: fakeApp, BrowserWindow: FakeWindow,
        dialog: { showErrorBox: (...args) => { throw Error(args.join(' ')); } },
        ipcMain: { handle: (name, handler) => handlers.set(name, handler) },
        utilityProcess: { fork: (entry) => { forkedEntry = entry; return {}; } },
      };
      if (name === 'node:fs') return { mkdirSync() {}, existsSync: () => false, createWriteStream: () => ({ on() {}, write() {} }) };
      if (name === 'node:child_process') return { spawn() {
        const child = new EventEmitter(); child.stdout = new EventEmitter(); child.stderr = new EventEmitter(); child.kill = () => {};
        setImmediate(() => child.stdout.emit('data', Buffer.from('READY 54321\n')));
        return child;
      } };
      if (name === './central-launcher.cjs') return { createCentralLauncher: ({ fork }) => ({ open() { fork({}); return Promise.resolve('http://127.0.0.1:4317/decks'); } }) };
      if (name.startsWith('./')) return require(path.join(desktop, name));
      return require(name);
    },
    __dirname: desktop, module: { exports: {} },
    process: { platform: 'win32', resourcesPath: resources, env: {}, stdout: { write() {} }, stderr: { write() {} } },
    setTimeout, clearTimeout, setImmediate, console,
  });
  await loaded;
  const open = handlers.get('reforge:open-central');
  assert.ok(open);
  await assert.rejects(() => open({ sender: {}, senderFrame: {} }), /Invalid Central caller/);
  await open({ sender: window.webContents, senderFrame: window.webContents.mainFrame });
  assert.equal(forkedEntry, path.join(packaged ? resources : desktop, 'central-server.cjs'), 'packaged wrapper lives in extraResources, outside ASAR');
  assert.equal(window.options.webPreferences.preload, path.join(desktop, 'preload.cjs'));
}
console.log('OK: Central engine singleton, Java paths, external engine reuse, startup retry, bounded trusted deck handoff and packaged IPC entry');
