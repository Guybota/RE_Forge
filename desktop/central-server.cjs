// Node-compatible utility-process entry point for the staged Next standalone server.
const fs = require('node:fs');
const path = require('node:path');
const { createRequire } = require('node:module');
const http = require('node:http');

async function main() {
  const root = process.env.RE_FORGE_CENTRAL_ROOT;
  if (!root || !fs.existsSync(path.join(root, '.next/BUILD_ID'))) throw new Error('The Central server has not been built.');
  const config = JSON.parse(fs.readFileSync(path.join(root, '.next/required-server-files.json'), 'utf8')).config;
  // Installed resources (including a read-only macOS DMG) are immutable.
  config.experimental = { ...config.experimental, isrFlushToDisk: false };
  process.env.__NEXT_PRIVATE_STANDALONE_CONFIG = JSON.stringify(config);
  process.env.NODE_ENV = 'production';
  const requireCentral = createRequire(path.join(root, 'package.json'));
  const next = requireCentral('next');
  const value = process.env.RE_FORGE_CENTRAL_PORT ?? '4317';
  const port = Number(value);
  if (!/^\d+$/.test(value) || !Number.isInteger(port) || port < 0 || port > 65535) throw new Error('Invalid Central port.');
  // Stable desktop origin preserves browser storage; port 0 is reserved for isolated tests.
  const application = next({ dev: false, dir: root, hostname: '127.0.0.1', port, customServer: true });
  await application.prepare();
  const handle = application.getRequestHandler();
  const server = http.createServer((request, response) => {
    handle(request, response).catch((error) => {
      console.error(error);
      if (!response.headersSent) response.statusCode = 500;
      response.end();
    });
  });
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, '127.0.0.1', resolve);
  });
  console.log(`CENTRAL_READY ${server.address().port}`);
  const close = () => { server.close(); void application.close(); };
  process.once('SIGTERM', close);
  process.once('SIGINT', close);
}
main().catch((error) => { console.error(error); process.exitCode = 1; });
