const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('uninstallerAPI', {
  getInstallInfo: () => ipcRenderer.invoke('get-install-info'),
  startUninstall: () => ipcRenderer.invoke('start-uninstall'),
  onProgress: (callback) => {
    ipcRenderer.on('uninstall-progress', (_event, data) => callback(data));
  },
  onComplete: (callback) => {
    ipcRenderer.on('uninstall-complete', (_event, data) => callback(data));
  },
  onError: (callback) => {
    ipcRenderer.on('uninstall-error', (_event, data) => callback(data));
  },
  minimizeWindow: () => ipcRenderer.send('minimize-window'),
  closeUninstaller: () => ipcRenderer.send('close-uninstaller')
});
