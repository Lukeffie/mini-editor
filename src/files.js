import { invoke } from "@tauri-apps/api/core";

const isTauri =
  typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;

export async function pickOpen() {
  if (isTauri) return await invoke("pick_open");
  return fallback("open");
}

export async function pickSave() {
  if (isTauri) return await invoke("pick_save");
  return fallback("save");
}

export async function readFile(path) {
  if (isTauri) return await invoke("read_file", { path });
  throw new Error("当前环境不支持文件读取");
}

// 读取文件为 base64 data URI（Tauri 下可用，浏览器环境不支持）
export async function readFileBase64(path) {
  if (isTauri) return await invoke("read_file_base64", { path });
  return null;
}

// 用系统默认程序打开文件（不支持的二进制格式直接交给系统处理）。浏览器环境不支持。
export async function openInSystem(path) {
  if (isTauri) return await invoke("open_in_system", { path });
  throw new Error("当前环境不支持用系统程序打开文件");
}

// 取回文件关联启动时传入的待打开路径（仅 Tauri，且只取一次）
export async function getLaunchPath() {
  if (isTauri) return await invoke("get_launch_path");
  return null;
}

// 在新窗口中打开文件（仅 Tauri）：以当前程序加文件路径再启动一个实例
export async function openInNewWindow(path) {
  if (isTauri) return await invoke("open_in_new_window", { path });
  throw new Error("当前环境不支持在新窗口中打开");
}

export async function writeFile(path, content) {
  if (isTauri) return await invoke("write_file", { path, content });
  throw new Error("当前环境不支持文件写入");
}

// 打开目录选择框，返回目录路径或 null
export async function openDirectory() {
  if (isTauri) return await invoke("open_directory");
  return null;
}

// 列出目录内容：返回 [{ name, path, is_dir }]
export async function listDirectory(path) {
  if (isTauri) return await invoke("list_directory", { path });
  return [];
}

// 在指定目录内新建一个空文件，返回新建文件的完整路径
export async function createFile(dir, name) {
  if (isTauri) return await invoke("create_file", { dir, name });
  throw new Error("当前环境不支持新建文件");
}

// 在指定目录内新建文件夹
export async function createDir(dir, name) {
  if (isTauri) return await invoke("create_dir", { dir, name });
  throw new Error("当前环境不支持新建文件夹");
}

// 浏览器环境（vite dev）下的退化方案，仅用于本地预览 UI。
function fallback(mode) {
  return new Promise((resolve) => {
    const i = document.createElement("input");
    i.type = "file";
    if (mode === "open") i.accept = ".txt,.md,.markdown,.html,.htm,.json,.xml,text/*";
    i.onchange = () =>
      resolve(i.files[0] ? i.files[0].name : null);
    i.click();
  });
}
