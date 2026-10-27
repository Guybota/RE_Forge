const path = require('node:path');
const fs = require('node:fs');

function createCentralLauncher({ fork, serverRoot, enginePort, env = process.env, timeoutMs = 120_000 }) {
  let child = null;
  let pending = null;
  let url = null;
  return {
    open() {
      if (child && url) return Promise.resolve(url);
      if (pending) return pending;
      if (!fs.existsSync(path.join(serverRoot, '.next/BUILD_ID'))) return Promise.reject(new Error('Central is not built. Run npm run build.'));
      const started = new Promise((resolve, reject) => {
        const processHandle = fork({ ...env, NODE_ENV: 'production', RE_FORGE_CENTRAL_ROOT: serverRoot, RE_FORGE_ENGINE_PORT: String(enginePort) });
        child = processHandle;
        let settled = false;
        let output = '';
        const fail = (error) => {
          if (settled) return;
          settled = true;
          clearTimeout(timer);
          processHandle.kill();
          if (child === processHandle) { child = null; url = null; }
          reject(error);
        };
        const timer = setTimeout(() => fail(new Error('Central startup timed out.')), timeoutMs);
        processHandle.stdout.on('data', chunk => {
          output = (output + chunk).slice(-16_000);
          const match = output.match(/^CENTRAL_READY (\d+)\r?$/m);
          if (settled || !match || +match[1] < 1 || +match[1] > 65535) return;
          settled = true;
          clearTimeout(timer);
          url = `http://127.0.0.1:${match[1]}/decks`;
          resolve(url);
        });
        processHandle.stderr.on('data', chunk => console.error('[central]', String(chunk).slice(-4_000)));
        processHandle.on('error', fail);
        processHandle.on('exit', code => {
          if (child === processHandle) { child = null; url = null; }
          if (!settled) fail(new Error(`Central exited before it was ready (${code}).`));
        });
      });
      pending = started.finally(() => { pending = null; });
      return pending;
    },
    close() { if (child) child.kill(); child = null; url = null; },
  };
}
module.exports = { createCentralLauncher };
