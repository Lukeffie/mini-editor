# 极简编辑器 — 本机安装与打包指南

项目已落在：`F:\work\gitee\mini-editor\`
（左侧 CodeMirror 编辑，右侧 Markdown/HTML/纯文本预览，分栏比例可调并持久化）

---

## 一、安装环境（仅首次）

> ⚠️ **每次用 winget 装完一样东西，都必须「关闭并重新打开 PowerShell」**，新装的命令（npm / cargo 等）才会进 PATH，否则会报"无法识别"。
> 需要**管理员**的只有第 3 步（VS 生成工具）。第 1、2 步用户级即可。

### 1. Node.js（必须装，npm 在此包里）
```powershell
winget install OpenJS.NodeJS.LTS
```

### 2. Rust 工具链
```powershell
winget install Rustlang.Rustup
```
装完**重开一个终端**，确认：
```powershell
cargo --version
rustc --version
```

### 3. Visual Studio 生成工具（C++ 桌面 + Windows SDK）—— 需管理员
**方式 A（推荐，winget 静默）：**
```powershell
winget install Microsoft.VisualStudio.2022.BuildTools --silent --override "--add Microsoft.VisualStudio.Workload.VCTools --includeRecommended --wait --quiet"
```
**方式 B（手动）：** 到 https://visualstudio.microsoft.com/zh-hans/downloads/ 下载"生成工具"，
安装时勾选 **「使用 C++ 的桌面开发」**（会自动带上 Windows SDK）。

### 4. WebView2 运行时
Win10 / Win11 已自带，无需操作。老旧系统才需装：
https://developer.microsoft.com/zh-cn/microsoft-edge/webview2/

---

## 二、构建并产出 MSI（一键命令）

项目里已内置打包脚本，**只需要跑一条命令**，安装包会自动复制到项目根目录。

### 方式 A（最省事）：双击 `build.bat`
直接双击项目管理目录里的 **`build.bat`** 即可（会弹出黑窗口自动跑完，结束前按任意键关闭）。
它依次执行：① `npm install` ② `tauri build --bundles msi` ③ 复制 `.msi` 到根目录。

### 方式 B：在 PowerShell / 命令行里跑同一脚本
```powershell
cd F:\work\gitee\mini-editor
.\build.bat
```

### 方式 C：npm 脚本
```powershell
cd F:\work\gitee\mini-editor
npm install
npm run pack
```
> `npm run pack` = `tauri build --bundles msi` + `node scripts/copy-msi.mjs`（把产物搬到根目录）。

首次 `tauri build` 会联网下载并缓存 WiX 工具链（之后复用），耐心等待即可。

### 产物（已在项目根目录）
```
F:\work\gitee\mini-editor\MiniEditor_1.0.0_x64_en-US.msi
```
（原始产物仍在 `src-tauri\target\release\bundle\msi\`，根目录为复制件，方便拿取。）
体积约 **5–15 MB**，双击安装（默认装到当前用户的 `%LOCALAPPDATA%`，无需管理员）。

> ⚠️ **产品名必须是英文/ASCII**：`tauri.conf.json` 里的 `productName` 当前设为 `MiniEditor`。
> 若改回中文（如「极简编辑器」），WiX 会把中文拼进注册表路径、快捷方式、卸载名等处，
> 而安装包默认代码页 1252 装不下中文，会连环报 `LGHT0101/LGHT0311` 链接失败。
> 应用窗口标题是单独设的（仍是中文），不受 `productName` 影响。

---

## 三、调试与开发

```powershell
npm run tauri dev     # 热重载开发预览
```

---

## 四、常见坑

- 报 `找不到 link.exe` / `linker 'link.exe' not found`
  → VS 生成工具没装好，重装并确认勾了「使用 C++ 的桌面开发」。
- 首次打包卡在下载 WiX
  → 检查网络；或手动装 WiX 3.11 并加入 PATH 作兜底。
- 安装包比预期大
  → 配置里已设 `targets: ["msi"]` 只打 MSI；若改成 `"all"` 会同时出 `.exe`。
- 报 `failed to run ...\light.exe` 或 `LGHT0102 / LGHT0311`（localization variable unknown / codepage 1252）
  → 几乎都是**产品名含中文**导致的 WiX 代码页冲突。确认 `tauri.conf.json` 的
    `productName` 是 ASCII（如 `MiniEditor`），且 `wix.language` 只保留 `["en-US"]`，重跑即可。

---

## 五、新增功能（文件浏览器 / 浏览模式）

顶部「浏览模式」按钮在 **编辑模式** 与 **浏览模式** 间切换，状态会记住。

### 编辑模式：左侧文件浏览器
- 点「打开目录」选一个文件夹，左侧列出其中文件（目录在上、可逐级进入，`..` 返回上级）。
- 点文件即在右侧编辑+预览；`txt/md/html` 自动识别预览类型，也可手动用「自动/Markdown/HTML/文本」切换。
- 上次打开的目录会被记住，下次启动自动列出。

### 浏览模式：内置浏览器
- 顶部地址栏输入网址（自动补 `https://`），回车或「前往」；`‹` 后退、`↻` 刷新。
- 左侧面板变为「打开的页签」，可新建 / 切换 / 关闭页签。
- 右侧可收起工具栏（点「▾」）：
  - 「提取元素」：抓取当前页面全部资源（图片 / 链接 / 脚本 / 样式表）。
  - 按类型筛选；勾选多个后「下载选中」批量下载，或每条右侧「下载」单下。
  - 首次下载会让你选一个保存目录，之后本会话内复用。
- 顶部地址栏右侧「⌨」按钮：展开/收起**控制台**（见下）。

> ⚠️ **元素提取与下载走 Rust 端 `ureq` 同步请求**（避开前端跨域限制），因此本地文件与绝大多数网页都能抓；
> 但页面里由 JS 动态懒加载的图片（如 `srcset`/`lazy`）静态解析可能漏抓，属已知限制。
> 浏览器预览本身用 iframe 渲染，不受此限制。

### 本次新增 1：浏览器「真实内核」+ 控制台
- **点击无反应的根因**：之前用跨源 iframe 直接加载网页，父页面无法接管 `target=_blank` / `window.open`，也抓不到页面内部的 `console`，所以很多链接、弹窗「点了没反应」。
- **新做法**：远程网页改用**同源 `srcdoc` 代理渲染**（底层仍是 WebView2 / Edge 内核，不是另起系统 Edge 进程）：
  - 页面脚本正常执行，链接 / 弹窗（含 `target=_blank`）被接管并在本标签页内继续浏览；
  - 注入脚本接管 `console.*` 与 `window.onerror`、未捕获 Promise，回传到主窗口；
  - 顶部「⌨」按钮打开底部**控制台面板**，实时显示页面日志（log/info/warn/error 分色），可清空。
- **本地 `file://` 文件**仍直接加载（避免 file:// 子资源在 srcdoc 中被拦截），因此本地文件的控制台不回传，属取舍。
- **不留下任何痕迹**：浏览用的是 Tauri 自带的 WebView2，**与系统 Edge 浏览器完全隔离**（不会写入系统 Edge 的历史/缓存/Cookie），从根上满足「不在 Edge 中留痕」。

> ⚠️ **局限**：`srcdoc` 代理抓取的是静态 HTML，页面内的 JS 动态请求（如 SPA 调接口拉数据）会因跨域在本源下失败，因此 React/Vue 这类单页应用可能显示空白骨架。这是代理式预览的固有取舍；如需完整内核体验可改走独立 WebView 窗口方案（另行评估）。

### 本次新增 2：编辑模式左右滚动联动
- 编辑（左）与预览（右）滚动**双向联动**，对应行尽量显示在同一行。
- 实现：Markdown 的各级标题、纯文本的每一行都标注了源文件行号（`data-line`），滚动一侧时按行号插值对齐另一侧。
- HTML 预览用的是沙箱 iframe，无法做行级映射，故 HTML 模式不参与联动（仅 Markdown / 纯文本生效）。

### 构建说明

### 构建说明
- 一键打包用双击 **`build.bat`** 或 `npm run pack`（二者等价），产物会自动落到项目根目录。
- 本轮后端新增 `ureq` 依赖（同步 HTTP 客户端，轻量、无需系统 TLS 库）。
  **首次重新构建会编译 `ureq` 及其依赖，比之前多花几分钟**，属正常。
- 同时放宽了 `tauri.conf.json` 的 CSP（`frame-src *` 等），否则 iframe 无法加载外部网页，必须重新构建才能生效。
- 想消除 SmartScreen「未知发布者」警告
  → 用 `signtool` 对 msi 签名（需代码签名证书）。
