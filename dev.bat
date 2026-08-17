@echo off
cd /d "%~dp0"
REM 把 Rust/Cargo 加入 PATH（winget 安装后可能未自动刷新）
set "PATH=%USERPROFILE%\.cargo\bin;%PATH%"
npm run tauri dev
