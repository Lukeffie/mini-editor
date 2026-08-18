# 极简编辑器（mini-editor）

一款面向 Windows 桌面的**极简文本 / Markdown / HTML 编辑器**：左侧编辑、右侧实时预览，界面干净、启动快、安装包小（约 5–15 MB）。

- 应用窗口标题：**极简编辑器**
- 安装包产品名（ASCII）：**MiniEditor**
- 应用标识：`com.mini.editor`
- 版本：`1.0.0`
- 平台：Windows（当前仅打包 MSI）

## 技术栈

| 层 | 技术 |
|---|---|
| 桌面外壳 | **Tauri 2**（Rust 后端 + WebView2 前端） |
| 编辑器内核 | **CodeMirror 6** |
| Markdown 渲染 | **marked** |
| 代码高亮 | **highlight.js**（GitHub 主题） |
| 构建工具 | **Vite 5** |

## 核心特性

- 新建 / 打开（`.txt` / `.md` / `.html`）/ 保存 / 另存为
- **Markdown 实时预览**（代码块高亮）、**HTML 预览**（沙箱 `iframe` 隔离）、**纯文本预览**
- 左侧编辑、右侧预览，分栏比例可在「设置」里用滑块调（20%–80%），也可拖中间分隔条
- 左侧**文件浏览器**：打开目录、逐级进入、返回上级、记住上次目录
- 编辑与预览**双向滚动联动**（Markdown / 纯文本按行号对齐；HTML 模式不参与）
- 三种视图：编辑全屏 / 分栏 / 预览全屏，一键切换
- 设置项：**分栏比例、6 种视觉风格（极致极简/清新薄荷/高饱和撞色/赛博朋克/复古古典/墨色国风）+ 亮/暗模式、字体大小、自动保存**；均持久化
- 快捷键：`Ctrl+S` 保存、`Ctrl+O` 打开、`Ctrl+N` 新建

## 目录结构

```
mini-editor/
├── index.html              # 入口
├── src/                    # 前端（编辑器 / 预览 / 分栏 / 文件树 / 设置）
│   ├── main.js             # 应用装配、菜单、视图切换
│   ├── editor.js           # CodeMirror 6 封装
│   ├── preview.js          # Markdown / HTML / 文本渲染
│   ├── split.js            # 分栏拖拽
│   ├── explorer.js         # 文件浏览器
│   ├── scrollsync.js       # 编辑/预览滚动联动
│   ├── settings.js         # 设置持久化（localStorage）
│   ├── files.js            # 文件读写（Tauri invoke + 浏览器退化方案）
│   └── style.css           # 全部视觉样式（含浅/深主题变量）
├── src-tauri/              # Rust 后端
│   ├── Cargo.toml
│   ├── build.rs
│   ├── tauri.conf.json     # 窗口/打包配置（仅打 msi）
│   ├── capabilities/default.json
│   ├── src/main.rs         # 文件打开/保存/读写命令
│   └── icons/              # 图标（由 scripts/gen-icons.mjs 生成）
├── scripts/
│   ├── gen-icons.mjs       # 纯 Node 生成图标脚本
│   └── copy-msi.mjs        # 打包后复制 msi 到根目录
├── build.bat / build.ps1   # 一键打包脚本
├── dev.bat                 # 开发启动
└── vite.config.js
```

## 快速开始

```powershell
npm install          # 安装前端依赖
npm run icons        # 生成 src-tauri/icons/ 下的图标（首次必须）
npm run tauri dev    # 开发预览（热重载）
```

> 环境安装、打包 MSI、常见坑等所有操作步骤，请见 **[SETUP.md](./SETUP.md)**。

## 打包发行

```powershell
.\build.bat          # 等价于 npm install + tauri build --bundles msi + 复制 msi
```

产物：`MiniEditor_1.0.0_x64_en-US.msi`（落在项目根目录，原始产物在 `src-tauri/target/release/bundle/msi/`）。

## 设计资源

- 界面风格、配色、布局与图标规范，见 **[DESIGN.md](./DESIGN.md)**（供 UI / 图标设计参考）。
