// Real deck storage, translations, partners and same-name origins; never uses the owner's data.
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtempSync, mkdirSync, symlinkSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const data = mkdtempSync(path.join(os.tmpdir(), 'reforge-deck-picker-'));
const assets = path.join(data, 'assets'); mkdirSync(assets);
symlinkSync(path.join(root, 'forge/forge-gui/res'), path.join(assets, 'res'), process.platform === 'win32' ? 'junction' : 'dir');
const java = process.env.JAVA_HOME ? path.join(process.env.JAVA_HOME, 'bin', 'java') : 'java';
const child = spawn(java, ['-jar', path.join(root, 'engine/target/re-forge-engine.jar'), '--assets', assets, '--data', data, '--port', '0', '--exit-with-parent'], { cwd: root, windowsHide: true });
let output = '', socket, messages = [], latest;
child.stdout.on('data', value => output += value); child.stderr.on('data', value => output += value);
const wait = async (predicate, timeout = 30000) => {
  const end = Date.now() + timeout;
  while (Date.now() < end) { const value = predicate(); if (value) return value; if (child.exitCode !== null) throw Error(output.slice(-1500)); await new Promise(resolve => setTimeout(resolve, 30)); }
  throw Error('Timed out: ' + output.slice(-1000));
};
const send = m => socket.send(JSON.stringify(m));
const request = async (m, type) => { const since = messages.length; send(m); return wait(() => {
  const replies = messages.slice(since), error = replies.find(m => m.type === 'error'); if (error) throw Error(error.message);
  return replies.find(m => m.type === type);
}); };
const deadline = setTimeout(() => { child.kill(); console.error('Deck picker smoke deadline'); process.exit(1); }, 180000);
try {
  const port = await wait(() => output.match(/^READY (\d+)$/m)?.[1], 90000);
  socket = new WebSocket(`ws://127.0.0.1:${port}`);
  socket.onmessage = e => { const m = JSON.parse(e.data); messages.push(m); if (m.type === 'state') latest = m; };
  await new Promise((resolve, reject) => { socket.onopen = resolve; socket.onerror = reject; });
  await request({ type: 'setLanguage', language: 'en-US' }, 'engineInfo');
  const catalog = await request({ type: 'listDecks' }, 'decks');
  assert.equal(catalog.summaries.length, catalog.mine.length + catalog.commander.length);
  assert.ok(catalog.summaries.length > 100);
  for (const summary of catalog.summaries) {
    assert.ok(summary.commanders.length > 0 && summary.commanders.every(c => c.imageKey.startsWith('c:')));
    assert.equal(summary.identity, summary.commanders.reduce((n, c) => n | c.identity, 0));
    assert.ok(summary.cards >= 99);
  }
  assert.ok(catalog.summaries.some(d => d.commanders.length > 1), 'partners and backgrounds are retained');
  await request({ type: 'setLanguage', language: 'pt-BR' }, 'engineInfo');
  const localized = await request({ type: 'listDecks' }, 'decks');
  assert.ok(localized.summaries.some(d => d.commanders.some(c => c.name !== c.nameEn)), 'native translated commander names');
  const precon = catalog.summaries[0], name = precon.name;
  const saved = await request({ type: 'saveDeck', name, text: 'Commander\n1 Ezuri, Renegade Leader\n\nDeck\n99 Forest' }, 'decks');
  const own = saved.summaries.find(d => d.name === name && d.source === 'mine');
  assert.equal(own.cards, 100); assert.equal(own.identity, 16); assert.equal(own.commanders[0].nameEn, 'Ezuri, Renegade Leader');
  assert.equal(saved.summaries.filter(d => d.name === name).length, 2, 'same names keep both origins');
  for (const source of ['mine', 'precon']) {
    latest = null;
    send({ type: 'startMatch', deck: name, deckSource: source, opponents: 1, aiProfiles: [] });
    const expected = source === 'mine' ? own.commanders : precon.commanders;
    await wait(() => latest?.players.some(p => p.isLocal && expected.every(c => p.zones.command.some(card => card.imageKey === c.imageKey))));
    send({ type: 'action', action: 'concede' });
    // Conceding requires Forge's confirmation, even during the opening mulligan.
    const start = Date.now();
    while (!latest?.gameOver && !latest?.players.some(p => p.isLocal && p.hasLost)) {
      if (Date.now() - start > 15000) throw Error('concede timed out');
      const choice = messages.findLast(m => m.type === 'choice');
      if (choice) send({ type: 'answer', id: choice.id, picked: [0] });
      await new Promise(resolve => setTimeout(resolve, 100));
    }
  }
  await request({ type: 'deleteDeck', name }, 'decks');
  const deleted = await request({ type: 'listDecks' }, 'decks');
  assert.ok(!deleted.summaries.some(d => d.source === 'mine'));
  assert.ok(deleted.summaries.some(d => d.source === 'precon' && d.name === name));
  console.log('OK: native summaries, partner identities, translations, same-name deck selection for both origins and deletion');
  console.log('Temporary data: ' + data);
} finally { clearTimeout(deadline); socket?.close(); child.kill(); }
