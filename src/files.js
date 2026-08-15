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

// 抓取网页 HTML（用于元素提取），返回文本
export async function fetchHtml(url) {
  if (isTauri) return await invoke("fetch_html", { url });
  // 浏览器环境下直接 fetch（会受 CORS 限制）
  const r = await fetch(url);
  return await r.text();
}

// 下载一个 URL 到指定目录，返回保存路径
export async function downloadUrl(url, dir) {
  if (isTauri) return await invoke("download_url", { url, dir });
  throw new Error("当前环境不支持下载");
}

// 浏览器环境（vite dev）下的退化方案，仅用于本地预览 UI。
function fallback(mode) {
  return new Promise((resolve) => {
    const i = document.createElement("input");
    i.type = "file";
    if (mode === "open") i.accept = ".txt,.md,.markdown,.html,.htm,text/*";
    i.onchange = () =>
      resolve(i.files[0] ? i.files[0].name : null);
    i.click();
  });
}
