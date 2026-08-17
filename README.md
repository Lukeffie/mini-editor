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

## 安装与构建

环境安装（Node.js / Rust / VS 生成工具）、本地开发、打包成 `.msi` 等所有操作步骤，请见 **[SETUP.md](./SETUP.md)**。

## 已知说明

- Markdown 渲染允许原始 HTML（marked 默认行为）。仅用于查看自己本地的文件，请勿打开来源不明的 .md。
- 设置目前用 WebView 的 localStorage 持久化，零额外依赖；如需跨用户/系统级持久化可改用 Tauri store 插件。
