@echo off
setlocal
cd /d "%~dp0"

if exist "%~dp0node_modules\electron\dist\NyxSlate.exe" (
    start "" "%~dp0node_modules\electron\dist\NyxSlate.exe" "%~dp0." %*
) else (
    start "" "%~dp0node_modules\electron\dist\electron.exe" "%~dp0." %*
)
