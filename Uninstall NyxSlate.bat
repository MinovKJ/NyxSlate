@echo off
if exist "%~dp0node_modules\electron\dist\NyxSlate.exe" (
    start "" "%~dp0node_modules\electron\dist\NyxSlate.exe" --no-sandbox "%~dp0uninstaller-main.js"
) else (
    start "" "%~dp0node_modules\electron\dist\electron.exe" --no-sandbox "%~dp0uninstaller-main.js"
)
