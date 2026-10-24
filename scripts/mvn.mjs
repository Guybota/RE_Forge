// Runs Maven in the current directory: the copy in .tools/maven if present, otherwise `mvn` from PATH.
import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const local = path.join(root, '.tools', 'maven', 'bin', process.platform === 'win32' ? 'mvn.cmd' : 'mvn');
const mvn = existsSync(local) ? local : 'mvn';

const result = spawnSync(mvn, process.argv.slice(2), { stdio: 'inherit', shell: process.platform === 'win32' });
process.exit(result.status ?? 1);
