// Electron shell: starts the Forge engine bridge (Java) and opens the UI.
const { app, BrowserWindow, dialog } = require('electron');
const { spawn } = require('node:child_process');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const isDev = !app.isPackaged && process.env.RE_FORGE_DEV === '1';
const engineJar = path.join(root, 'engine', 'target', 're-forge-engine.jar');
const forgeAssets = path.join(root, 'forge', 'forge-gui');

let engine = null;

// Starts the Java bridge and resolves with the port it printed on its READY line.
function startEngine() {
  return new Promise((resolve, reject) => {
    const java = process.env.JAVA_HOME ? path.join(process.env.JAVA_HOME, 'bin', 'java') : 'java';
    engine = spawn(java, ['-Xmx2g', '-jar', engineJar, '--port', '0', '--assets', forgeAssets, '--exit-with-parent'], { cwd: root });
    engine.on('error', reject);
    engine.on('exit', (code) => {
      engine = null;
      reject(new Error(`Engine exited with code ${code} before it was ready`));
    });
    engine.stderr.on('data', (d) => process.stderr.write(`[engine] ${d}`));
    let buffer = '';
    engine.stdout.on('data', (d) => {
      process.stdout.write(`[engine] ${d}`);
      buffer += d.toString();
      const match = buffer.match(/^READY (\d+)$/m);
      if (match) resolve(Number(match[1]));
    });
  });
}

async function createWindow() {
  let port;
  try {
    port = await startEngine();
  } catch (err) {
    dialog.showErrorBox('RE:Forge', `O motor não arrancou.\n\n${err.message}`);
    app.quit();
    return;
  }

  const win = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 1024,
    minHeight: 640,
    backgroundColor: '#141414',
    autoHideMenuBar: true,
    webPreferences: { contextIsolation: true, sandbox: true },
  });

  const query = { enginePort: String(port) };
  if (isDev) {
    win.loadURL(`http://localhost:5173/?enginePort=${port}`);
  } else {
    win.loadFile(path.join(root, 'ui', 'dist', 'index.html'), { query });
  }
}

app.whenReady().then(createWindow);

app.on('window-all-closed', () => app.quit());
app.on('will-quit', () => {
  if (engine) engine.kill();
});
