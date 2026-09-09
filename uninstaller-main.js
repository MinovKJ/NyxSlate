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

    // Step 1: Remove shortcuts silently using native node fs
    uninstallerWindow.webContents.send('uninstall-progress', {
      percent: 20,
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
      percent: 50,
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

    // Step 3: Remove user application files (leaving runtime untouched until window close)
    uninstallerWindow.webContents.send('uninstall-progress', {
      percent: 75,
      status: 'Removing application files...'
    });

    try {
      const entries = fs.readdirSync(installDir);
      for (const entry of entries) {
        // Keep runtime files and uninstaller assets alive so the UI never crashes
        if (entry === 'node_modules' || entry === 'uninstaller-main.js' || entry === 'uninstaller.html' || entry === 'uninstaller-preload.js') {
          continue;
        }
        const fullPath = path.join(installDir, entry);
        try {
          if (fs.statSync(fullPath).isDirectory()) {
            fs.rmSync(fullPath, { recursive: true, force: true });
          } else {
            fs.unlinkSync(fullPath);
          }
        } catch (e) {}
      }
    } catch (e) {}

    // Step 4: Schedule 100% hidden background cleanup that wipes the remaining directory once this uninstaller process exits
    uninstallerWindow.webContents.send('uninstall-progress', {
      percent: 90,
      status: 'Finalizing uninstallation...'
    });

    const psCleanup = `
      $p = ${currentPid}
      try { Wait-Process -Id $p -Timeout 300 -ErrorAction SilentlyContinue } catch {}
      Start-Sleep -Milliseconds 600
      $target = '${installDir.replace(/'/g, "''")}'
      for ($i = 0; $i -lt 30; $i++) {
        if (!(Test-Path -LiteralPath $target)) { break }
        try {
          [System.IO.Directory]::Delete($target, $true)
          break
        } catch {
          try { & cmd.exe /c "rd /s /q `"$target`"" *>$null } catch {}
          Start-Sleep -Seconds 1
        }
      }
    `;

    const child = spawn('powershell.exe', [
      '-NoProfile',
      '-WindowStyle', 'Hidden',
      '-Command', psCleanup.replace(/\r?\n/g, '; ')
    ], {
      cwd: process.env.TEMP || 'C:\\Windows\\Temp',
      detached: true,
      stdio: 'ignore',
      windowsHide: true
    });
    child.unref();

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

