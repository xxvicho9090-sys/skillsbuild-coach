// Puente mínimo y seguro entre la web y la app de escritorio.
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('sbcNative', {
  desktop: true,
  platform: process.platform,
  ensureOllama: () => ipcRenderer.invoke('ollama:ensure'),
  reload: () => ipcRenderer.invoke('app:reload'),
  openExternal: (url) => ipcRenderer.invoke('app:open-external', url),
  onUpdate: (cb) => ipcRenderer.on('web-updated', (_e, version) => cb(version)),
});
