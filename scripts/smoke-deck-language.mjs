// Real deck printings and deterministic image-language HTTP checks, all with temporary data.
import { spawn } from 'node:child_process';
import { mkdtempSync, writeFileSync, mkdirSync, symlinkSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const data = mkdtempSync(path.join(os.tmpdir(), 'reforge-deck-language-'));
const assets = path.join(data, 'assets'); mkdirSync(assets);
symlinkSync(path.join(root, 'forge/forge-gui/res'), path.join(assets, 'res'), process.platform === 'win32' ? 'junction' : 'dir');
writeFileSync(path.join(data, 'reforge.properties'), 'language=pt-BR\nskin=mesa\n');
const java = process.env.JAVA_HOME ? path.join(process.env.JAVA_HOME, 'bin', 'java') : 'java';
const classpath = ['engine/target/test-classes', 'engine/target/re-forge-engine.jar'].map(p => path.join(root, p)).join(path.delimiter);
const engine = spawn(java, ['-cp', classpath, 'reforge.engine.DeckLanguageHarness', '--assets', assets,
  '--data', data, '--port', '0', '--exit-with-parent'], { cwd: root });
let output = '';
const timeout = setTimeout(() => { console.error('FAIL: deck language smoke timed out'); engine.kill(); process.exitCode = 1; }, 120_000);
engine.stdout.on('data', chunk => { output += chunk; process.stdout.write(chunk); });
engine.stderr.on('data', chunk => { output += chunk; process.stderr.write(chunk); });
engine.on('error', error => { clearTimeout(timeout); console.error(error); process.exitCode = 1; });
engine.on('exit', code => {
  clearTimeout(timeout);
  if (code !== 0 || !output.includes('OK: deck languages')) process.exitCode = 1;
});
