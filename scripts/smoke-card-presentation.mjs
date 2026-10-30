// Current Forge abilities and public decisions, with temporary profiles in both supported UI languages.
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtempSync, mkdirSync, symlinkSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const java = process.env.JAVA_HOME ? path.join(process.env.JAVA_HOME, 'bin', 'java') : 'java';
for (const language of ['pt-BR', 'en-US']) {
  const data = mkdtempSync(path.join(os.tmpdir(), 'reforge-card-presentation-'));
  const assets = path.join(data, 'assets'); mkdirSync(assets);
  symlinkSync(path.join(root, 'forge/forge-gui/res'), path.join(assets, 'res'), process.platform === 'win32' ? 'junction' : 'dir');
  writeFileSync(path.join(data, 'reforge.properties'), `language=${language}\nskin=mesa\n`);
  const classpath = ['engine/target/test-classes', 'engine/target/re-forge-engine.jar'].map(p => path.join(root, p)).join(path.delimiter);
  const engine = spawn(java, ['-cp', classpath, 'reforge.engine.CardPresentationHarness', '--assets', assets,
    '--data', data, '--port', '0', '--exit-with-parent'], { cwd: root, windowsHide: true });
  let output = '';
  engine.stdout.on('data', chunk => { output += chunk; });
  engine.stderr.on('data', chunk => { output += chunk; });
  const timer = setTimeout(() => engine.kill(), 120_000);
  const code = await new Promise((resolve, reject) => { engine.once('exit', resolve); engine.once('error', reject); });
  clearTimeout(timer);
  assert.equal(code, 0, `${language}: ${output}`);
  assert.ok(output.includes('OK: card presentation'), output);
  console.log(`OK: ${language}: runtime abilities, named card/type/colour/number/Class level, phasing, player counters, face-down combat and hidden identities`);
}
