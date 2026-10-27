// External lists never replace an owned deck, even with identical names. All state is temporary.
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtempSync, mkdirSync, symlinkSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const data = mkdtempSync(path.join(os.tmpdir(), 'reforge-central-'));
const assets = path.join(data, 'assets'); mkdirSync(assets);
symlinkSync(path.join(root, 'forge/forge-gui/res'), path.join(assets, 'res'), process.platform === 'win32' ? 'junction' : 'dir');
const java = process.env.JAVA_HOME ? path.join(process.env.JAVA_HOME, 'bin', process.platform === 'win32' ? 'java.exe' : 'java') : 'java';
const child = spawn(java, ['-jar', path.join(root, 'engine/target/re-forge-engine.jar'), '--assets', assets, '--data', data, '--port', '0', '--exit-with-parent'], { cwd: root, windowsHide: true });
let output = '', socket, latest, messages = [];
child.stdout.on('data', b => { output = (output + b).slice(-20000); });
child.stderr.on('data', b => { output = (output + b).slice(-20000); });
const deadline = setTimeout(() => { child.kill(); console.error('Central engine smoke deadline'); process.exit(1); }, 180000);
async function wait(predicate, ms = 30000) {
  const until = Date.now() + ms;
  while (Date.now() < until) {
    const value = predicate(); if (value) return value;
    if (child.exitCode !== null) throw Error(output);
    await new Promise(resolve => setTimeout(resolve, 20));
  }
  throw Error('Timed out: ' + output.slice(-2000));
}
const send = value => socket.send(JSON.stringify(value));
async function request(value, type) {
  const start = messages.length; send(value);
  return wait(() => {
    const replies = messages.slice(start);
    const error = replies.find(m => m.type === 'error');
    if (error && type !== 'error') throw Error(error.message);
    return replies.find(m => m.type === type);
  });
}
const list = (commander, land) => `Commander\n1 ${commander}\n\nDeck\n99 ${land}`;
const name = 'Same name from Central';
try {
  const port = await wait(() => output.match(/^READY (\d+)$/m)?.[1], 90000);
  socket = new WebSocket(`ws://127.0.0.1:${port}`);
  socket.onmessage = e => {
    const m = JSON.parse(e.data); messages.push(m);
    if (m.type === 'state') latest = m;
    // Native confirmations/mulligans; this is a socket bot, not the visual opening-coin gate.
    if (m.type === 'choice') send({ type: 'answer', id: m.id, picked: [0] });
  };
  await new Promise((resolve, reject) => { socket.onopen = resolve; socket.onerror = reject; });
  await request({ type: 'setLanguage', language: 'en-US' }, 'engineInfo');
  const own = list('Ezuri, Renegade Leader', 'Forest');
  await request({ type: 'saveDeck', text: own, name }, 'decks');
  const before = await request({ type: 'getDeck', name }, 'deckDetail');
  const catalog = await request({ type: 'listDecks' }, 'decks');
  const preview = await request({ type: 'previewDeck', text: list('Giada, Font of Hope', 'Plains'), name, requestId: 'current-list' }, 'deckPreview');
  assert.equal(preview.requestId, 'current-list');
  assert.equal(preview.unknown, 0);
  for (const [commander, land] of [['Giada, Font of Hope', 'Plains'], ['Krenko, Mob Boss', 'Mountain']]) {
    latest = null;
    send({ type: 'startDeckMatch', text: list(commander, land), name, opponents: 1, aiProfiles: [] });
    await wait(() => {
      const error = messages.at(-1); if (error?.type === 'error') throw Error(error.message);
      return latest?.players.some(p => p.isLocal && p.zones.command.some(c => c.name === commander));
    });
    send({ type: 'action', action: 'concede' });
    await wait(() => latest?.gameOver);
    const after = await request({ type: 'getDeck', name }, 'deckDetail');
    assert.equal(after.text, before.text, 'playing a same-name external list must not change the owned deck');
    assert.deepEqual((await request({ type: 'listDecks' }, 'decks')).mine, catalog.mine, 'no temporary deck leaks into storage');
  }
  const invalid = await request({ type: 'startDeckMatch', text: list('Giada, Font of Hope', 'Plains') + '\n1 This card does not exist', name, opponents: 1 }, 'error');
  assert.match(invalid.message, /not recognised/);
  assert.equal((await request({ type: 'getDeck', name }, 'deckDetail')).text, before.text);
  console.log('OK: request correlation, two external same-name lists, native games, no deck writes, unknown cards rejected');
} finally {
  clearTimeout(deadline); socket?.close(); child.kill();
}
