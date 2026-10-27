import { execFileSync } from 'node:child_process';
import { cpSync, existsSync, mkdirSync, rmSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { prepareCentralUi } from './prepare-central-ui.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const npm = process.env.npm_execpath;
if (!npm) throw new Error('Run this script through npm.');
prepareCentralUi();
execFileSync(process.execPath, [npm, 'run', 'build', '-w', 'mtg-central'], { cwd: root, stdio: 'inherit', windowsHide: true });
const standalone = path.join(root, 'central/.next/standalone');
if (!existsSync(path.join(standalone, 'central/server.js'))) throw new Error('Central standalone server was not generated.');
// Stage exactly the standalone tree, preserving dependencies shared at its root.
const target = path.join(root, 'build/central');
rmSync(target, { recursive: true, force: true });
mkdirSync(target, { recursive: true });
cpSync(standalone, target, { recursive: true, dereference: true });
cpSync(path.join(root, 'central/public'), path.join(target, 'central/public'), { recursive: true });
cpSync(path.join(root, 'central/.next/static'), path.join(target, 'central/.next/static'), { recursive: true });
console.log('Central server and shared RE:Forge UI staged in build/central.');
