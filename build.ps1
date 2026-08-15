# ============================================================
#  一键打包脚本（Windows / PowerShell）
#  作用：安装依赖 -> 编译并打包 MSI -> 复制安装包到项目根目录
#  用法（在 PowerShell 中进入本文件所在目录后执行）：
#      .\build.ps1
#  前置：已安装 Node.js、Rust(rustup)、Visual Studio 2022 Build Tools(C++ 桌面)
# ============================================================
$ErrorActionPreference = 'Stop'
$root = $PSScriptRoot
Set-Location $root

Write-Host "`n==> [1/3] 安装前端依赖（已装则自动跳过）" -ForegroundColor Cyan
npm install

Write-Host "`n==> [2/3] 编译并打包 MSI（首次约需数分钟，请耐心等待）" -ForegroundColor Cyan
npm run tauri -- build --bundles msi

Write-Host "`n==> [3/3] 复制安装包到项目根目录" -ForegroundColor Cyan
node scripts/copy-msi.mjs

Write-Host "`n完成。安装包位于：$root" -ForegroundColor Green
Write-Host "双击根目录下的 .msi 即可安装。`n"
