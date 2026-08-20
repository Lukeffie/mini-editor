# 应用图标生成工具

将任意 PNG 设计稿转换为 Tauri 打包所需的全部图标格式。

## 工具

`scripts/make-icons.mjs`（纯 Node，零外部依赖，无需安装任何包）。

它会：

1. 解码源 PNG（支持 8-bit RGB / RGBA，自动处理 PNG 行 filter：None/Sub/Up/Average/Paeth）。
2. 用最近邻算法缩放为目标尺寸（保持透明通道）。
3. 编码输出 PNG 与 Windows `.ico`。

## 用法

```bash
# 使用默认源图
npm run icons

# 指定其他源图
npm run make:icons -- "路径/源图.png"
```

> `npm run icons` 已指向本工具。`npm run gen-icons` 仍保留，用于生成纯色占位图标（无源图时备用）。

## 默认源图

```
C:\Users\Luke\Pictures\多风格设计方案.png
```

更换设计稿时，只需替换该文件或传入新路径，再运行命令即可。

## 输出

写入 `src-tauri/icons/`：

| 文件               | 尺寸     | 用途                          |
| ------------------ | -------- | ----------------------------- |
| `32x32.png`        | 32×32    | 任务栏 / 小尺寸               |
| `128x128.png`      | 128×128  | 常规图标                      |
| `128x128@2x.png`   | 256×256  | 高分屏（macOS 命名约定，Tauri 要求） |
| `icon.ico`         | 256×256  | Windows 可执行文件 / 安装包图标 |

## 支持的源图格式

- 8-bit 位深，color type 2（RGB）或 6（RGBA）。
- 大多数设计软件导出、截图保存的 PNG 均满足。
- 透明背景会被保留（RGBA）。

## 算法说明

- 缩放采用**最近邻插值**。几何 / 扁平 / 文字类图标效果清晰、无模糊；
  若设计稿含精细渐变或希望更平滑，可把 `scaleImage` 替换为双线性 /  Lanczos 插值。
- 图标为正方形，源图若非正方形会按目标尺寸拉伸（建议提供正方形设计稿）。

## 自定义输出尺寸

编辑 `scripts/make-icons.mjs` 中的 `targets` 数组：

```js
const targets = [
  [32, "32x32.png"],
  [128, "128x128.png"],
  [256, "128x128@2x.png"],
];
```

`tauri.conf.json` 中的 `bundle.icon` 列表需与之对应，默认已匹配。
