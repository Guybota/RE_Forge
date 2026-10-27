// Run the same standalone server used by Electron, on the stable Central origin.
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
process.env.RE_FORGE_CENTRAL_ROOT ??= path.join(root, 'build/central/central');
process.env.RE_FORGE_ROOT ??= root;
await import('../desktop/central-server.cjs');
