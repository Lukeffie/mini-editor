# 极简编辑器（mini-editor）

Windows 桌面用的极简文本编辑器：左侧编辑、右侧实时预览，支持 **Markdown** 与 **HTML** 预览，可通过设置按百分比调整左右分栏比例，分隔条也可直接拖动。

技术栈：**Tauri 2（Rust 后端 + WebView2 前端）** + **CodeMirror 6** + **marked** + **highlight.js**。

## 目录结构

```
mini-editor/
├── index.html              # 入口
├── src/                    # 前端（编辑器 / 预览 / 分栏 / 设置）
│   ├── main.js
│   ├── editor.js           # CodeMirror 封装
│   ├── preview.js          # Markdown / HTML / 文本 渲染
│   ├── split.js            # 分栏拖拽
│   ├── settings.js         # 设置持久化（localStorage）
│   ├── files.js            # 文件读写（Tauri invoke，带浏览器退化方案）
│   └── style.css
├── src-tauri/              # Rust 后端
│   ├── Cargo.toml
│   ├── build.rs
│   ├── tauri.conf.json     # 仅打 msi
│   ├── capabilities/default.json
│   ├── src/main.rs         # 文件打开/保存/读写命令
│   └── icons/              # 图标
└── scripts/gen-icons.mjs   # 生成图标用的纯 Node 脚本
```

## 功能

- 新建 / 打开（.txt/.md/.html）/ 保存 / 另存为
- Markdown 实时预览（代码块高亮），HTML 预览（沙箱 iframe 隔离），纯文本预览
- 左侧编辑、右侧预览，分栏比例可在「设置」里用滑块调（20%–80%），也可拖中间分隔条
- 设置项：分栏比例、浅/深主题、字体大小、自动保存；均持久化
- 快捷键：Ctrl+S 保存，Ctrl+O 打开

## 开发 / 构建

### 1. 前置依赖（一次性，仅本机需要）

- **Rust**：https://rustup.rs （默认带 `x86_64-pc-windows-msvc`）
- **Visual Studio Build Tools**：勾选「桌面开发 with C++」工作负载（提供 MSVC 链接器，缺它会报找不到 `link.exe`）
- **Node.js** LTS
- **Tauri CLI**：`npm install -g @tauri-apps/cli`（或全程用 `npx tauri`）

> Windows 10 / 11 已自带 WebView2 运行时，无需额外安装。

### 2. 安装前端依赖

```bash
cd mini-editor
npm install
```

### 3. 生成图标（首次需要）

```bash
npm run icons
```

> 脚本会向 `src-tauri/icons/` 写入 32x32.png、128x128.png、128x128@2x.png、icon.ico。
> 也可以用官方工具：`npx tauri icon 你的logo.png`。

### 4. 本地开发预览（热更新，浏览器里跑前端）

```bash
npm run tauri dev
```

### 5. 打包成 .msi

```bash
npm run tauri build
```

产物位于：

```
src-tauri/target/release/bundle/msi/极简编辑器_1.0.0_x64_zh-CN.msi
```

体积约 5–15 MB。双击安装即可，无需管理员权限（默认装到当前用户的 `%LOCALAPPDATA%`）。

## 只打 msi / 改安装行为

- 已在 `tauri.conf.json` 设 `"targets": ["msi"]`，只产出 MSI。
- WebView2 安装模式：`bundle.windows.webviewInstallMode.type`，可选
  `downloadBootstrapper`（默认，包小、装时联网）/ `embedBootstrapper` / `offlineInstaller`（完全离线）/ `skip`（要求用户系统已有 WebView2）。
- 多语言：已配 `["zh-CN","en-US"]`，会各出一个 msi。
- 代码签名：用 `signtool` 对 msi 签名可消除 Windows SmartScreen 警告。

## 已知说明

- Markdown 渲染允许原始 HTML（marked 默认行为）。仅用于查看自己本地的文件，请勿打开来源不明的 .md。
- 设置目前用 WebView 的 localStorage 持久化，零额外依赖；如需跨用户/系统级持久化可改用 Tauri store 插件。
