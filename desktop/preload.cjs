const { contextBridge, ipcRenderer } = require('electron');
contextBridge.exposeInMainWorld('reforge', {
  openCentral: () => ipcRenderer.invoke('reforge:open-central'),
});
