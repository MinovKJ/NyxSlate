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

function copyRecursive(src, dest, progressCb) {
  if (!fs.existsSync(dest)) {
    fs.mkdirSync(dest, { recursive: true });
  }
  const entries = fs.readdirSync(src, { withFileTypes: true });
  for (const entry of entries) {
    const srcPath = path.join(src, entry.name);
    const destPath = path.join(dest, entry.name);
    if (entry.isDirectory()) {
      copyRecursive(srcPath, destPath, progressCb);
    } else {
      // Retry logic for EPERM/EBUSY (antivirus, locked files)
      let retries = 3;
      while (retries > 0) {
        try {
          // If destination exists and might be locked, try removing first
          if (fs.existsSync(destPath)) {
            try { fs.unlinkSync(destPath); } catch (e) { /* ignore */ }
          }
          fs.copyFileSync(srcPath, destPath);
          break; // success
        } catch (err) {
          retries--;
          if (retries === 0) {
            // Skip this file but don't abort the entire install
            if (progressCb) progressCb(`SKIPPED: ${entry.name} (${err.code})`);
            break;
          }
          // Small delay before retry
          const start = Date.now();
          while (Date.now() - start < 500) { /* busy wait */ }
        }
      }
      if (progressCb) progressCb(entry.name);
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
  const payloadSize = Math.round(getDirSize(installPath) / 1024); // KB

  const ps = `
    $k = 'HKCU:\\Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\NyxSlate'
    if (!(Test-Path $k)) { New-Item -Path $k -Force | Out-Null }
    Set-ItemProperty -Path $k -Name DisplayName -Value 'NyxSlate'
    Set-ItemProperty -Path $k -Name DisplayVersion -Value '1.0.0'
    Set-ItemProperty -Path $k -Name Publisher -Value 'NyxSlate Team'
    Set-ItemProperty -Path $k -Name DisplayIcon -Value '${iconPath.replace(/'/g, "''")}'
    Set-ItemProperty -Path $k -Name InstallLocation -Value '${installPath.replace(/'/g, "''")}'
    Set-ItemProperty -Path $k -Name EstimatedSize -Value ${payloadSize} -Type DWord
    Set-ItemProperty -Path $k -Name NoModify -Value 1 -Type DWord
    Set-ItemProperty -Path $k -Name NoRepair -Value 1 -Type DWord
    [Microsoft.Win32.Registry]::SetValue('HKEY_CURRENT_USER\\Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\NyxSlate', 'UninstallString', [char]34 + '${electronExe.replace(/'/g, "''")}' + [char]34 + ' --no-sandbox ' + [char]34 + '${uninstallerJs.replace(/'/g, "''")}' + [char]34)
  `;

  try {
    execSync(`powershell -NoProfile -WindowStyle Hidden -Command "${ps.replace(/\r?\n/g, '; ').replace(/"/g, '\\"')}"`, {
      windowsHide: true,
      stdio: 'ignore'
    });
  } catch (e) { /* continue */ }
}

// ── Set PDF File Association ─────────────────────────────────────────────────

function setPdfAssociation(installPath, isDefault = false) {
  const nyxExe = path.join(installPath, 'node_modules', 'electron', 'dist', 'NyxSlate.exe');
  const electronExe = fs.existsSync(nyxExe) ? nyxExe : path.join(installPath, 'node_modules', 'electron', 'dist', 'electron.exe');
  const iconPath = path.join(installPath, 'icon.ico');
  const openCommand = `"${electronExe}" "${installPath}" "%1"`;

  function regAdd(key, valueName, data, type = 'REG_SZ') {
    try {
      const vFlag = valueName === '' ? '/ve' : `/v "${valueName}"`;
      const tFlag = `/t ${type}`;
      const dFlag = data === '' ? '/d ""' : `/d "${data.replace(/"/g, '\\"')}"`;
      execSync(`reg.exe add "${key}" ${vFlag} ${tFlag} ${dFlag} /f`, { windowsHide: true, stdio: 'ignore' });
    } catch (e) { /* ignore */ }
  }

  function regDel(key) {
    try {
      execSync(`reg.exe delete "${key}" /f`, { windowsHide: true, stdio: 'ignore' });
    } catch (e) { /* ignore */ }
  }

  try {
    // 1. Classes .pdf
    if (isDefault) {
      regAdd('HKCU\\Software\\Classes\\.pdf', '', 'NyxSlate.PDF');
    }
    regAdd('HKCU\\Software\\Classes\\.pdf\\OpenWithProgids', 'NyxSlate.PDF', '');
    regAdd('HKCU\\Software\\Classes\\.pdf\\OpenWithList\\NyxSlate.exe', '', '');

    // 2. Classes NyxSlate.PDF
    regAdd('HKCU\\Software\\Classes\\NyxSlate.PDF', '', 'NyxSlate PDF Document');
    regAdd('HKCU\\Software\\Classes\\NyxSlate.PDF', 'FriendlyTypeName', 'NyxSlate PDF Document');
    regAdd('HKCU\\Software\\Classes\\NyxSlate.PDF\\DefaultIcon', '', `${electronExe},0`);
    regAdd('HKCU\\Software\\Classes\\NyxSlate.PDF\\shell\\open', 'FriendlyAppName', 'NyxSlate');
    regAdd('HKCU\\Software\\Classes\\NyxSlate.PDF\\shell\\open\\command', '', openCommand);

    // 3. Applications\\NyxSlate.exe (Windows extracts the embedded gold/dark icon directly from NyxSlate.exe)
    regAdd('HKCU\\Software\\Classes\\Applications\\NyxSlate.exe', 'FriendlyAppName', 'NyxSlate');
    regAdd('HKCU\\Software\\Classes\\Applications\\NyxSlate.exe', 'ApplicationCompany', 'NyxSlate');
    regAdd('HKCU\\Software\\Classes\\Applications\\NyxSlate.exe\\DefaultIcon', '', `${electronExe},0`);
    regAdd('HKCU\\Software\\Classes\\Applications\\NyxSlate.exe\\SupportedTypes', '.pdf', '');
    regAdd('HKCU\\Software\\Classes\\Applications\\NyxSlate.exe\\shell\\open', 'FriendlyAppName', 'NyxSlate');
    regAdd('HKCU\\Software\\Classes\\Applications\\NyxSlate.exe\\shell\\open\\command', '', openCommand);

    // Clean old electron.exe app registration so Windows doesn't show old Atom icon
    regDel('HKCU\\Software\\Classes\\Applications\\electron.exe');

    // 4. RegisteredApplications & Capabilities
    regAdd('HKCU\\Software\\RegisteredApplications', 'NyxSlate', 'Software\\NyxSlate\\Capabilities');
    regAdd('HKCU\\Software\\NyxSlate\\Capabilities', 'ApplicationName', 'NyxSlate');
    regAdd('HKCU\\Software\\NyxSlate\\Capabilities', 'ApplicationDescription', 'NyxSlate PDF Reader');
    regAdd('HKCU\\Software\\NyxSlate\\Capabilities\\FileAssociations', '.pdf', 'NyxSlate.PDF');

    // 5. Explorer FileExts
    regAdd('HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Explorer\\FileExts\\.pdf\\OpenWithProgids', 'NyxSlate.PDF', '', 'REG_NONE');
    regAdd('HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Explorer\\FileExts\\.pdf\\OpenWithList', 'a', 'NyxSlate.exe');
    regAdd('HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Explorer\\FileExts\\.pdf\\OpenWithList', 'MRUList', 'a');

    // 6. App Paths
    regAdd('HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\App Paths\\NyxSlate.exe', '', electronExe);
    regAdd('HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\App Paths\\NyxSlate.exe', 'Path', installPath);

    // 7. Notify Windows Shell (SHChangeNotify)
    const psAssoc = `
      $sig = @'
      [DllImport("shell32.dll")]
      public static extern void SHChangeNotify(int wEventId, uint uFlags, IntPtr dwItem1, IntPtr dwItem2);
'@
      $t = Add-Type -MemberDefinition $sig -Name 'Win32SHAssoc' -Namespace 'Win32' -PassThru
      $t::SHChangeNotify(0x08000000, 0, [IntPtr]::Zero, [IntPtr]::Zero)
    `;
    try {
      execSync(`powershell -NoProfile -Command "${psAssoc.replace(/\r?\n/g, ' ')}"`, { windowsHide: true, stdio: 'ignore' });
    } catch (e) {}

    // 8. If user requested default, launch Windows Default Apps UI focused on NyxSlate
    if (isDefault) {
      const psDefault = `
        try {
          $typeDef = @'
          using System;
          using System.Runtime.InteropServices;
          [ComImport, Guid("1f76a169-f9f3-4047-867b-3e5b4e4da7d4"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
          public interface IAppAssocUI {
              [PreserveSig] int LaunchAdvancedAssociationUI([MarshalAs(UnmanagedType.LPWStr)] string pszAppRegName);
          }
          [ComImport, Guid("19689bf6-c384-4805-a776-11d265045415")]
          public class AppAssocUI {}
          public class DefaultRunner {
              public static void Launch(string name) {
                  try {
                      IAppAssocUI ui = (IAppAssocUI)new AppAssocUI();
                      ui.LaunchAdvancedAssociationUI(name);
                  } catch {}
              }
          }
'@
          Add-Type -TypeDefinition $typeDef -Language CSharp
          [DefaultRunner]::Launch('NyxSlate')
        } catch {
          Start-Process 'ms-settings:defaultapps'
        }
      `;
      try {
        const child = spawn('powershell.exe', ['-NoProfile', '-WindowStyle', 'Hidden', '-Command', psDefault.replace(/\r?\n/g, ' ')], {
          detached: true,
          stdio: 'ignore',
          windowsHide: true
        });
        child.unref();
      } catch (e) {}
    }
  } catch (e) { /* continue */ }
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

    copyRecursive(payloadDir, installPath, (fileName) => {
      copiedFiles++;
      const percent = Math.round((copiedFiles / totalFiles) * 70); // 0-70%
      installerWindow.webContents.send('install-progress', {
        phase: 'copying',
        percent,
        status: `Copying: ${fileName}`
      });
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
