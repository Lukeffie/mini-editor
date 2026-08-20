import * as files from "./files.js";
import { patchSettings } from "./settings.js";
import { SUPPORTED_EXT } from "./preview.js";

let currentDir = null;
let onOpenFile = null;
let els = {};

export function initExplorer(opts) {
  onOpenFile = opts.onOpenFile;
  els = {
    list: document.getElementById("file-list"),
    dirPath: document.getElementById("dir-path"),
    btnOpenDir: document.getElementById("btn-open-dir"),
  };
  els.btnOpenDir.addEventListener("click", pickDir);

  const saved = JSON.parse(localStorage.getItem("mini-editor-settings") || "{}");
  if (saved.lastDir) loadDir(saved.lastDir);
}

async function pickDir() {
  const p = await files.openDirectory();
  if (p) loadDir(p);
}

export async function loadDir(path) {
  currentDir = path;
  patchSettings({ lastDir: path });
  els.dirPath.textContent = path;
  let entries;
  try {
    entries = await files.listDirectory(path);
  } catch (e) {
    els.list.innerHTML = `<li class="empty" style="color:var(--text-2);padding:10px">读取失败：${e}</li>`;
    return;
  }
  renderList(entries, path);
}

function renderList(entries, dir) {
  els.list.innerHTML = "";

  // 默认排序：文件夹置顶，文件在后，均按名称字符升序
  const sorted = [...entries].sort((a, b) => {
    if (a.is_dir !== b.is_dir) return a.is_dir ? -1 : 1;
    return a.name.localeCompare(b.name, "zh-Hans-CN");
  });

  const liUp = document.createElement("li");
  liUp.innerHTML = `<span class="ic">📁</span><span class="name">..（上一级）</span>`;
  liUp.addEventListener("click", () => {
    const p = parentDir(dir);
    if (p) loadDir(p);
  });
  els.list.appendChild(liUp);

  for (const e of sorted) {
    // 仅显示支持的文件格式（目录始终显示）
    if (!e.is_dir) {
      const ext = (e.name.split(".").pop() || "").toLowerCase();
      if (!SUPPORTED_EXT.includes(ext)) continue;
    }
    const li = document.createElement("li");
    const ic = e.is_dir ? "📁" : iconFor(e.name);
    li.innerHTML = `<span class="ic">${ic}</span><span class="name"></span>`;
    li.querySelector(".name").textContent = e.name;
    li.title = e.path;
    li.addEventListener("click", () => {
      if (e.is_dir) loadDir(e.path);
      else if (onOpenFile) onOpenFile(e.path);
    });
    els.list.appendChild(li);
  }
}

function iconFor(name) {
  const ext = (name.split(".").pop() || "").toLowerCase();
  if (["md", "markdown"].includes(ext)) return "📝";
  if (["html", "htm"].includes(ext)) return "🌐";
  if (["txt"].includes(ext)) return "📄";
  if (["json"].includes(ext)) return "🔧";
  if (["xml"].includes(ext)) return "📰";
  if (["png", "jpg", "jpeg", "gif", "svg", "webp", "bmp", "ico"].includes(ext)) return "🖼️";
  if (["css", "js", "ts", "rs", "py"].includes(ext)) return "⚙️";
  return "📄";
}

function parentDir(p) {
  const sep = p.includes("\\") ? "\\" : "/";
  // 去掉尾随分隔符后再拆分，避免 "C:\" 被拆成 ["C:", ""]
  const norm = p.replace(new RegExp(`\\${sep}+$`), "");
  const parts = norm.split(sep).filter(Boolean);
  // 已到盘符根目录（如 C:）或系统根（/），不再向上
  if (parts.length <= 1) return null;
  parts.pop();
  // 回到 Windows 盘符根目录时补全尾部分隔符，确保指向 C:\ 而非相对的 C:
  if (parts.length === 1 && /^[a-zA-Z]:$/.test(parts[0])) return parts[0] + sep;
  return parts.join(sep);
}
