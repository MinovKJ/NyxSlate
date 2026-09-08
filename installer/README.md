# NyxSlate Installation Manager

A premium, dark-themed installation wizard for NyxSlate — the PDF reader.

## Quick Start

### 1. Build the Payload

First, package the NyxSlate app files into the installer's `payload/` directory:

```powershell
cd installer
powershell -ExecutionPolicy Bypass -File build-payload.ps1
```

This copies all necessary app files (HTML, JS, icons, Electron runtime) into `installer/payload/`.

### 2. Install Installer Dependencies

```powershell
npm install
```

### 3. Test the Installer

```powershell
npm start
```

This launches the installer wizard in development mode so you can preview all 6 steps.

### 4. Build the Final Executable (Optional)

```powershell
npm run build
```

This creates a portable `.exe` installer in `dist/` using electron-builder.

## How It Works

```
installer/
├── main.js            # Electron main process (IPC handlers, file copy, registry)
├── preload.js         # Secure IPC bridge
├── index.html         # Installer wizard UI (6-step flow)
├── package.json       # Installer project config
├── build-payload.ps1  # Script to package app files
├── payload/           # (generated) Contains the NyxSlate app files to install
│   ├── index.html
│   ├── main.js
│   ├── preload.js
│   ├── icon.ico
│   ├── ...
│   └── node_modules/
│       └── electron/
└── README.md
```

### Installer Steps

| Step | Screen | Description |
|------|--------|-------------|
| 1 | **Welcome** | App branding, feature highlights |
| 2 | **License** | MIT license agreement with acceptance checkbox |
| 3 | **Location** | Install directory picker with disk space indicator |
| 4 | **Options** | Desktop shortcut, Start Menu, PDF association, auto-launch |
| 5 | **Installing** | Animated progress bar with file-copy log |
| 6 | **Complete** | Success screen with launch button |

### What the Installer Does

1. **Copies files** from `payload/` to the chosen install directory
2. **Creates shortcuts** (Desktop and/or Start Menu) using PowerShell + WScript.Shell
3. **Registers in Add/Remove Programs** via `HKCU\...\Uninstall\NyxSlate` registry keys
4. **Optionally sets PDF file association** (`.pdf` → NyxSlate)
5. **Creates an uninstaller** (`uninstall.bat`) in the install directory

### Uninstalling

Run `uninstall.bat` in the NyxSlate installation directory, or use **Settings → Apps → NyxSlate → Uninstall** in Windows.

## Customization

- **Branding**: Edit the hero section in `index.html`
- **Colors**: Modify CSS custom properties in `:root`
- **License**: Update the license text in step 1
- **Icon**: Replace `../icon.ico` in `package.json` build config
