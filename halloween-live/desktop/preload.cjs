const { contextBridge, ipcRenderer } = require('electron');
contextBridge.exposeInMainWorld('pivnikDesktop', Object.freeze({
  setBackend: value => ipcRenderer.invoke('live:set-backend', value),
  displays: () => ipcRenderer.invoke('live:displays'),
  showScreen: id => ipcRenderer.invoke('live:show-screen', id)
}));
