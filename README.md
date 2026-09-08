# NyxSlate

A fast, minimalist desktop PDF reader and document workspace for Windows.

[![Release](https://img.shields.io/github/v/release/MinovKJ/NyxSlate?color=eab308&label=Release)](https://github.com/MinovKJ/NyxSlate/releases/latest)
[![Platform](https://img.shields.io/badge/Platform-Windows-blue)](https://github.com/MinovKJ/NyxSlate/releases/latest)

---

## Download & Installation

Download the latest setup package to install NyxSlate on Windows:

[**Download NyxSlate Setup (v1.0.0)**](https://github.com/MinovKJ/NyxSlate/releases/download/v1.0.0/NyxSlate-Setup-1.0.0.exe)

### Quick Install
1. Run `NyxSlate-Setup-1.0.0.exe`.
2. Select your desired installation path and shortcut preferences.
3. Click **Install**. NyxSlate will configure the application, desktop shortcut, and registry associations automatically.

---

## Features

- **Document Reading & Annotation**: Smooth, high-performance rendering for PDF files.
- **Minimalist Interface**: Clean dark-mode workspace focused on reading and organizing documents.
- **Custom Setup & Uninstallation Managers**: Fully integrated setup and uninstallation flows with atmospheric visual effects.

---

## Building from Source

### Prerequisites
- Node.js (v18 or newer)
- npm

### Development
```bash
# Clone the repository
git clone https://github.com/MinovKJ/NyxSlate.git
cd NyxSlate

# Install dependencies and start the app
npm install
npm start
```

### Packaging the Installer
```bash
cd installer
powershell -ExecutionPolicy Bypass -File build-payload.ps1
npm run build
```
The output installer `.exe` will be located in `installer/dist/NyxSlate-Setup-1.0.0.exe`.

---

## License

MIT License.
