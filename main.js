'use strict';
const { app, BrowserWindow, Menu, shell, session } = require('electron');
const path = require('path');
const fs = require('fs');

/* ---- must run before the app is ready */
const userData = app.getPath('userData');
try {
  const s = JSON.parse(fs.readFileSync(path.join(userData, 'config', 'settings.json'), 'utf8'));
  if (s.perf && s.perf.hardwareAcceleration === false) app.disableHardwareAcceleration();
} catch { /* first run */ }
let lowEnd = false;
try {
  const s2 = JSON.parse(fs.readFileSync(path.join(userData, 'config', 'settings.json'), 'utf8'));
  const mode = (s2.perf && s2.perf.lowEndMode) || 'auto';
  lowEnd = mode === true || (mode === 'auto' && require('os').totalmem() < 6 * 1024 ** 3) || !!(s2.perf && s2.perf.lowResource);
} catch { lowEnd = require('os').totalmem() < 6 * 1024 ** 3; }
if (lowEnd) { app.commandLine.appendSwitch('enable-low-end-device-mode'); app.commandLine.appendSwitch('renderer-process-limit', '1'); }
try {
  const s3 = JSON.parse(fs.readFileSync(path.join(userData, 'config', 'settings.json'), 'utf8'));
  if (s3.perf && s3.perf.inProcessGpu) app.commandLine.appendSwitch('in-process-gpu'); // one process less, about 50 MB saved
} catch { /* first run */ }
app.commandLine.appendSwitch('js-flags', '--max-old-space-size=256');
app.commandLine.appendSwitch('disable-features', 'Translate,MediaRouter,AutofillServerCommunication,CalculateNativeWinOcclusion');
app.commandLine.appendSwitch('disable-background-networking');

if (!app.requestSingleInstanceLock()) { app.quit(); } else {
  let win = null;

  app.on('second-instance', () => { if (win) { if (win.isMinimized()) win.restore(); win.focus(); } });

  app.whenReady().then(async () => {
    const paths = require('./src/main/paths');
    paths.init(userData);
    const settings = require('./src/main/settings');
    const profiles = require('./src/main/profiles');
    const accounts = require('./src/main/accounts');
    settings.init();
    profiles.init();
    accounts.init();

    const ipc = require('./src/main/ipc');
    ipc.register();

    session.defaultSession.setPermissionRequestHandler((_wc, _perm, cb) => cb(false));
    if (process.platform !== 'darwin') Menu.setApplicationMenu(null);

    const stateFile = path.join(paths.P.config, 'window.json');
    let st = { width: 1220, height: 780 };
    try { st = { ...st, ...JSON.parse(fs.readFileSync(stateFile, 'utf8')) }; } catch { /* defaults */ }

    win = new BrowserWindow({
      width: st.width, height: st.height, minWidth: 1000, minHeight: 640, frame: false, show: false,
      backgroundColor: '#1f2225', title: 'Wares Launcher', icon: path.join(__dirname, 'build', 'icon.png'),
      webPreferences: {
        preload: path.join(__dirname, 'preload.js'), contextIsolation: true, sandbox: true, nodeIntegration: false,
        spellcheck: false, backgroundThrottling: true, devTools: !app.isPackaged,
      },
    });
    if (st.maximized) win.maximize();
    ipc.setWindow(win);

    win.webContents.setWindowOpenHandler(({ url }) => { if (/^https:\/\//.test(url)) shell.openExternal(url); return { action: 'deny' }; });
    win.webContents.on('will-navigate', (e) => e.preventDefault());
    win.once('ready-to-show', () => win.show());
    const perfMod = require('./src/main/perf');
    const updater = require('./src/main/updater');
    updater.start();
    win.on('minimize', () => { if (settings.get().perf.trimWhenMinimized !== false) perfMod.trim(); });
    win.on('maximize', () => ipc.send('win:maximized', true));
    win.on('unmaximize', () => ipc.send('win:maximized', false));
    win.on('close', () => {
      try {
        const b = win.getNormalBounds();
        fs.writeFileSync(stateFile, JSON.stringify({ width: b.width, height: b.height, maximized: win.isMaximized() }));
      } catch { /* ignore */ }
    });
    win.on('closed', () => { win = null; });
    win.loadFile(path.join(__dirname, 'renderer', 'index.html'));

    profiles.ensureDefault().then(() => ipc.send('profiles:changed', {})).catch(() => {});
  });

  app.on('before-quit', () => {
    try { require('./src/main/store').Store.flushAll(); } catch { /* nothing to flush */ }
  });
  app.on('window-all-closed', () => app.quit());
}
