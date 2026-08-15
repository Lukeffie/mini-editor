@echo off
REM ============================================================
REM  One-click build script (Windows / double-click to run)
REM  Steps: npm install -> tauri build msi -> copy msi to root
REM  Requires: Node.js, Rust (rustup), VS 2022 Build Tools (C++)
REM ============================================================
setlocal
cd /d "%~dp0"

echo [1/3] Installing frontend deps (skip if already installed)
call npm install
if errorlevel 1 goto fail

echo.
echo [2/3] Building and packaging MSI (first run takes a few minutes)
call npm run tauri -- build --bundles msi
if errorlevel 1 goto fail

echo.
echo [3/3] Copying installer to project root
node scripts/copy-msi.mjs
if errorlevel 1 goto fail

echo.
echo Done. Installer is at: %~dp0
echo Double-click the .msi in the root folder to install.
pause
exit /b 0

:fail
echo.
echo Build failed. Check the error messages above.
pause
exit /b 1
