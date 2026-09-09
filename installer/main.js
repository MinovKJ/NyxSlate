const { app, BrowserWindow, ipcMain, dialog, shell } = require('electron');
const path = require('path');
// Use original-fs to bypass Electron's asar patching — without this,
// .asar files get treated as directories and copyRecursive breaks.
const fs = require('original-fs');
const { execSync, spawn } = require('child_process');

let installerWindow = null;
let installDir = '';

function createWindow() {
  installerWindow = new BrowserWindow({
    width: 820,
    height: 570,
    resizable: false,
    maximizable: false,
    fullscreenable: false,
    frame: false,
    transparent: true,
    backgroundColor: '#00000000',
    title: 'NyxSlate Setup',
    icon: path.join(__dirname, '..', 'icon.ico'),
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false
    }
  });

  installerWindow.loadFile(path.join(__dirname, 'index.html'));

  installerWindow.on('closed', () => {
    installerWindow = null;
  });
}

// ── Helpers ──────────────────────────────────────────────────────────────────

function getPayloadDir() {
  // In dev, payload/ is next to main.js
  const devPath = path.join(__dirname, 'payload');
  if (fs.existsSync(devPath)) return devPath;
  // In packaged app, it's in resources/payload
  const prodPath = path.join(process.resourcesPath, 'payload');
  if (fs.existsSync(prodPath)) return prodPath;
  return devPath; // fallback
}

function getDefaultInstallPath() {
  return path.join(process.env.LOCALAPPDATA || 'C:\\Users\\Public', 'NyxSlate');
}

async function copyRecursiveAsync(src, dest, progressCb) {
  await fs.promises.mkdir(dest, { recursive: true });
  const entries = await fs.promises.readdir(src, { withFileTypes: true });
  for (const entry of entries) {
    const srcPath = path.join(src, entry.name);
    const destPath = path.join(dest, entry.name);
    if (entry.isDirectory()) {
      await copyRecursiveAsync(srcPath, destPath, progressCb);
    } else {
      let retries = 3;
      while (retries > 0) {
        try {
          if (fs.existsSync(destPath)) {
            try { await fs.promises.unlink(destPath); } catch (e) { /* ignore */ }
          }
          await fs.promises.copyFile(srcPath, destPath);
          break;
        } catch (err) {
          retries--;
          if (retries === 0) {
            if (progressCb) progressCb(`SKIPPED: ${entry.name} (${err.code})`);
            break;
          }
          await new Promise(r => setTimeout(r, 100));
        }
      }
      if (progressCb) progressCb(entry.name);
      await new Promise(r => setImmediate(r));
    }
  }
}

function countFiles(dir) {
  let count = 0;
  if (!fs.existsSync(dir)) return 0;
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  for (const entry of entries) {
    if (entry.isDirectory()) {
      count += countFiles(path.join(dir, entry.name));
    } else {
      count++;
    }
  }
  return count;
}

function getDirSize(dir) {
  let size = 0;
  if (!fs.existsSync(dir)) return 0;
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      size += getDirSize(fullPath);
    } else {
      size += fs.statSync(fullPath).size;
    }
  }
  return size;
}

// ── Create Windows Shortcut via PowerShell ───────────────────────────────────

function createShortcut(shortcutPath, targetPath, args, iconPath, description) {
  const ps = `
    $ws = New-Object -ComObject WScript.Shell;
    $sc = $ws.CreateShortcut('${shortcutPath.replace(/'/g, "''")}');
    $sc.TargetPath = '${targetPath.replace(/'/g, "''")}';
    $sc.Arguments = '${(args || '').replace(/'/g, "''")}';
    $sc.IconLocation = '${(iconPath || targetPath).replace(/'/g, "''")}';
    $sc.Description = '${(description || '').replace(/'/g, "''")}';
    $sc.WorkingDirectory = '${path.dirname(targetPath).replace(/'/g, "''")}';
    $sc.Save();
  `;
  try {
    execSync(`powershell -NoProfile -Command "${ps.replace(/"/g, '\\"').replace(/\n/g, ' ')}"`, { windowsHide: true });
    return true;
  } catch (e) {
    console.error('Shortcut creation failed:', e.message);
    return false;
  }
}

// ── Register in Add/Remove Programs ──────────────────────────────────────────

function registerUninstaller(installPath) {
  const nyxExe = path.join(installPath, 'node_modules', 'electron', 'dist', 'NyxSlate.exe');
  const electronExe = fs.existsSync(nyxExe) ? nyxExe : path.join(installPath, 'node_modules', 'electron', 'dist', 'electron.exe');
  const uninstallerJs = path.join(installPath, 'uninstaller-main.js');
  const iconPath = path.join(installPath, 'icon.ico');

  const regLines = [
    `reg add "HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\NyxSlate" /v "DisplayName" /t REG_SZ /d "NyxSlate" /f`,
    `reg add "HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\NyxSlate" /v "DisplayVersion" /t REG_SZ /d "1.0.0" /f`,
    `reg add "HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\NyxSlate" /v "Publisher" /t REG_SZ /d "NyxSlate Team" /f`,
    `reg add "HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\NyxSlate" /v "DisplayIcon" /t REG_SZ /d "${iconPath}" /f`,
    `reg add "HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\NyxSlate" /v "InstallLocation" /t REG_SZ /d "${installPath}" /f`,
    `reg add "HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\NyxSlate" /v "EstimatedSize" /t REG_DWORD /d 480000 /f`,
    `reg add "HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\NyxSlate" /v "NoModify" /t REG_DWORD /d 1 /f`,
    `reg add "HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\NyxSlate" /v "NoRepair" /t REG_DWORD /d 1 /f`,
    `reg add "HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\NyxSlate" /v "UninstallString" /t REG_SZ /d "\\"${electronExe}\\" --no-sandbox \\"${uninstallerJs}\\"" /f`,
    `reg add "HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\NyxSlate" /v "QuietUninstallString" /t REG_SZ /d "\\"${electronExe}\\" --no-sandbox \\"${uninstallerJs}\\"" /f`
  ];

  try {
    execSync(regLines.join(' & '), { windowsHide: true, stdio: 'ignore' });
  } catch (e) { /* ignore */ }
}

// ── Set PDF File Association ─────────────────────────────────────────────────

function setPdfAssociation(installPath, isDefault = false) {
  const nyxExe = path.join(installPath, 'node_modules', 'electron', 'dist', 'NyxSlate.exe');
  const electronExe = fs.existsSync(nyxExe) ? nyxExe : path.join(installPath, 'node_modules', 'electron', 'dist', 'electron.exe');
  const openCommand = `\\"${electronExe}\\" \\"${installPath}\\" \\"%1\\"`;

  const regLines = [
    ...(isDefault ? [`reg add "HKCU\\Software\\Classes\\.pdf" /ve /t REG_SZ /d "NyxSlate.PDF" /f`] : []),
    `reg add "HKCU\\Software\\Classes\\.pdf\\OpenWithProgids" /v "NyxSlate.PDF" /t REG_SZ /d "" /f`,
    `reg add "HKCU\\Software\\Classes\\.pdf\\OpenWithList\\NyxSlate.exe" /ve /t REG_SZ /d "" /f`,
    `reg add "HKCU\\Software\\Classes\\NyxSlate.PDF" /ve /t REG_SZ /d "NyxSlate PDF Document" /f`,
    `reg add "HKCU\\Software\\Classes\\NyxSlate.PDF" /v "FriendlyTypeName" /t REG_SZ /d "NyxSlate PDF Document" /f`,
    `reg add "HKCU\\Software\\Classes\\NyxSlate.PDF\\DefaultIcon" /ve /t REG_SZ /d "${electronExe},0" /f`,
    `reg add "HKCU\\Software\\Classes\\NyxSlate.PDF\\shell\\open" /v "FriendlyAppName" /t REG_SZ /d "NyxSlate" /f`,
    `reg add "HKCU\\Software\\Classes\\NyxSlate.PDF\\shell\\open\\command" /ve /t REG_SZ /d "${openCommand}" /f`,
    `reg add "HKCU\\Software\\Classes\\Applications\\NyxSlate.exe" /v "FriendlyAppName" /t REG_SZ /d "NyxSlate" /f`,
    `reg add "HKCU\\Software\\Classes\\Applications\\NyxSlate.exe" /v "ApplicationCompany" /t REG_SZ /d "NyxSlate" /f`,
    `reg add "HKCU\\Software\\Classes\\Applications\\NyxSlate.exe\\DefaultIcon" /ve /t REG_SZ /d "${electronExe},0" /f`,
    `reg add "HKCU\\Software\\Classes\\Applications\\NyxSlate.exe\\SupportedTypes" /v ".pdf" /t REG_SZ /d "" /f`,
    `reg add "HKCU\\Software\\Classes\\Applications\\NyxSlate.exe\\shell\\open" /v "FriendlyAppName" /t REG_SZ /d "NyxSlate" /f`,
    `reg add "HKCU\\Software\\Classes\\Applications\\NyxSlate.exe\\shell\\open\\command" /ve /t REG_SZ /d "${openCommand}" /f`,
    `reg delete "HKCU\\Software\\Classes\\Applications\\electron.exe" /f 2>nul`,
    `reg add "HKCU\\Software\\RegisteredApplications" /v "NyxSlate" /t REG_SZ /d "Software\\NyxSlate\\Capabilities" /f`,
    `reg add "HKCU\\Software\\NyxSlate\\Capabilities" /v "ApplicationName" /t REG_SZ /d "NyxSlate" /f`,
    `reg add "HKCU\\Software\\NyxSlate\\Capabilities" /v "ApplicationDescription" /t REG_SZ /d "NyxSlate PDF Reader" /f`,
    `reg add "HKCU\\Software\\NyxSlate\\Capabilities\\FileAssociations" /v ".pdf" /t REG_SZ /d "NyxSlate.PDF" /f`,
    `reg add "HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Explorer\\FileExts\\.pdf\\OpenWithProgids" /v "NyxSlate.PDF" /t REG_NONE /d "" /f`,
    `reg add "HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Explorer\\FileExts\\.pdf\\OpenWithList" /v "a" /t REG_SZ /d "NyxSlate.exe" /f`,
    `reg add "HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Explorer\\FileExts\\.pdf\\OpenWithList" /v "MRUList" /t REG_SZ /d "a" /f`,
    `reg add "HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\App Paths\\NyxSlate.exe" /ve /t REG_SZ /d "${electronExe}" /f`,
    `reg add "HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\App Paths\\NyxSlate.exe" /v "Path" /t REG_SZ /d "${installPath}" /f`
  ];

  try {
    execSync(regLines.join(' & '), { windowsHide: true, stdio: 'ignore' });
  } catch (e) { /* ignore */ }

  if (isDefault) {
    try {
      const child = spawn('cmd.exe', ['/c', 'start', 'ms-settings:defaultapps'], {
        detached: true,
        stdio: 'ignore',
        windowsHide: true
      });
      child.unref();
    } catch (e) {}
  }
}


// ── IPC Handlers ─────────────────────────────────────────────────────────────

ipcMain.on('minimize-window', () => {
  if (installerWindow) installerWindow.minimize();
});

ipcMain.on('close-installer', () => {
  if (installerWindow) installerWindow.close();
  app.quit();
});

ipcMain.handle('get-default-path', () => {
  return getDefaultInstallPath();
});

ipcMain.handle('browse-directory', async () => {
  if (!installerWindow) return null;
  const result = await dialog.showOpenDialog(installerWindow, {
    title: 'Select Installation Directory',
    defaultPath: getDefaultInstallPath(),
    properties: ['openDirectory', 'createDirectory']
  });
  if (result.canceled || !result.filePaths.length) return null;
  return result.filePaths[0];
});

ipcMain.handle('get-disk-space', async (_event, dir) => {
  try {
    const drive = path.parse(dir || 'C:\\').root;
    const output = execSync(
      `powershell -NoProfile -Command "(Get-PSDrive -Name '${drive[0]}').Free"`,
      { windowsHide: true, encoding: 'utf8' }
    ).trim();
    const freeBytes = parseInt(output, 10);
    const payloadDir = getPayloadDir();
    const requiredBytes = fs.existsSync(payloadDir) ? getDirSize(payloadDir) : 200 * 1024 * 1024;
    return {
      free: freeBytes,
      required: requiredBytes,
      freeFormatted: (freeBytes / (1024 * 1024 * 1024)).toFixed(1) + ' GB',
      requiredFormatted: (requiredBytes / (1024 * 1024)).toFixed(0) + ' MB'
    };
  } catch (e) {
    return { free: 0, required: 0, freeFormatted: 'Unknown', requiredFormatted: 'Unknown' };
  }
});

ipcMain.handle('start-install', async (_event, options) => {
  const {
    installPath,
    createDesktopShortcut,
    createStartMenuShortcut,
    setDefaultPdf,
    launchAfterInstall
  } = options;

  installDir = installPath;
  const payloadDir = getPayloadDir();

  try {
    // Count total files
    const totalFiles = countFiles(payloadDir);
    let copiedFiles = 0;

    // Step 1: Copy files
    installerWindow.webContents.send('install-progress', {
      phase: 'copying',
      percent: 0,
      status: 'Preparing installation directory...'
    });

    if (!fs.existsSync(installPath)) {
      fs.mkdirSync(installPath, { recursive: true });
    }

    await copyRecursiveAsync(payloadDir, installPath, (fileName) => {
      copiedFiles++;
      const percent = Math.min(70, Math.round((copiedFiles / Math.max(1, totalFiles)) * 70));
      if (installerWindow && !installerWindow.isDestroyed()) {
        installerWindow.webContents.send('install-progress', {
          phase: 'copying',
          percent,
          status: `Copying: ${fileName}`
        });
      }
    });

    // Step 2: Create uninstaller
    installerWindow.webContents.send('install-progress', {
      phase: 'uninstaller',
      percent: 72,
      status: 'Creating uninstaller...'
    });

    const uninstallBat = `@echo off
echo ============================================
echo   NyxSlate Uninstaller
echo ============================================
echo.
set /p confirm="Are you sure you want to uninstall NyxSlate? (Y/N): "
if /i not "%confirm%"=="Y" (
    echo Uninstall cancelled.
    pause
    exit /b
)
echo.
echo Removing files...
cd /d "%~dp0"
cd ..
set "INSTALL_DIR=%CD%\\NyxSlate"
if "%~dp0"=="" set "INSTALL_DIR=%~dp0"

echo Removing Start Menu shortcut...
del /q "%APPDATA%\\Microsoft\\Windows\\Start Menu\\Programs\\NyxSlate.lnk" 2>nul

echo Removing Desktop shortcut...
del /q "%USERPROFILE%\\Desktop\\NyxSlate.lnk" 2>nul

echo Removing registry entries...
reg delete "HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\NyxSlate" /f 2>nul
reg delete "HKCU\\Software\\Classes\\.pdf" /f 2>nul
reg delete "HKCU\\Software\\Classes\\NyxSlate.PDF" /f 2>nul

echo Removing installation files...
cd /d "%TEMP%"
rmdir /s /q "${installPath.replace(/\\/g, '\\\\')}" 2>nul

echo.
echo NyxSlate has been uninstalled successfully.
pause
`;
    fs.writeFileSync(path.join(installPath, 'uninstall.bat'), uninstallBat);

    // Step 3: Create shortcuts
    installerWindow.webContents.send('install-progress', {
      phase: 'shortcuts',
      percent: 78,
      status: 'Creating shortcuts...'
    });

    const nyxExe = path.join(installPath, 'node_modules', 'electron', 'dist', 'NyxSlate.exe');
    const electronExe = fs.existsSync(nyxExe) ? nyxExe : path.join(installPath, 'node_modules', 'electron', 'dist', 'electron.exe');
    const iconFile = path.join(installPath, 'icon.ico');
    const launchTarget = fs.existsSync(electronExe) ? electronExe : path.join(installPath, 'Launch NyxSlate.bat');
    const launchArgs = fs.existsSync(electronExe) ? `"${installPath}"` : '';

    if (createDesktopShortcut) {
      const desktopPath = path.join(process.env.USERPROFILE || '', 'Desktop', 'NyxSlate.lnk');
      createShortcut(desktopPath, launchTarget, launchArgs, iconFile, 'NyxSlate — PDF Reader');
    }

    if (createStartMenuShortcut) {
      const startMenuDir = path.join(process.env.APPDATA || '', 'Microsoft', 'Windows', 'Start Menu', 'Programs');
      const startMenuPath = path.join(startMenuDir, 'NyxSlate.lnk');
      createShortcut(startMenuPath, launchTarget, launchArgs, iconFile, 'NyxSlate — PDF Reader');

      const uninstallJs = path.join(installPath, 'uninstaller-main.js');
      const uninstallShortcutPath = path.join(startMenuDir, 'Uninstall NyxSlate.lnk');
      createShortcut(uninstallShortcutPath, electronExe, `--no-sandbox "${uninstallJs}"`, iconFile, 'Uninstall NyxSlate');
    }

    // Step 4: Register uninstaller
    installerWindow.webContents.send('install-progress', {
      phase: 'registry',
      percent: 88,
      status: 'Registering application...'
    });
    registerUninstaller(installPath);

    // Step 5: Set PDF association & capabilities
    installerWindow.webContents.send('install-progress', {
      phase: 'association',
      percent: 94,
      status: 'Setting file associations...'
    });
    setPdfAssociation(installPath, !!setDefaultPdf);

    // Done
    installerWindow.webContents.send('install-progress', {
      phase: 'done',
      percent: 100,
      status: 'Installation complete!'
    });

    installerWindow.webContents.send('install-complete', {
      installPath,
      success: true
    });

    return { success: true };
  } catch (err) {
    console.error('Installation failed:', err);
    installerWindow.webContents.send('install-error', {
      message: err.message
    });
    return { success: false, error: err.message };
  }
});

ipcMain.on('launch-app', () => {
  if (installDir) {
    const electronExe = path.join(installDir, 'node_modules', 'electron', 'dist', 'electron.exe');
    const batFile = path.join(installDir, 'Launch NyxSlate.bat');

    if (fs.existsSync(electronExe)) {
      const child = spawn(electronExe, [installDir], {
        cwd: installDir,
        detached: true,
        stdio: 'ignore'
      });
      child.unref();
    } else if (fs.existsSync(batFile)) {
      const child = spawn('cmd.exe', ['/c', batFile], {
        cwd: installDir,
        detached: true,
        stdio: 'ignore'
      });
      child.unref();
    }
  }
  setTimeout(() => app.quit(), 500);
});

// ── App Lifecycle ────────────────────────────────────────────────────────────

app.whenReady().then(createWindow);

app.on('window-all-closed', () => {
  app.quit();
});
