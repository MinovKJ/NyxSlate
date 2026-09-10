# NyxSlate

A fast, minimalist desktop and mobile PDF workspace and document reader for Windows and Android.

[![Release](https://img.shields.io/badge/Release-v1.1.0-eab308)](https://github.com/MinovKJ/NyxSlate/releases/latest)
[![Platform - Windows](https://img.shields.io/badge/Platform-Windows-blue)](https://github.com/MinovKJ/NyxSlate/releases/latest)
[![Platform - Android](https://img.shields.io/badge/Platform-Android-green)](https://github.com/MinovKJ/NyxSlate/releases/latest)
[![License](https://img.shields.io/badge/License-MIT-lightgrey)](LICENSE)

---

## Downloads

### Windows
Download the setup executable to install NyxSlate on Windows:
- [**Download NyxSlate Setup v1.1.0 (.exe)**](https://github.com/MinovKJ/NyxSlate/releases/download/v1.1.0/NyxSlate-Setup-1.1.0.exe)
- Local Path: `installer/dist/NyxSlate-Setup-1.1.0.exe`

### Android
Download the standalone APK package for Android devices:
- [**Download NyxSlate Android APK v1.1.0 (.apk)**](https://github.com/MinovKJ/NyxSlate/releases/download/v1.1.0/NyxSlate-debug.apk)
- Local Path: `NyxSlate-debug.apk`

---

## Key Features

- **Cross-Platform Workspace**: Seamless PDF reading and document workflows on both Windows desktop and Android mobile devices.
- **5-Tab Mobile Studio**: Dedicated mobile workspace featuring Home, File Browser, Floating Quick-Action Menu, Document Conversion Tools, and Starred Bookmarks.
- **Convert & Document Suite**:
  - Convert DOCX, PPTX, XLSX, and text documents into PDF format.
  - Image to PDF generator with auto-scaling and high-fidelity output.
  - PDF page reordering, rotation, page extraction, and merging.
- **High-Performance Document Viewer**:
  - Smooth page-by-page rendering powered by PDF.js.
  - Dark mode and custom color presets (Sepia, Solarized, High-Contrast).
  - Continuous vertical scroll and dual-page book reading modes.
  - Thumbnail sidebar and quick page navigation slider.
- **Native Windows Setup & Uninstallation Manager**:
  - 6-step guided wizard for directory selection and file associations.
  - Custom branded uninstallation manager with complete registry cleanup.

---

## Installation & Usage

### Windows
1. Run `NyxSlate-Setup-1.1.0.exe`.
2. Choose your installation path and shortcut preferences.
3. Complete the setup to automatically configure file associations and launch NyxSlate.

### Android
1. Transfer `NyxSlate-debug.apk` to your Android device.
2. Enable installation from unknown sources if prompted.
3. Install and launch the application.

---

## Building from Source

### Prerequisites
- Node.js (v18 or newer)
- npm
- Java JDK 17+ & Android SDK (for Android builds)

### Desktop Development
```bash
# Clone the repository
git clone https://github.com/MinovKJ/NyxSlate.git
cd NyxSlate

# Install dependencies and start the desktop app
npm install
npm start
```

### Packaging Windows Installer
```bash
cd installer
powershell -ExecutionPolicy Bypass -File build-payload.ps1
npm run build
```
The output installer executable will be generated at `installer/dist/NyxSlate-Setup-1.1.0.exe`.

### Packaging Android APK
```bash
# Build Android assets and generate debug APK
powershell -ExecutionPolicy Bypass -File update-icons.ps1
npx cap sync android
cd android
./gradlew assembleDebug
```
The output APK will be generated at `android/app/build/outputs/apk/debug/app-debug.apk` and copied to `NyxSlate-debug.apk`.

---

## License

MIT License.
