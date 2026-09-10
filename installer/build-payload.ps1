# build-payload.ps1 - Packages the NyxSlate app into the installer payload dir
# Run from the installer/ directory: powershell -ExecutionPolicy Bypass -File build-payload.ps1

$ErrorActionPreference = "Stop"

$scriptDir  = Split-Path -Parent $MyInvocation.MyCommand.Path
$projectDir = Split-Path -Parent $scriptDir
$payloadDir = Join-Path $scriptDir "payload"

Write-Host ""
Write-Host "==================================================" -ForegroundColor Cyan
Write-Host "  NyxSlate Installer - Payload Builder" -ForegroundColor Cyan
Write-Host "==================================================" -ForegroundColor Cyan
Write-Host ""

# Clean previous payload
if (Test-Path $payloadDir) {
    Write-Host "[1/4] Cleaning previous payload..." -ForegroundColor Yellow
    Remove-Item -Recurse -Force $payloadDir
}
else {
    Write-Host "[1/4] No previous payload found." -ForegroundColor DarkGray
}

# Create payload directory
New-Item -ItemType Directory -Path $payloadDir -Force | Out-Null
Write-Host "[2/4] Created payload directory." -ForegroundColor Green

# Files to copy
$filesToCopy = @(
    "index.html",
    "main.js",
    "preload.js",
    "package.json",
    "package-lock.json",
    "icon.ico",
    "icon.png",
    "pdf-lib.min.js",
    "pdf.min.js",
    "pdf.worker.min.js",
    "docx-preview.min.js",
    "jszip.min.js",
    "Launch NyxSlate.bat",
    "Uninstall NyxSlate.bat",
    "uninstaller-main.js",
    "uninstaller-preload.js",
    "uninstaller.html"
)

Write-Host "[3/4] Copying application files..." -ForegroundColor Yellow

foreach ($file in $filesToCopy) {
    $src = Join-Path $projectDir $file
    if (Test-Path $src) {
        Copy-Item $src -Destination $payloadDir -Force
        Write-Host "  + $file" -ForegroundColor Green
    }
    else {
        Write-Host "  - $file (not found, skipping)" -ForegroundColor DarkYellow
    }
}

    # Copy node_modules (needed for Electron runtime)
    Write-Host "[4/4] Copying Electron runtime (node_modules)..." -ForegroundColor Yellow
    $nodeModulesSrc = Join-Path $projectDir "node_modules"
    $nodeModulesDst = Join-Path $payloadDir "node_modules"

    if (Test-Path $nodeModulesSrc) {
        # Only copy electron and its dependencies (not all dev deps)
        $electronDir = Join-Path $nodeModulesSrc "electron"
        if (Test-Path $electronDir) {
            $electronDst = Join-Path $nodeModulesDst "electron"
            New-Item -ItemType Directory -Path $nodeModulesDst -Force | Out-Null
            Copy-Item $electronDir -Destination $electronDst -Recurse -Force
            Write-Host "  + node_modules/electron" -ForegroundColor Green

            # Create NyxSlate.exe with embedded icon & metadata
            $electronExe = Join-Path $electronDst "dist\electron.exe"
            $nyxExe = Join-Path $electronDst "dist\NyxSlate.exe"
            $iconFile = Join-Path $projectDir "icon.ico"
            $rceditExe = Join-Path $projectDir "node_modules\rcedit\bin\rcedit-x64.exe"

            if ((Test-Path $electronExe) -and (Test-Path $iconFile) -and (Test-Path $rceditExe)) {
                Copy-Item $electronExe $nyxExe -Force
                & $rceditExe $nyxExe --set-icon $iconFile --set-version-string ProductName "NyxSlate" --set-version-string FileDescription "NyxSlate" --set-version-string CompanyName "NyxSlate" --set-version-string LegalCopyright "Copyright (C) 2026 NyxSlate" --set-file-version 1.0.0 --set-product-version 1.0.0
                Write-Host "  + Created NyxSlate.exe with custom embedded icon" -ForegroundColor Green
            }
        }
    }
else {
    Write-Host "  WARNING: node_modules not found! Run npm install in the project root first." -ForegroundColor Red
}

# Calculate size
$payloadSize = (Get-ChildItem -Recurse -File $payloadDir | Measure-Object -Property Length -Sum).Sum
$sizeMB = [math]::Round($payloadSize / 1MB, 1)
$fileCount = (Get-ChildItem -Recurse -File $payloadDir | Measure-Object).Count

Write-Host ""
Write-Host "==================================================" -ForegroundColor Cyan
Write-Host "  Payload built successfully!" -ForegroundColor Green
Write-Host "  Files: $fileCount" -ForegroundColor White
Write-Host "  Size:  $sizeMB MB" -ForegroundColor White
Write-Host "  Path:  $payloadDir" -ForegroundColor White
Write-Host "==================================================" -ForegroundColor Cyan
Write-Host ""
Write-Host "Next steps:" -ForegroundColor Yellow
Write-Host "  1. cd installer" -ForegroundColor White
Write-Host "  2. npm install" -ForegroundColor White
Write-Host "  3. npm start        (to test the installer)" -ForegroundColor White
Write-Host "  4. npm run build    (to create the final .exe)" -ForegroundColor White
Write-Host ""
