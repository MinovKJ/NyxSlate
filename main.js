const { app, BrowserWindow, ipcMain, dialog, powerMonitor } = require('electron');
const path = require('path');
const fs = require('fs');
const { execSync } = require('child_process');

// Suppress EPIPE errors — prevents crash when launched from installer
// or any context where stdout/stderr pipe is closed early.
process.stdout?.on?.('error', (err) => { if (err.code !== 'EPIPE') throw err; });
process.stderr?.on?.('error', (err) => { if (err.code !== 'EPIPE') throw err; });

// Fixed App Name and UserData directory for 100% persistent cross-instance storage
app.name = 'NyxSlate';
const userDataPath = path.join(app.getPath('appData'), 'NyxSlate');
app.setPath('userData', userDataPath);

const configFilePath = path.join(userDataPath, 'nyx_config.json');
const recentFilesPath = path.join(userDataPath, 'recent_files.json');
const cachedDocsDir = path.join(userDataPath, 'cached_docs');

try {
  if (!fs.existsSync(userDataPath)) fs.mkdirSync(userDataPath, { recursive: true });
  if (!fs.existsSync(cachedDocsDir)) fs.mkdirSync(cachedDocsDir, { recursive: true });
} catch (e) {}

function readConfig() {
  try {
    if (fs.existsSync(configFilePath)) {
      return JSON.parse(fs.readFileSync(configFilePath, 'utf8'));
    }
  } catch (e) {}
  return {};
}

function writeConfig(cfg) {
  try {
    if (!fs.existsSync(userDataPath)) fs.mkdirSync(userDataPath, { recursive: true });
    fs.writeFileSync(configFilePath, JSON.stringify(cfg, null, 2), 'utf8');
  } catch (e) {}
}

function readRecentFiles() {
  try {
    if (fs.existsSync(recentFilesPath)) {
      return JSON.parse(fs.readFileSync(recentFilesPath, 'utf8'));
    }
  } catch (e) {}
  return [];
}

function writeRecentFiles(files) {
  try {
    if (!fs.existsSync(userDataPath)) fs.mkdirSync(userDataPath, { recursive: true });
    fs.writeFileSync(recentFilesPath, JSON.stringify(files, null, 2), 'utf8');
  } catch (e) {}
}

let mainWindow = null;

function createWindow() {
  const win = new BrowserWindow({
    width: 1360,
    height: 860,
    minWidth: 900,
    minHeight: 600,
    fullscreen: true,
    fullscreenable: true,
    backgroundColor: '#050505',
    title: 'NyxSlate',
    icon: path.join(__dirname, 'icon.png'),
    frame: true,
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      webSecurity: false
    }
  });

  if (!mainWindow) mainWindow = win;

  win.setFullScreen(true);

  // Prevent Escape from exiting fullscreen mode
  win.webContents.on('before-input-event', (event, input) => {
    if (input.key === 'Escape') {
      if (win && win.isFullScreen()) {
        event.preventDefault();
        win.webContents.send('escape-pressed');
      }
    }
  });

  win.loadFile(path.join(__dirname, 'index.html'));

  win.webContents.on('console-message', (event, level, message, line, sourceId) => {
    console.log(`[Renderer Line ${line}]`, message);
  });

  win.webContents.on('did-fail-load', (event, errorCode, errorDescription) => {
    console.error('did-fail-load:', errorCode, errorDescription);
  });

  // Check if a file was passed as argument (e.g., Open With on Windows)
  const args = process.argv.slice(app.isPackaged ? 1 : 2);
  const docArg = args.find(a => a && (a.toLowerCase().endsWith('.pdf') || a.toLowerCase().endsWith('.docx')) && fs.existsSync(a));

  win.webContents.on('did-finish-load', () => {
    if (docArg) {
      try {
        const fileData = fs.readFileSync(docArg);
        win.webContents.send('open-file-from-cli', {
          name: path.basename(docArg),
          path: docArg,
          data: Array.from(fileData)
        });
      } catch (err) {
        console.error('Failed to read CLI document argument:', err);
      }
    }
  });

  win.on('closed', () => {
    if (mainWindow === win) {
      mainWindow = null;
    }
  });

  return win;
}

// Window controls IPC
ipcMain.on('window-minimize', (event) => {
  const win = BrowserWindow.fromWebContents(event.sender) || mainWindow;
  if (win) win.minimize();
});

ipcMain.on('window-maximize', (event) => {
  const win = BrowserWindow.fromWebContents(event.sender) || mainWindow;
  if (win) {
    if (win.isMaximized()) {
      win.unmaximize();
    } else {
      win.maximize();
    }
  }
});

ipcMain.on('window-close', (event) => {
  const win = BrowserWindow.fromWebContents(event.sender) || mainWindow;
  if (win) win.close();
});

ipcMain.on('window-toggle-fullscreen', (event) => {
  const win = BrowserWindow.fromWebContents(event.sender) || mainWindow;
  if (win) {
    win.setFullScreen(!win.isFullScreen());
  }
});

// File dialog IPC
ipcMain.handle('dialog-open-file', async (event) => {
  const win = BrowserWindow.fromWebContents(event.sender) || mainWindow;
  const result = await dialog.showOpenDialog(win, {
    title: 'Select Document (PDF or DOCX)',
    filters: [
      { name: 'Supported Documents (*.pdf, *.docx)', extensions: ['pdf', 'docx'] },
      { name: 'PDF Documents (*.pdf)', extensions: ['pdf'] },
      { name: 'Word Documents (*.docx)', extensions: ['docx'] },
      { name: 'All Files (*.*)', extensions: ['*'] }
    ],
    properties: ['openFile']
  });

  if (result.canceled || !result.filePaths || result.filePaths.length === 0) {
    return null;
  }

  const filePath = result.filePaths[0];
  try {
    const fileData = fs.readFileSync(filePath);
    return {
      name: path.basename(filePath),
      path: filePath,
      data: Array.from(fileData)
    };
  } catch (err) {
    console.error('Error reading selected file:', err);
    return null;
  }
});

// Save File Dialog IPC (Asks user where to save the created or converted file)
ipcMain.handle('dialog-save-file', async (event, { defaultName, data, filters, title }) => {
  const win = BrowserWindow.fromWebContents(event.sender) || mainWindow;
  const result = await dialog.showSaveDialog(win, {
    title: title || 'Save File',
    defaultPath: defaultName || 'Converted_Document',
    filters: filters || [
      { name: 'Documents', extensions: ['pdf', 'docx', 'doc', 'pptx', 'csv', 'rtf', 'html', 'jpg', 'txt'] },
      { name: 'All Files', extensions: ['*'] }
    ]
  });

  if (result.canceled || !result.filePath) {
    return null;
  }

  try {
    const filePath = result.filePath;
    const buffer = Buffer.from(data);
    fs.writeFileSync(filePath, buffer);
    return {
      success: true,
      filePath,
      name: path.basename(filePath)
    };
  } catch (err) {
    console.error('Error saving file to disk:', err);
    return { success: false, error: err.message };
  }
});

ipcMain.handle('file-read', async (_event, filePath) => {
  try {
    if (fs.existsSync(filePath)) {
      const fileData = fs.readFileSync(filePath);
      return {
        name: path.basename(filePath),
        path: filePath,
        data: Array.from(fileData)
      };
    }
  } catch (err) {
    console.error('Error reading file by path:', err);
  }
  return null;
});

// Persistent Config Storage (Cross-instance & cross-window persistent profile)
ipcMain.handle('store-get', (_event, key) => {
  const cfg = readConfig();
  return cfg[key] !== undefined ? cfg[key] : null;
});

ipcMain.handle('store-set', (_event, key, val) => {
  const cfg = readConfig();
  cfg[key] = val;
  writeConfig(cfg);
  return true;
});

// Persistent Recent Files Storage & Disk Cache
ipcMain.handle('recent-get-all', () => {
  return readRecentFiles();
});

ipcMain.handle('recent-save', async (_event, item) => {
  try {
    const list = readRecentFiles();
    let docPath = item.path || '';

    if (item.data && (Array.isArray(item.data) || item.data instanceof Uint8Array || Buffer.isBuffer(item.data))) {
      const safeName = (item.name || 'document.pdf').replace(/[^a-zA-Z0-9._-]/g, '_');
      const docFile = path.join(cachedDocsDir, `${item.id}_${safeName}`);
      fs.writeFileSync(docFile, Buffer.from(item.data));
      docPath = docFile;
    }

    const record = {
      id: item.id,
      name: item.name,
      size: item.size,
      pageCount: item.pageCount,
      lastOpened: item.lastOpened || Date.now(),
      starred: !!item.starred,
      path: docPath
    };

    const filtered = list.filter(x => x.id !== item.id && x.name !== item.name);
    filtered.unshift(record);
    if (filtered.length > 50) {
      const removed = filtered.pop();
      if (removed.path && removed.path.startsWith(cachedDocsDir) && fs.existsSync(removed.path)) {
        try { fs.unlinkSync(removed.path); } catch (e) {}
      }
    }
    writeRecentFiles(filtered);
    return true;
  } catch (err) {
    console.error('Failed to save recent file in main process:', err);
    return false;
  }
});

ipcMain.handle('recent-delete', (_event, id) => {
  try {
    const list = readRecentFiles();
    const target = list.find(x => x.id === id);
    if (target && target.path && target.path.startsWith(cachedDocsDir) && fs.existsSync(target.path)) {
      try { fs.unlinkSync(target.path); } catch (e) {}
    }
    const filtered = list.filter(x => x.id !== id);
    writeRecentFiles(filtered);
    return true;
  } catch (e) {
    return false;
  }
});

ipcMain.handle('recent-star', (_event, id) => {
  const list = readRecentFiles();
  const item = list.find(x => x.id === id);
  if (item) {
    item.starred = !item.starred;
    writeRecentFiles(list);
  }
  return true;
});

// Battery vs AC power detection (60 FPS on Battery, 144 FPS when plugged in)
ipcMain.handle('get-power-state', () => {
  try {
    const onBattery = powerMonitor.isOnBatteryPower ? powerMonitor.isOnBatteryPower() : false;
    return { onBattery, targetFps: onBattery ? 60 : 144 };
  } catch (e) {
    return { onBattery: false, targetFps: 144 };
  }
});

// Native Windows File Clipboard Copy (Copies genuine .pdf file to Windows clipboard)
ipcMain.handle('copy-file-to-clipboard', async (_event, { name, data, filePath }) => {
  try {
    let targetPath = filePath;
    if (!targetPath || !fs.existsSync(targetPath)) {
      const shareDir = path.join(app.getPath('temp'), 'NyxSlate_Share');
      if (!fs.existsSync(shareDir)) fs.mkdirSync(shareDir, { recursive: true });
      targetPath = path.join(shareDir, name || 'document.pdf');
      if (data && Array.isArray(data)) {
        fs.writeFileSync(targetPath, Buffer.from(data));
      }
    }

    if (targetPath && fs.existsSync(targetPath)) {
      const escaped = targetPath.replace(/'/g, "''");
      execSync(`powershell -NoProfile -Command "Set-Clipboard -Path '${escaped}'"`, { windowsHide: true });
      return { success: true, path: targetPath };
    }
  } catch (err) {
    console.error('Failed to copy file to clipboard:', err);
    return { success: false, error: err.message };
  }
  return { success: false };
});

app.whenReady().then(() => {
  createWindow();

  if (powerMonitor) {
    powerMonitor.on('on-battery', () => {
      BrowserWindow.getAllWindows().forEach(w => {
        w.webContents.send('power-state-changed', { onBattery: true, targetFps: 60 });
      });
    });
    powerMonitor.on('on-ac', () => {
      BrowserWindow.getAllWindows().forEach(w => {
        w.webContents.send('power-state-changed', { onBattery: false, targetFps: 144 });
      });
    });
  }

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});
