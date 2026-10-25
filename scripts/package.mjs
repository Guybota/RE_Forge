// Builds the Windows installer: UI + engine + a trimmed Java runtime + Forge's card data, packed by electron-builder.
// Run with: npm run package   (output in dist-app/)
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const win = process.platform === 'win32';
if (!win) throw new Error('The Windows installer must be built on Windows.');

// What the engine jar needs (jdeps --print-module-deps), plus TLS for Scryfall and locale/charset data.
const MODULES = [
  'java.base', 'java.compiler', 'java.desktop', 'java.management', 'java.naming', 'java.net.http',
  'java.scripting', 'java.security.jgss', 'java.sql', 'jdk.httpserver', 'jdk.sctp', 'jdk.unsupported',
  'jdk.crypto.ec', 'jdk.charsets', 'jdk.localedata',
];

function run(cmd, args, cwd = root) {
  console.log(`\n> ${cmd} ${args.join(' ')}`);
  execFileSync(cmd, args, { cwd, stdio: 'inherit', windowsHide: true });
}

function jdkTool(name) {
  const exe = win ? `${name}.exe` : name;
  return process.env.JAVA_HOME ? path.join(process.env.JAVA_HOME, 'bin', exe) : exe;
}

// Invoke JS entry points directly: no cmd.exe quoting, even with spaces in the JDK or checkout path.
const npm = process.env.npm_execpath;
if (!npm) throw new Error('Run this script with npm run package.');
run(process.execPath, [npm, 'run', 'build']);
run(process.execPath, [npm, 'run', 'engine:build']);

const runtime = path.join(root, 'build', 'runtime');
const signatureFile = path.join(root, 'build', 'runtime.json');
const signature = JSON.stringify({
  jdk: execFileSync(jdkTool('jlink'), ['--version'], { encoding: 'utf8' }).trim(),
  release: process.env.JAVA_HOME ? readFileSync(path.join(process.env.JAVA_HOME, 'release'), 'utf8') : '',
  modules: MODULES,
});
if (process.argv.includes('--fresh') || !existsSync(path.join(runtime, 'bin', 'java.exe'))
    || !existsSync(signatureFile) || readFileSync(signatureFile, 'utf8') !== signature) {
  rmSync(runtime, { recursive: true, force: true });
  run(jdkTool('jlink'), ['--add-modules', MODULES.join(','), '--strip-debug', '--no-man-pages',
    '--no-header-files', '--compress=zip-6', '--output', runtime]);
  writeFileSync(signatureFile, signature);
}

// Forge's CardStorageReader supports cardsfolder.zip in both data directories.
// Ship those native archives instead of tens of thousands of tiny text files.
for (const folder of ['cardsfolder', 'tokenscripts']) {
  const output = path.join(root, 'build', 'card-data', folder);
  mkdirSync(output, { recursive: true });
  run(jdkTool('jar'), ['--create', '--file', path.join(output, 'cardsfolder.zip'), '--no-manifest',
    '--date=2020-01-01T00:00:00Z', '-C', path.join(root, 'forge', 'forge-gui', 'res', folder), '.']);
}

run(process.execPath, [path.join(root, 'node_modules', 'electron-builder', 'cli.js'),
  '--win', '--x64', '--projectDir', 'desktop', '--publish', 'never']);
console.log('\nInstaller written to dist-app/');
