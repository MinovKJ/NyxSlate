# NyxSlate - Standalone Android Build Script
# This script synchronizes web assets to the Android Capacitor project and builds the debug APK.

if (-not $env:ANDROID_HOME) {
    if (Test-Path "C:\Program Files (x86)\Android\android-sdk") {
        $env:ANDROID_HOME = "C:\Program Files (x86)\Android\android-sdk"
    } elseif (Test-Path "$env:LOCALAPPDATA\Android\Sdk") {
        $env:ANDROID_HOME = "$env:LOCALAPPDATA\Android\Sdk"
    }
}

if (-not $env:JAVA_HOME) {
    if (Test-Path "C:\Program Files\Android\openjdk\jdk-21.0.8") {
        $env:JAVA_HOME = "C:\Program Files\Android\openjdk\jdk-21.0.8"
    }
}

Write-Host "========================================" -ForegroundColor Cyan
Write-Host "    NyxSlate Android APK Builder        " -ForegroundColor Cyan
Write-Host "========================================" -ForegroundColor Cyan

# 1. Ensure www directory is populated with latest assets
Write-Host "`n[1/3] Syncing latest web assets to www/..." -ForegroundColor Yellow
if (-not (Test-Path "www")) {
    New-Item -ItemType Directory -Path "www" | Out-Null
}

Copy-Item -Force index.html, icon.png, pdf.min.js, pdf.worker.min.js, pdf-lib.min.js, jszip.min.js, docx-preview.min.js www/

# 2. Capacitor Sync
Write-Host "`n[2/3] Syncing Capacitor Android project..." -ForegroundColor Yellow
npx cap sync android

# 3. Build APK with Gradle
Write-Host "`n[3/3] Compiling Android Debug APK with Gradle..." -ForegroundColor Yellow
Push-Location android
.\gradlew.bat assembleDebug
Pop-Location

$apkPath = "android\app\build\outputs\apk\debug\app-debug.apk"
if (Test-Path $apkPath) {
    Copy-Item -Force $apkPath "NyxSlate-debug.apk"
    Write-Host "`n========================================" -ForegroundColor Green
    Write-Host " Android APK Built Successfully!        " -ForegroundColor Green
    Write-Host " Local Path: $apkPath" -ForegroundColor Green
    Write-Host " Root Path:  NyxSlate-debug.apk" -ForegroundColor Green
    Write-Host "========================================" -ForegroundColor Green
} else {
    Write-Host "`n[!] Build completed or in progress. Check outputs in android/app/build/outputs/apk/debug/" -ForegroundColor Yellow
}
