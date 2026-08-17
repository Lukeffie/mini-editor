# 极简编辑器 — 本机安装与打包指南

> 本文件专门说明**如何在本机安装环境、构建并打包**本项目。
> 软件的功能介绍与目录结构请见 [README.md](./README.md)。

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

## 二、安装前端依赖与图标（首次需要）

进入项目目录后：

```powershell
cd <项目目录>
npm install          # 安装前端依赖
npm run icons        # 生成 src-tauri/icons/ 下的图标（首次必须）
```

> `npm run icons` 会向 `src-tauri/icons/` 写入 32x32.png、128x128.png、128x128@2x.png、icon.ico。
> 也可以用官方工具：`npx tauri icon 你的logo.png`。

## 三、构建并产出 MSI（一键命令）

项目里已内置打包脚本，**只需要跑一条命令**，安装包会自动复制到项目根目录。

### 方式 A（最省事）：双击 `build.bat`
直接双击项目管理目录里的 **`build.bat`** 即可（会弹出黑窗口自动跑完，结束前按任意键关闭）。
它依次执行：① `npm install` ② `tauri build --bundles msi` ③ 复制 `.msi` 到根目录。

### 方式 B：在 PowerShell / 命令行里跑同一脚本
```powershell
cd <项目目录>
.\build.bat
```

### 方式 C：npm 脚本
```powershell
cd <项目目录>
npm install
npm run pack
```
> `npm run pack` = `tauri build --bundles msi` + `node scripts/copy-msi.mjs`（把产物搬到根目录）。

首次 `tauri build` 会联网下载并缓存 WiX 工具链（之后复用），耐心等待即可。

### 产物（已在项目根目录）
```
<项目目录>\MiniEditor_1.0.0_x64_en-US.msi
```
（原始产物仍在 `src-tauri\target\release\bundle\msi\`，根目录为复制件，方便拿取。）
体积约 **5–15 MB**，双击安装（默认装到当前用户的 `%LOCALAPPDATA%`，无需管理员）。

> ⚠️ **产品名必须是英文/ASCII**：`tauri.conf.json` 里的 `productName` 当前设为 `MiniEditor`。
> 若改回中文（如「极简编辑器」），WiX 会把中文拼进注册表路径、快捷方式、卸载名等处，
> 而安装包默认代码页 1252 装不下中文，会连环报 `LGHT0101/LGHT0311` 链接失败。
> 应用窗口标题是单独设的（仍是中文），不受 `productName` 影响。

---

## 四、调试与开发

```powershell
npm run tauri dev     # 热重载开发预览
```

---

## 五、常见坑

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

## 六、文件浏览器与左右滚动联动

### 左侧文件浏览器
- 点「打开目录」选一个文件夹，左侧列出其中文件（目录在上、可逐级进入，`..` 返回上级）。
- 点文件即在右侧编辑+预览；`txt/md/html` 自动识别预览类型，也可手动用「自动/Markdown/HTML/文本」切换。
- 上次打开的目录会被记住，下次启动自动列出。

### 左右滚动联动
- 编辑（左）与预览（右）滚动**双向联动**，对应行尽量显示在同一行。
- 实现：Markdown 的各级标题、纯文本的每一行都标注了源文件行号（`data-line`），滚动一侧时按行号插值对齐另一侧。
- HTML 预览用的是沙箱 iframe，无法做行级映射，故 HTML 模式不参与联动（仅 Markdown / 纯文本生效）。

### 构建说明
- 一键打包用双击 **`build.bat`** 或 `npm run pack`（二者等价），产物会自动落到项目根目录（`<项目目录>` 下）。
- 想消除 SmartScreen「未知发布者」警告
  → 用 `signtool` 对 msi 签名（需代码签名证书）。
