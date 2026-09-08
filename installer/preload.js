const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('installerAPI', {
  browseDirectory: () => ipcRenderer.invoke('browse-directory'),
  startInstall: (options) => ipcRenderer.invoke('start-install', options),
  onInstallProgress: (callback) => {
    ipcRenderer.on('install-progress', (_event, data) => callback(data));
  },
  onInstallComplete: (callback) => {
    ipcRenderer.on('install-complete', (_event, data) => callback(data));
  },
  onInstallError: (callback) => {
    ipcRenderer.on('install-error', (_event, data) => callback(data));
  },
  launchApp: () => ipcRenderer.send('launch-app'),
  closeInstaller: () => ipcRenderer.send('close-installer'),
  minimizeWindow: () => ipcRenderer.send('minimize-window'),
  getDiskSpace: (dir) => ipcRenderer.invoke('get-disk-space', dir),
  getDefaultPath: () => ipcRenderer.invoke('get-default-path')
});
