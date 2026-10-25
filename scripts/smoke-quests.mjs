// Adventure side quests and towns: quest offers in every town of seeded worlds driven to their rewards; town maps and shops (QuestHarness).
import { spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, symlinkSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
// Throw-away data and an assets folder of our own, so Forge's profile file is written there and nothing real is touched.
const data = mkdtempSync(path.join(os.tmpdir(), 'reforge-quests-'));
const assets = path.join(data, 'assets');
mkdirSync(assets);
symlinkSync(path.join(root, 'forge/forge-gui/res'), path.join(assets, 'res'), process.platform === 'win32' ? 'junction' : 'dir');
writeFileSync(path.join(data, 'reforge.properties'), 'language=en-US\nskin=mesa\n');
const java = process.env.JAVA_HOME ? path.join(process.env.JAVA_HOME, 'bin/java') : 'java';
const classpath = [path.join(root, 'engine/target/test-classes'), path.join(root, 'engine/target/re-forge-engine.jar')].join(path.delimiter);
const run = spawnSync(java, ['-cp', classpath, 'reforge.engine.QuestHarness', assets + path.sep, data], { cwd: root, encoding: 'utf8', timeout: 400_000 });
const lines = (run.stdout ?? '').split(/\r?\n/), ok = lines.find(line => line.startsWith('OK:'));
if (run.status !== 0 || !ok) { console.error('FAIL: quests\n' + (run.stdout ?? '').slice(-3000) + (run.stderr ?? '').slice(-5000)); process.exit(1); }
console.log(lines.filter(line => /^(Towns|OK):/.test(line)).join('\n'));
