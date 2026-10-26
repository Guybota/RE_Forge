const fs = require('node:fs');
const path = require('node:path');

// A mounted DMG and a signed .app must stay read-only. Only the small Forge profile belongs here;
// res points at the bundled resources and is refreshed if the app moves (e.g. into /Applications).
function writableEngineAssets(bundledAssets, profileRoot) {
  const resources = path.resolve(bundledAssets, 'res');
  if (!fs.statSync(resources).isDirectory()) throw new Error('Missing bundled Forge resources');
  fs.mkdirSync(profileRoot, { recursive: true });
  const link = path.join(profileRoot, 'res');
  let existing;
  try { existing = fs.lstatSync(link); } catch (error) { if (error.code !== 'ENOENT') throw error; }
  if (existing) {
    if (!existing.isSymbolicLink()) throw new Error(`Expected a resource link, found a directory or file: ${link}`);
    if (path.resolve(path.dirname(link), fs.readlinkSync(link)) === resources) return profileRoot;
    fs.unlinkSync(link);
  }
  fs.symlinkSync(resources, link, process.platform === 'win32' ? 'junction' : 'dir');
  return profileRoot;
}

module.exports = { writableEngineAssets };
