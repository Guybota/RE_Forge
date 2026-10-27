import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const npm = process.env.npm_execpath;
if (!npm) throw new Error('Run this script through npm.');
execFileSync(process.execPath, [npm, 'run', 'build:ui'], { cwd: root, stdio: 'inherit', windowsHide: true });
execFileSync(process.execPath, [path.join(root, 'scripts/build-central.mjs')], { cwd: root, stdio: 'inherit', windowsHide: true });
