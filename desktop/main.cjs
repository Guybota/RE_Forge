// Electron shell: starts the Forge engine bridge (Java) and opens the UI.
const { app, BrowserWindow, dialog, ipcMain, utilityProcess } = require('electron');
const { spawn } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');
const { createStartupParser, splashHtml } = require('./startup.cjs');

const isDev = !app.isPackaged && process.env.RE_FORGE_DEV === '1';

// Installed: everything ships in resources/ (see "build" in package.json). From source: the repo layout.
const paths = app.isPackaged
  ? {
      cwd: process.resourcesPath,
      java: path.join(process.resourcesPath, 'runtime', 'bin', process.platform === 'win32' ? 'java.exe' : 'java'),
      engineJar: path.join(process.resourcesPath, 'engine', 're-forge-engine.jar'),
      forgeAssets: path.join(process.resourcesPath, 'forge-gui'),
      ui: path.join(process.resourcesPath, 'ui', 'index.html'),
    }
  : {
      cwd: path.resolve(__dirname, '..'),
      java: process.env.JAVA_HOME ? path.join(process.env.JAVA_HOME, 'bin', process.platform === 'win32' ? 'java.exe' : 'java') : 'java',
      engineJar: path.resolve(__dirname, '..', 'engine', 'target', 're-forge-engine.jar'),
      forgeAssets: path.resolve(__dirname, '..', 'forge', 'forge-gui'),
      ui: path.resolve(__dirname, '..', 'ui', 'dist', 'index.html'),
    };

// The engine's output for this run (and the previous one), so a failure can be explained after the fact.
// shortcut: stops writing past 20 MB per run instead of rotating; enough for a long session.
const LOG_LIMIT = 20 * 1024 * 1024;
function openEngineLog() {
  try {
    const dir = path.join(app.getPath('userData'), 'logs');
    fs.mkdirSync(dir, { recursive: true });
    const file = path.join(dir, 'engine.log');
    if (fs.existsSync(file)) fs.renameSync(file, path.join(dir, 'engine.prev.log'));
    const stream = fs.createWriteStream(file);
    stream.on('error', () => {});
    stream.write(`RE:Forge ${app.getVersion()} — ${new Date().toISOString()}
`);
    let written = 0;
    return (chunk) => {
      if (written > LOG_LIMIT) return;
      written += chunk.length;
      stream.write(chunk);
    };
  } catch {
    return () => {};
  }
}
const engineLog = openEngineLog();

let engine = null;
let quitting = false;
let central = null;

// Starts the Java bridge and resolves with the port it printed on its READY line.
function startEngine(onProgress) {
  return new Promise((resolve, reject) => {
    const forgeAssets = app.isPackaged && process.platform === 'darwin'
      ? require('./engine-assets.cjs').writableEngineAssets(paths.forgeAssets, path.join(app.getPath('userData'), 'engine-assets'))
      : paths.forgeAssets;
    let ready = false;
    let buffer = '';
    const parseStartup = createStartupParser(onProgress, port => {
      ready = true; clearTimeout(timeout); resolve(port);
    });
    const timeout = setTimeout(() => {
      reject(new Error('Engine startup timed out (120 s)'));
    }, 120_000);
    engine = spawn(paths.java, ['-Xmx2g', '-jar', paths.engineJar, '--port', '0', '--assets', forgeAssets, '--exit-with-parent'], {
      cwd: paths.cwd,
      windowsHide: true,
      env: { ...process.env, RE_FORGE_RELAY_URL: process.env.RE_FORGE_RELAY_URL || require('./package.json').config?.relayUrl || '' },
    });
    engine.on('error', (err) => { clearTimeout(timeout); reject(err); });
    engine.on('exit', (code) => {
      engineLog(`
Engine exited with code ${code} at ${new Date().toISOString()}
`);
      clearTimeout(timeout);
      engine = null;
      const message = `Engine exited with code ${code}\n\n${buffer.slice(-4000)}`;
      if (!ready) reject(new Error(message));
      else if (!quitting) {
        dialog.showErrorBox('RE:Forge', message);
        app.quit();
      }
    });
    engine.stderr.on('data', (d) => {
      engineLog(d);
      process.stderr.write(`[engine] ${d}`);
      buffer = (buffer + d.toString()).slice(-16000);
    });
    engine.stdout.on('data', (d) => {
      engineLog(d);
      process.stdout.write(`[engine] ${d}`);
      buffer = (buffer + d.toString()).slice(-16000);
      parseStartup(d);
    });
  });
}

async function createWindow() {
  const win = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 1024,
    minHeight: 640,
    backgroundColor: '#1f3b2d',
    autoHideMenuBar: true,
    title: 'RE:Forge',
    icon: process.platform === 'win32' ? path.join(__dirname, 'icon.ico') : undefined,
    webPreferences: { contextIsolation: true, sandbox: true, preload: path.join(__dirname, 'preload.cjs') },
  });
  await win.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(splashHtml(app.getLocale()))}`);

  let port;
  try {
    port = await startEngine(value => {
      if (win.isDestroyed()) return;
      win.setProgressBar(value / 100);
      win.webContents.executeJavaScript(`document.getElementById('startup-progress').value = ${value}; document.getElementById('startup-value').textContent = '${value}%';`).catch(() => {});
    });
  } catch (err) {
    if (!quitting) dialog.showErrorBox('RE:Forge', `O motor não arrancou.\n\n${err.message}`);
    app.quit();
    return;
  }

  if (quitting) return;
  // Start Central only when requested. Its server reuses the engine this window already owns.
  if (ipcMain) ipcMain.handle('reforge:open-central', async event => {
    if (event.sender !== win.webContents || event.senderFrame !== win.webContents.mainFrame) throw new Error('Invalid Central caller.');
    if (!central) {
      const serverRoot = app.isPackaged ? path.join(process.resourcesPath, 'central', 'central') : path.join(paths.cwd, 'build', 'central', 'central');
      central = require('./central-launcher.cjs').createCentralLauncher({
        serverRoot, enginePort: port,
        fork: env => utilityProcess.fork(app.isPackaged ? path.join(process.resourcesPath, 'central-server.cjs') : path.join(__dirname, 'central-server.cjs'), [], { cwd: serverRoot, env, stdio: 'pipe', serviceName: 'MTG Central' }),
      });
    }
    return central.open();
  });
  if (isDev) {
    await win.loadURL(`http://localhost:5173/?enginePort=${port}`);
  } else {
    await win.loadFile(paths.ui, { query: { enginePort: String(port) } });
  }
  if (!win.isDestroyed()) win.setProgressBar(-1);
}

// A second launch focuses the open window instead of starting another engine.
if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on('second-instance', () => {
    const win = BrowserWindow.getAllWindows()[0];
    if (win) {
      if (win.isMinimized()) win.restore();
      win.focus();
    }
  });
  app.whenReady().then(() => {
    if (process.platform === 'win32') app.setAppUserModelId('app.reforge.desktop');
    return createWindow();
  }).catch((err) => {
    dialog.showErrorBox('RE:Forge', err.message);
    app.quit();
  });
}

app.on('window-all-closed', () => app.quit());
app.on('before-quit', () => { quitting = true; });
app.on('will-quit', () => {
  if (central) central.close();
  if (engine) engine.kill();
});
