const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('poeArb', {
  fetchBootstrap: (route) => ipcRenderer.invoke('meta:bootstrap', route),
  fetchCatalog: (route) => ipcRenderer.invoke('meta:catalog', route),
  fetchSnapshotRoute: (route) => ipcRenderer.invoke('rates:snapshotRoute', route),
  fetchOfficialRoute: (route) => ipcRenderer.invoke('rates:officialRoute', route),
  optimizeSnapshot: (input) => ipcRenderer.invoke('rates:optimizeSnapshot', input),
  openExternal: (url) => ipcRenderer.invoke('app:openExternal', url)
});
