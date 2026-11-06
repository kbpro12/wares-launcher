'use strict';
const { app, BrowserWindow, Menu, Tray, nativeImage, shell, session } = require('electron');
const path = require('path');
const fs = require('fs');
const os = require('os');

/* ---- switches that must be set before the app is ready */
const userData = app.getPath('userData');
let early = {};
try { early = JSON.parse(fs.readFileSync(path.join(userData, 'config', 'settings.json'), 'utf8')); } catch { /* first run */ }
const perfCfg = early.perf || {};
if (perfCfg.hardwareAcceleration === false) app.disableHardwareAcceleration();
const lowRam = os.totalmem() < 6 * 1024 ** 3;
const lowEnd = perfCfg.lowEndMode === true || ((perfCfg.lowEndMode || 'auto') === 'auto' && lowRam) || !!perfCfg.lowResource;
if (lowEnd) { app.commandLine.appendSwitch('enable-low-end-device-mode'); app.commandLine.appendSwitch('renderer-process-limit', '1'); }
if (perfCfg.inProcessGpu) app.commandLine.appendSwitch('in-process-gpu'); // one process less, about 50 MB saved
app.commandLine.appendSwitch('js-flags', '--max-old-space-size=256');
app.commandLine.appendSwitch('disable-features', 'Translate,MediaRouter,AutofillServerCommunication,CalculateNativeWinOcclusion');
app.commandLine.appendSwitch('disable-background-networking');

if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  let win = null;
  let splash = null;
  let tray = null;
  let quitting = false;
  let background = false; // window closed while a game runs: only the tray and main process stay alive
  let M = null; // modules, loaded once the app is ready

  app.on('second-instance', () => { if (M) showWindow(); });
  app.on('activate', () => { if (M) showWindow(); });

  /* ------------------------------------------------------------ tray */
  function refreshTray() {
    if (!tray) return;
    const runs = M.launcher.listRunning();
    const items = [{ label: 'Open Wares Launcher', click: () => showWindow() }, { type: 'separator' }];
    for (const r of runs) items.push({ label: `Stop ${r.name}`, click: () => M.launcher.stop(r.profileId) });
    if (runs.length) items.push({ type: 'separator' });
    items.push({ label: 'Quit launcher (games keep running)', click: () => { quitting = true; app.quit(); } });
    tray.setContextMenu(Menu.buildFromTemplate(items));
    tray.setToolTip(runs.length ? `Wares Launcher - playing ${runs.map((r) => r.name).join(', ')}` : 'Wares Launcher');
  }

  function ensureTray() {
    if (tray) return;
    const img = nativeImage.createFromPath(path.join(__dirname, 'build', 'icon.png')).resize({ width: 16, height: 16 });
    tray = new Tray(img);
    tray.on('click', () => showWindow());
    tray.on('double-click', () => showWindow());
    refreshTray();
  }

  function destroyTray() { if (tray) { tray.destroy(); tray = null; } }

  /* ---------------------------------------------------------- window */
  function shouldGoBackground() {
    return !quitting && M.launcher.activeCount() > 0 && M.settings.get().game.onClose !== 'quit';
  }

  function goBackground() {
    background = true;
    ensureTray();
    if (win && !win.isDestroyed()) win.destroy(); // frees the whole renderer process
    try { if (tray && process.platform === 'win32') tray.displayBalloon({ title: 'Wares Launcher', content: 'Still running in the background while Minecraft plays. Click the tray icon to open it again.' }); } catch { /* optional */ }
  }

  function showWindow() {
    background = false;
    destroyTray();
    if (win && !win.isDestroyed()) {
      if (win.isMinimized()) win.restore();
      win.show();
      win.focus();
    } else createWindow({ withSplash: false });
  }

  function createWindow({ withSplash }) {
    const stateFile = path.join(M.paths.P.config, 'window.json');
    let st = { width: 1220, height: 780 };
    try { st = { ...st, ...JSON.parse(fs.readFileSync(stateFile, 'utf8')) }; } catch { /* defaults */ }

    if (withSplash) {
      splash = new BrowserWindow({
        width: 440, height: 280, frame: false, resizable: false, show: false, backgroundColor: '#1d2024', title: 'Wares Launcher',
        icon: path.join(__dirname, 'build', 'icon.png'), webPreferences: { sandbox: true, contextIsolation: true, devTools: false },
      });
      splash.loadFile(path.join(__dirname, 'splash.html'));
      splash.once('ready-to-show', () => {
        if (!splash || splash.isDestroyed()) return;
        splash.show();
        splash.webContents.executeJavaScript(`setVersion(${JSON.stringify('v' + app.getVersion())});setStatus('Loading')`).catch(() => {});
      });
    }

    const w = new BrowserWindow({
      width: st.width, height: st.height, minWidth: 1000, minHeight: 640, frame: false, show: false,
      backgroundColor: '#1f2225', title: 'Wares Launcher', icon: path.join(__dirname, 'build', 'icon.png'),
      webPreferences: {
        preload: path.join(__dirname, 'preload.js'), contextIsolation: true, sandbox: true, nodeIntegration: false,
        spellcheck: false, backgroundThrottling: true, devTools: !app.isPackaged,
      },
    });
    win = w;
    M.ipc.setWindow(w);

    w.webContents.setWindowOpenHandler(({ url }) => { if (/^https:\/\//.test(url)) shell.openExternal(url); return { action: 'deny' }; });
    w.webContents.on('will-navigate', (e) => e.preventDefault());

    let shown = false;
    const reveal = () => {
      if (shown || w.isDestroyed()) return;
      shown = true;
      if (st.maximized) w.maximize();
      w.show();
      w.focus();
      if (splash && !splash.isDestroyed()) setTimeout(() => { if (splash && !splash.isDestroyed()) splash.close(); splash = null; }, 120);
    };
    M.ipc.onReady(reveal);
    setTimeout(reveal, 15000); // never leave the user staring at the splash
    w.webContents.once('did-start-loading', () => { if (splash && !splash.isDestroyed()) splash.webContents.executeJavaScript("setStatus('Starting interface')").catch(() => {}); });

    w.on('minimize', () => { if (M.settings.get().perf.trimWhenMinimized !== false) M.perf.trim(); });
    w.on('maximize', () => M.ipc.send('win:maximized', true));
    w.on('unmaximize', () => M.ipc.send('win:maximized', false));
    w.on('close', (e) => {
      try {
        const b = w.getNormalBounds();
        fs.writeFileSync(stateFile, JSON.stringify({ width: b.width, height: b.height, maximized: w.isMaximized() }));
      } catch { /* ignore */ }
      if (shouldGoBackground()) { e.preventDefault(); goBackground(); }
    });
    w.on('closed', () => { if (win === w) { win = null; M.ipc.setWindow(null); } });
    w.loadFile(path.join(__dirname, 'renderer', 'index.html'));
  }

  /* ----------------------------------------------------------- start */
  app.whenReady().then(async () => {
    const paths = require('./src/main/paths');
    paths.init(userData, paths.readLocation(userData));
    const settings = require('./src/main/settings');
    const profiles = require('./src/main/profiles');
    const accounts = require('./src/main/accounts');
    settings.init();
    profiles.init();
    accounts.init();

    const ipc = require('./src/main/ipc');
    ipc.register();
    M = { paths, settings, profiles, ipc, launcher: require('./src/main/launcher'), perf: require('./src/main/perf'), updater: require('./src/main/updater') };

    session.defaultSession.setPermissionRequestHandler((_wc, _perm, cb) => cb(false));
    if (process.platform !== 'darwin') Menu.setApplicationMenu(null);

    // Games keep running after the launcher closes; when the last one ends in background mode, exit too.
    M.launcher.onActive((count) => {
      refreshTray();
      if (background && count === 0) { quitting = true; app.quit(); }
    });

    createWindow({ withSplash: true });
    M.updater.start();
    M.launcher.restore().catch(() => {}); // re-attach to games started by an earlier session
    profiles.ensureDefault().then(() => ipc.send('profiles:changed', {})).catch(() => {});
  });

  app.on('before-quit', () => {
    quitting = true;
    try { require('./src/main/store').Store.flushAll(); } catch { /* nothing to flush */ }
  });
  app.on('window-all-closed', () => { if (!background) app.quit(); });
}
