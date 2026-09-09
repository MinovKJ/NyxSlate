const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electronAPI', {
  isElectron: true,
  minimize: () => ipcRenderer.send('window-minimize'),
  maximize: () => ipcRenderer.send('window-maximize'),
  close: () => ipcRenderer.send('window-close'),
  toggleFullscreen: () => ipcRenderer.send('window-toggle-fullscreen'),
  openFileDialog: () => ipcRenderer.invoke('dialog-open-file'),
  readFile: (filePath) => ipcRenderer.invoke('file-read', filePath),
  onFileOpened: (callback) => {
    ipcRenderer.on('open-file-from-cli', (_event, data) => callback(data));
  },
  onEscapePressed: (callback) => {
    ipcRenderer.on('escape-pressed', () => callback());
  },
  getPowerState: () => ipcRenderer.invoke('get-power-state'),
  onPowerStateChanged: (callback) => {
    ipcRenderer.on('power-state-changed', (_event, data) => callback(data));
  },
  copyFileToClipboard: (fileInfo) => ipcRenderer.invoke('copy-file-to-clipboard', fileInfo)
});
