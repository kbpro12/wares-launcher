'use strict';
const { contextBridge, ipcRenderer, webUtils } = require('electron');

const PREFIXES = ['app:', 'win:', 'shell:', 'dialog:', 'settings:', 'bg:', 'versions:', 'java:', 'profiles:', 'accounts:', 'skins:', 'game:', 'jobs:', 'content:', 'mr:', 'news:', 'data:', 'update:', 'setup:'];
const EVENTS = new Set(['job:update', 'game:state', 'game:log', 'game:error', 'profiles:changed', 'content:changed', 'win:maximized', 'update:status', 'app:trim']);

contextBridge.exposeInMainWorld('wares', {
  platform: process.platform,
  async invoke(channel, ...args) {
    if (!PREFIXES.some((p) => channel.startsWith(p))) throw new Error('Blocked channel: ' + channel);
    const r = await ipcRenderer.invoke(channel, ...args);
    if (!r.ok) { const e = new Error(r.error); e.code = r.code; throw e; }
    return r.data;
  },
  on(channel, cb) {
    if (!EVENTS.has(channel)) throw new Error('Blocked event: ' + channel);
    const fn = (_e, payload) => cb(payload);
    ipcRenderer.on(channel, fn);
    return () => ipcRenderer.removeListener(channel, fn);
  },
  pathForFile: (file) => { try { return webUtils.getPathForFile(file); } catch { return ''; } },
});
