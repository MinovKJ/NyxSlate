const { app, BrowserWindow, ipcMain } = require('electron');
const path = require('path');
const fs = require('fs');
const { execSync, spawn } = require('child_process');

// Suppress EPIPE
process.stdout?.on?.('error', (err) => { if (err.code !== 'EPIPE') throw err; });
process.stderr?.on?.('error', (err) => { if (err.code !== 'EPIPE') throw err; });

let uninstallerWindow = null;
const installDir = __dirname; // uninstaller-main.js is in the install dir itself

function createWindow() {
  uninstallerWindow = new BrowserWindow({
    width: 560,
    height: 520,
    resizable: false,
    maximizable: false,
    fullscreenable: false,
    frame: false,
    transparent: true,
    backgroundColor: '#00000000',
    title: 'Uninstall NyxSlate',
    icon: path.join(installDir, 'icon.ico'),
    webPreferences: {
      preload: path.join(__dirname, 'uninstaller-preload.js'),
      contextIsolation: true,
      nodeIntegration: false
    }
  });

  uninstallerWindow.loadFile(path.join(__dirname, 'uninstaller.html'));

  uninstallerWindow.on('closed', () => {
    uninstallerWindow = null;
  });
}

// ── Helpers ──────────────────────────────────────────────────────────────────

function getInstalledSize() {
  let size = 0;
  try {
    function walk(dir) {
      if (!fs.existsSync(dir)) return;
      const entries = fs.readdirSync(dir, { withFileTypes: true });
      for (const entry of entries) {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) walk(full);
        else size += fs.statSync(full).size;
      }
    }
    walk(installDir);
  } catch (e) { /* ignore */ }
  return size;
}

function countInstalledFiles() {
  let count = 0;
  try {
    function walk(dir) {
      if (!fs.existsSync(dir)) return;
      const entries = fs.readdirSync(dir, { withFileTypes: true });
      for (const entry of entries) {
        if (entry.isDirectory()) walk(path.join(dir, entry.name));
        else count++;
      }
    }
    walk(installDir);
  } catch (e) { /* ignore */ }
  return count;
}

// ── IPC Handlers ─────────────────────────────────────────────────────────────

ipcMain.on('minimize-window', () => {
  if (uninstallerWindow) uninstallerWindow.minimize();
});

ipcMain.on('close-uninstaller', () => {
  if (uninstallerWindow) uninstallerWindow.close();
  app.quit();
});

ipcMain.handle('get-install-info', () => {
  const size = getInstalledSize();
  const fileCount = countInstalledFiles();
  return {
    installPath: installDir,
    sizeMB: (size / (1024 * 1024)).toFixed(1),
    fileCount
  };
});

ipcMain.handle('start-uninstall', async () => {
  try {
    const currentPid = process.pid;

    // Step 0: Terminate any running NyxSlate application instances (other than this uninstaller)
    try {
      execSync(`powershell -NoProfile -Command "Get-Process -Name NyxSlate, electron -ErrorAction SilentlyContinue | Where-Object { $_.Id -ne ${currentPid} } | Stop-Process -Force -ErrorAction SilentlyContinue"`, {
        windowsHide: true,
        stdio: 'ignore'
      });
    } catch (e) { /* ignore */ }

    // Step 1: Remove shortcuts silently using native node fs
    uninstallerWindow.webContents.send('uninstall-progress', {
      percent: 15,
      status: 'Removing shortcuts...'
    });

    const desktopShortcut = path.join(process.env.USERPROFILE || '', 'Desktop', 'NyxSlate.lnk');
    if (fs.existsSync(desktopShortcut)) {
      try { fs.unlinkSync(desktopShortcut); } catch (e) {}
    }

    const startMenuShortcut = path.join(
      process.env.APPDATA || '',
      'Microsoft', 'Windows', 'Start Menu', 'Programs', 'NyxSlate.lnk'
    );
    if (fs.existsSync(startMenuShortcut)) {
      try { fs.unlinkSync(startMenuShortcut); } catch (e) {}
    }

    const startMenuUninstallShortcut = path.join(
      process.env.APPDATA || '',
      'Microsoft', 'Windows', 'Start Menu', 'Programs', 'Uninstall NyxSlate.lnk'
    );
    if (fs.existsSync(startMenuUninstallShortcut)) {
      try { fs.unlinkSync(startMenuUninstallShortcut); } catch (e) {}
    }

    // Step 2: Remove registry entries silently in ONE hidden PowerShell call
    uninstallerWindow.webContents.send('uninstall-progress', {
      percent: 40,
      status: 'Cleaning registry entries...'
    });

    const regScript = `
      Remove-Item -Path 'HKCU:\\Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\NyxSlate' -Recurse -Force -ErrorAction SilentlyContinue
      Remove-Item -Path 'HKCU:\\Software\\Classes\\NyxSlate.PDF' -Recurse -Force -ErrorAction SilentlyContinue
      Remove-Item -Path 'HKCU:\\Software\\Classes\\Applications\\electron.exe' -Recurse -Force -ErrorAction SilentlyContinue
      Remove-Item -Path 'HKCU:\\Software\\Classes\\Applications\\NyxSlate.exe' -Recurse -Force -ErrorAction SilentlyContinue
      Remove-Item -Path 'HKCU:\\Software\\NyxSlate' -Recurse -Force -ErrorAction SilentlyContinue
      Remove-ItemProperty -Path 'HKCU:\\Software\\RegisteredApplications' -Name 'NyxSlate' -ErrorAction SilentlyContinue
      Remove-ItemProperty -Path 'HKCU:\\Software\\Classes\\.pdf\\OpenWithProgids' -Name 'NyxSlate.PDF' -ErrorAction SilentlyContinue
      Remove-ItemProperty -Path 'HKCU:\\Software\\Microsoft\\Windows\\CurrentVersion\\Explorer\\FileExts\\.pdf\\OpenWithProgids' -Name 'NyxSlate.PDF' -ErrorAction SilentlyContinue
      Remove-Item -Path 'HKCU:\\Software\\Microsoft\\Windows\\CurrentVersion\\App Paths\\NyxSlate.exe' -Recurse -Force -ErrorAction SilentlyContinue
      try {
        $pdf = (Get-ItemProperty -Path 'HKCU:\\Software\\Classes\\.pdf' -ErrorAction SilentlyContinue).'(default)'
        if ($pdf -eq 'NyxSlate.PDF') {
          Remove-Item -Path 'HKCU:\\Software\\Classes\\.pdf' -Recurse -Force -ErrorAction SilentlyContinue
        }
      } catch {}
      try {
        $sig = @'
        [DllImport("shell32.dll")]
        public static extern void SHChangeNotify(int wEventId, uint uFlags, IntPtr dwItem1, IntPtr dwItem2);
'@
        $t = Add-Type -MemberDefinition $sig -Name 'Win32SHUn' -Namespace 'Win32' -PassThru
        $t::SHChangeNotify(0x08000000, 0, [IntPtr]::Zero, [IntPtr]::Zero)
      } catch {}
    `;

    try {
      execSync(`powershell -NoProfile -WindowStyle Hidden -Command "${regScript.replace(/\r?\n/g, '; ').replace(/"/g, '\\"')}"`, {
        windowsHide: true,
        stdio: 'ignore'
      });
    } catch (e) { /* ignore */ }

    // Step 3: Remove application files immediately (delete all non-locked files)
    uninstallerWindow.webContents.send('uninstall-progress', {
      percent: 70,
      status: 'Removing application files...'
    });

    function cleanDirRecursive(dir) {
      if (!fs.existsSync(dir)) return;
      let entries = [];
      try {
        entries = fs.readdirSync(dir, { withFileTypes: true });
      } catch (e) { return; }

      for (const entry of entries) {
        const fullPath = path.join(dir, entry.name);
        // Do not delete uninstaller scripts while actively executing
        if (dir === installDir && (entry.name === 'uninstaller-main.js' || entry.name === 'uninstaller.html' || entry.name === 'uninstaller-preload.js')) {
          continue;
        }
        try {
          if (entry.isDirectory()) {
            cleanDirRecursive(fullPath);
            try { fs.rmdirSync(fullPath); } catch (e) {}
          } else {
            fs.unlinkSync(fullPath);
          }
        } catch (e) {
          // File might be locked by current Electron process (e.g. NyxSlate.exe, electron.dll)
        }
      }
    }

    try {
      cleanDirRecursive(installDir);
    } catch (e) { /* ignore */ }

    // Step 4: Schedule background cleanup script in %TEMP% using Windows rmdir /s /q
    uninstallerWindow.webContents.send('uninstall-progress', {
      percent: 90,
      status: 'Finalizing uninstallation...'
    });

    const tempDir = process.env.TEMP || 'C:\\Windows\\Temp';
    const cleanupBatPath = path.join(tempDir, `nyxslate_uninst_${Date.now()}.bat`);
    const cleanupBatScript = `@echo off
setlocal
set "TARGET=${installDir.replace(/"/g, '')}"
set "UNINSTALLER_PID=${currentPid}"

:: Wait for uninstaller main process to exit
if not "%UNINSTALLER_PID%"=="" (
    powershell -NoProfile -Command "try { Wait-Process -Id %UNINSTALLER_PID% -Timeout 120 -ErrorAction SilentlyContinue } catch {}" >nul 2>&1
)

:: Small delay to allow OS to release all executable and DLL locks
timeout /t 1 /nobreak >nul

:: Force kill any lingering Electron child processes
taskkill /F /IM NyxSlate.exe >nul 2>&1
taskkill /F /IM electron.exe >nul 2>&1

:: Switch working directory to TEMP so we do not hold a lock on TARGET
cd /d "%TEMP%"

:: Retry loop using Windows native rd /s /q
for /l %%i in (1,1,30) do (
    if not exist "%TARGET%" goto finish
    rd /s /q "%TARGET%" >nul 2>&1
    if not exist "%TARGET%" goto finish
    timeout /t 1 /nobreak >nul
)

:finish
del "%~f0" >nul 2>&1
`;

    try {
      fs.writeFileSync(cleanupBatPath, cleanupBatScript, { encoding: 'utf8' });
      const child = spawn('cmd.exe', ['/c', cleanupBatPath], {
        cwd: tempDir,
        detached: true,
        stdio: 'ignore',
        windowsHide: true
      });
      child.unref();
    } catch (e) { /* ignore */ }

    uninstallerWindow.webContents.send('uninstall-progress', {
      percent: 100,
      status: 'Uninstallation complete!'
    });

    uninstallerWindow.webContents.send('uninstall-complete', {});

    return { success: true };
  } catch (err) {
    uninstallerWindow.webContents.send('uninstall-error', {
      message: err.message
    });
    return { success: false, error: err.message };
  }
});

// ── App Lifecycle ────────────────────────────────────────────────────────────

app.whenReady().then(createWindow);

app.on('window-all-closed', () => {
  app.quit();
});

