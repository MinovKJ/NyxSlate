const { app, BrowserWindow, ipcMain, dialog } = require('electron');
const path = require('path');
const fs = require('fs');

// Suppress EPIPE errors — prevents crash when launched from installer
// or any context where stdout/stderr pipe is closed early.
process.stdout?.on?.('error', (err) => { if (err.code !== 'EPIPE') throw err; });
process.stderr?.on?.('error', (err) => { if (err.code !== 'EPIPE') throw err; });

let mainWindow = null;

function createWindow() {
  mainWindow = new BrowserWindow({
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

  mainWindow.setFullScreen(true);

  // Prevent Escape from exiting fullscreen mode
  mainWindow.webContents.on('before-input-event', (event, input) => {
    if (input.key === 'Escape') {
      if (mainWindow && mainWindow.isFullScreen()) {
        event.preventDefault();
        mainWindow.webContents.send('escape-pressed');
      }
    }
  });

  mainWindow.loadFile(path.join(__dirname, 'index.html'));

  mainWindow.webContents.on('console-message', (event, level, message, line, sourceId) => {
    console.log(`[Renderer Line ${line}]`, message);
  });

  mainWindow.webContents.on('did-fail-load', (event, errorCode, errorDescription) => {
    console.error('did-fail-load:', errorCode, errorDescription);
  });

  // Check if a file was passed as argument (e.g., Open With on Windows)
  const args = process.argv.slice(app.isPackaged ? 1 : 2);
  const pdfArg = args.find(a => a && a.toLowerCase().endsWith('.pdf') && fs.existsSync(a));

  mainWindow.webContents.on('did-finish-load', () => {
    if (pdfArg) {
      try {
        const fileData = fs.readFileSync(pdfArg);
        mainWindow.webContents.send('open-file-from-cli', {
          name: path.basename(pdfArg),
          path: pdfArg,
          data: Array.from(fileData)
        });
      } catch (err) {
        console.error('Failed to read CLI pdf argument:', err);
      }
    }
  });

  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

// Window controls IPC
ipcMain.on('window-minimize', () => {
  if (mainWindow) mainWindow.minimize();
});

ipcMain.on('window-maximize', () => {
  if (mainWindow) {
    if (mainWindow.isMaximized()) {
      mainWindow.unmaximize();
    } else {
      mainWindow.maximize();
    }
  }
});

ipcMain.on('window-close', () => {
  if (mainWindow) mainWindow.close();
});

ipcMain.on('window-toggle-fullscreen', () => {
  if (mainWindow) {
    mainWindow.setFullScreen(!mainWindow.isFullScreen());
  }
});

// File dialog IPC
ipcMain.handle('dialog-open-file', async () => {
  if (!mainWindow) return null;
  const result = await dialog.showOpenDialog(mainWindow, {
    title: 'Select PDF Document',
    filters: [
      { name: 'PDF Documents', extensions: ['pdf'] }
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

app.whenReady().then(() => {
  createWindow();

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
