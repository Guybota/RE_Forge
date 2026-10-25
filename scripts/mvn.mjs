// Runs Maven in the current directory: the copy in .tools/maven if present, otherwise `mvn` from PATH.
import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const local = path.join(root, '.tools', 'maven', 'bin', process.platform === 'win32' ? 'mvn.cmd' : 'mvn');
const mvn = existsSync(local) ? local : 'mvn';
const command = process.platform === 'win32' ? `"${mvn}"` : mvn;

// Pin the reactor root. mvn.cmd otherwise walks up to C:\ looking for .mvn;
// restricted shells can deny that traversal and return success without building.
const result = spawnSync(command, process.argv.slice(2), {
  cwd: root,
  env: { ...process.env, MAVEN_BASEDIR: root },
  stdio: 'inherit',
  shell: process.platform === 'win32',
});
if (result.error) console.error(result.error.message);
process.exit(result.status ?? 1);
