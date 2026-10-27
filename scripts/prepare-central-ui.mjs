import { cpSync, existsSync, mkdirSync, rmSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export function prepareCentralUi() {
  const source = path.join(root, 'ui/dist');
  if (!existsSync(path.join(source, 'index.html'))) throw new Error('Build the shared UI first: npm run build:ui');
  // This generated subtree is the only target we replace.
  const target = path.join(root, 'central/public/reforge');
  rmSync(target, { recursive: true, force: true });
  mkdirSync(path.dirname(target), { recursive: true });
  cpSync(source, target, { recursive: true });
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  if (process.argv.includes('--build')) {
    const npm = process.env.npm_execpath;
    if (!npm) throw new Error('Run this script through npm.');
    execFileSync(process.execPath, [npm, 'run', 'build:ui'], { cwd: root, stdio: 'inherit', windowsHide: true });
  }
  prepareCentralUi();
}
