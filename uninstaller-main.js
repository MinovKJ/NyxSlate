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

    // Step 2: Remove registry entries silently and immediately
    uninstallerWindow.webContents.send('uninstall-progress', {
      percent: 50,
      status: 'Cleaning registry entries...'
    });

    const regDeletes = [
      'reg delete "HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\NyxSlate" /f',
      'reg delete "HKCU\\Software\\Classes\\NyxSlate.PDF" /f',
      'reg delete "HKCU\\Software\\Classes\\Applications\\electron.exe" /f',
      'reg delete "HKCU\\Software\\Classes\\Applications\\NyxSlate.exe" /f',
      'reg delete "HKCU\\Software\\NyxSlate" /f',
      'reg delete "HKCU\\Software\\RegisteredApplications" /v "NyxSlate" /f',
      'reg delete "HKCU\\Software\\Classes\\.pdf\\OpenWithProgids" /v "NyxSlate.PDF" /f',
      'reg delete "HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Explorer\\FileExts\\.pdf\\OpenWithProgids" /v "NyxSlate.PDF" /f',
      'reg delete "HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\App Paths\\NyxSlate.exe" /f'
    ];

    try {
      execSync(`cmd.exe /c "${regDeletes.join(' & ')}"`, {
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

    // Step 4: Schedule 100% independent background cleanup that wipes the remaining directory once this uninstaller process exits
    uninstallerWindow.webContents.send('uninstall-progress', {
      percent: 90,
      status: 'Finalizing uninstallation...'
    });

    const tempDir = process.env.TEMP || 'C:\\Windows\\Temp';
    const ps1Path = path.join(tempDir, `nyx_cleanup_${Date.now()}.ps1`);

    const ps1Script = `
try { Wait-Process -Id ${currentPid} -Timeout 120 -ErrorAction SilentlyContinue } catch {}
Start-Sleep -Milliseconds 800
Stop-Process -Name NyxSlate, electron -Force -ErrorAction SilentlyContinue
$target = '${installDir.replace(/'/g, "''")}'

$protected = @(
    $env:SystemDrive + '\\',
    $env:SystemRoot,
    $env:windir,
    $env:ProgramFiles,
    \${env:ProgramFiles(x86)},
    $env:USERPROFILE,
    [Environment]::GetFolderPath('Desktop'),
    [Environment]::GetFolderPath('MyDocuments'),
    (Join-Path $env:USERPROFILE 'Downloads'),
    $env:LOCALAPPDATA,
    $env:APPDATA
)

$targetNormalized = [System.IO.Path]::GetFullPath($target).TrimEnd('\\', '/')
$isRootOrProtected = ($targetNormalized.Length -le 3)
foreach ($p in $protected) {
    if ($p -and ($targetNormalized -ieq [System.IO.Path]::GetFullPath($p).TrimEnd('\\', '/'))) {
        $isRootOrProtected = $true
        break
    }
}

$isNyxSubfolder = ([System.IO.Path]::GetFileName($targetNormalized) -ieq 'NyxSlate')

if (!$isRootOrProtected -and $isNyxSubfolder) {
    # Safe to delete the dedicated NyxSlate folder (parent folder remains 100% untouched)
    for ($i = 0; $i -lt 30; $i++) {
        if (!(Test-Path -LiteralPath $target)) { break }
        try {
            [System.IO.Directory]::Delete($target, $true)
            break
        } catch {
            try { cmd.exe /c "rd /s /q ""$target""" } catch {}
            Start-Sleep -Seconds 1
        }
    }
} else {
    # Not a dedicated NyxSlate folder: NEVER delete the directory itself, only delete app files
    $appFiles = @('node_modules', 'index.html', 'main.js', 'preload.js', 'package.json', 'package-lock.json', 'icon.ico', 'icon.png', 'pdf-lib.min.js', 'pdf.min.js', 'pdf.worker.min.js', 'Launch NyxSlate.bat', 'Uninstall NyxSlate.bat', 'uninstall.bat', 'uninstaller-main.js', 'uninstaller-preload.js', 'uninstaller.html', 'install-manifest.json')
    foreach ($f in $appFiles) {
        $fp = Join-Path $target $f
        if (Test-Path -LiteralPath $fp) {
            Remove-Item -LiteralPath $fp -Recurse -Force -ErrorAction SilentlyContinue
        }
    }
}
Remove-Item -LiteralPath $MyInvocation.MyCommand.Path -Force -ErrorAction SilentlyContinue
`;

    try {
      fs.writeFileSync(ps1Path, ps1Script, 'utf8');
      execSync(`start "" /b powershell.exe -NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File "${ps1Path}"`, {
        cwd: tempDir,
        windowsHide: true,
        stdio: 'ignore'
      });
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

