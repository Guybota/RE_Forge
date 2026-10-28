// The old MTG Central kept its deck library in this app's localStorage for http://127.0.0.1:<port> (4317 by
// default). To read it once, a blank page is served on that origin for a moment and a hidden window reads the key;
// Central's own code never runs, so an empty library is not seeded with example decks.

const KEY = 'mtg-central-deck-library:v1';

function listen(server, port) {
  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, '127.0.0.1', () => { server.off('error', reject); resolve(); });
  });
}

/** { status: 'ok', json } (json null when Central never stored a library), or { status: 'busy' } if the port is taken. */
async function readCentralLibrary({ BrowserWindow, http, port }) {
  const server = http.createServer((req, res) => {
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Content-Security-Policy': "default-src 'none'" });
    res.end('<!doctype html><title>RE:Forge</title>');
  });
  try { await listen(server, port); } catch { return { status: 'busy' }; }
  const win = new BrowserWindow({ show: false, webPreferences: { contextIsolation: true, sandbox: true } });
  try {
    await win.loadURL(`http://127.0.0.1:${port}/`);
    const json = await win.webContents.executeJavaScript(`localStorage.getItem(${JSON.stringify(KEY)})`);
    return { status: 'ok', json: typeof json === 'string' ? json : null };
  } finally {
    win.destroy();
    server.close();
  }
}

module.exports = { readCentralLibrary, KEY };
