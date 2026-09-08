@echo off
start "" "%~dp0node_modules\electron\dist\electron.exe" --no-sandbox "%~dp0uninstaller-main.js"
