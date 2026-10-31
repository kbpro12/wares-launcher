'use strict';
const path = require('path');
const { P } = require('./paths');
const { Store } = require('./store');

const DEFAULTS = {
  theme: 'titanium',
  accent: null,
  compactRail: false,
  background: { mode: 'preset', preset: 'aurora', wallpaper: null, dim: 35, blur: 0, fps: 30, pauseUnfocused: true, pauseInGame: true, pauseOnBattery: true },
  game: { javaPath: null, jvmArgs: '', onLaunch: 'minimize', autoInstallJava: true, showConsoleOnLaunch: false },
  network: { connections: 10 },
  perf: { lowResource: false, hardwareAcceleration: true, verifyFiles: false, lowerPriorityInGame: true, trimWhenMinimized: true, lowEndMode: 'auto', inProcessGpu: false },
  updates: { auto: true, channel: 'stable' },
  lastProfile: null,
  activeAccount: null,
};

let store;
function init() { store = new Store(path.join(P.config, 'settings.json'), DEFAULTS); }
const get = () => store.get();
const patch = (p) => store.patch(p);

module.exports = { init, get, patch, DEFAULTS };
