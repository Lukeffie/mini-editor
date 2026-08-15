import * as files from "./files.js";
import { patchSettings } from "./settings.js";

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

  const liUp = document.createElement("li");
  liUp.innerHTML = `<span class="ic">📁</span><span class="name">..（上一级）</span>`;
  liUp.addEventListener("click", () => {
    const p = parentDir(dir);
    if (p) loadDir(p);
  });
  els.list.appendChild(liUp);

  for (const e of entries) {
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
  if (["png", "jpg", "jpeg", "gif", "svg", "webp", "bmp", "ico"].includes(ext)) return "🖼️";
  if (["css", "js", "ts", "json", "rs", "py"].includes(ext)) return "⚙️";
  return "📄";
}

function parentDir(p) {
  const sep = p.includes("\\") ? "\\" : "/";
  const parts = p.split(sep).filter(Boolean);
  if (parts.length <= 1) return null;
  parts.pop();
  return parts.join(sep) || (sep === "\\" ? parts[0] + "\\" : "/");
}
