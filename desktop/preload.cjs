const { contextBridge, ipcRenderer } = require('electron');
contextBridge.exposeInMainWorld('reforge', {
  centralLibrary: () => ipcRenderer.invoke('reforge:central-library'),
});
