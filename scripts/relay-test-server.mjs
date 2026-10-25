// The same Worker and SQLite Durable Object configuration used by Wrangler; no cloud account or persistent data.
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { readFileSync } from 'node:fs';

export async function startRelay() {
  const require = createRequire(new URL('../relay/package.json', import.meta.url));
  const { Miniflare, convertV4MiniflareOptions } = require('miniflare');
  const config = JSON.parse(readFileSync(new URL('../relay/wrangler.jsonc', import.meta.url), 'utf8'));
  const mf = new Miniflare(convertV4MiniflareOptions({
    host: '127.0.0.1', port: 0,
    workers: [{
      name: 'reforge-relay',
      modules: true,
      scriptPath: fileURLToPath(new URL('../relay/src/worker.js', import.meta.url)),
      compatibilityDate: config.compatibility_date,
      durableObjects: { ROOMS: { className: 'RelayRoom', useSQLite: true } },
      ratelimits: Object.fromEntries(config.ratelimits.map(({ name, ...binding }) => [name, binding])),
    }],
  }));
  return { mf, url: (await mf.ready).origin, close: () => mf.dispose() };
}
