import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { writableEngineAssets } from '../desktop/engine-assets.cjs';

const root = mkdtempSync(path.join(os.tmpdir(), 'reforge-assets-'));
const original = path.join(root, 'DMG/Forge');
const moved = path.join(root, 'Applications/Forge');
for (const folder of [original, moved]) {
  mkdirSync(path.join(folder, 'res'), { recursive: true });
  writeFileSync(path.join(folder, 'res/config.txt'), folder);
}
const profile = path.join(root, 'UserData/engine-assets');
assert.equal(writableEngineAssets(original, profile), profile);
writeFileSync(path.join(profile, 'forge.profile.properties'), 'userDir=temporary');
assert.equal(readFileSync(path.join(profile, 'res/config.txt'), 'utf8'), original);
assert.equal(writableEngineAssets(original, profile), profile, 'repeated launch reuses the link');
writableEngineAssets(moved, profile);
assert.equal(readFileSync(path.join(profile, 'res/config.txt'), 'utf8'), moved, 'moving the app refreshes the link');
assert.deepEqual(readdirSync(original), ['res']);
assert.deepEqual(readdirSync(moved), ['res']);
assert.equal(readFileSync(path.join(profile, 'forge.profile.properties'), 'utf8'), 'userDir=temporary');
const protectedFolder = path.join(root, 'Existing/res');
mkdirSync(protectedFolder, { recursive: true });
writeFileSync(path.join(protectedFolder, 'keep.txt'), 'keep');
assert.throws(() => writableEngineAssets(moved, path.dirname(protectedFolder)), /Expected a resource link/);
assert.equal(readFileSync(path.join(protectedFolder, 'keep.txt'), 'utf8'), 'keep');
console.log('OK: writable Forge profile, read-only bundle resources, relocation and existing-directory protection');
