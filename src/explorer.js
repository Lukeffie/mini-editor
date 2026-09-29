import * as files from "./files.js";
import { patchSettings } from "./settings.js";
import { SUPPORTED_EXT } from "./preview.js";

let currentDir = null;
let onOpenFile = null;
let onOpenFileInNewPage = null;
let els = {};

export function initExplorer(opts) {
  onOpenFile = opts.onOpenFile;
  onOpenFileInNewPage = opts.onOpenFileInNewPage;
  els = {
    list: document.getElementById("file-list"),
    dirPath: document.getElementById("dir-path"),
    btnOpenDir: document.getElementById("btn-open-dir"),
    ctxMenu: document.getElementById("file-ctx-menu"),
  };
  els.btnOpenDir.addEventListener("click", pickDir);
  setupFileCtxMenu();

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
    // 供右键菜单识别条目：data-path 存在即代表是一个文件/目录条目
    li.dataset.path = e.path;
    li.dataset.dir = e.is_dir ? "1" : "0";
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

// ===== 文件树右键菜单 =====
// 文件列表里任何位置都阻止 WebView 原生菜单（原生菜单里有"打印"等项），
// 命中具体条目时才弹出应用内菜单。
function setupFileCtxMenu() {
  const menu = els.ctxMenu;
  if (!menu) return;

  els.list.addEventListener("contextmenu", (e) => {
    e.preventDefault(); // 屏蔽原生菜单（含"打印"）
    const li = e.target.closest && e.target.closest("li[data-path]");
    if (!li) {
      hideFileCtxMenu();
      return;
    }
    showFileCtxMenu(
      { path: li.dataset.path, is_dir: li.dataset.dir === "1" },
      e.clientX,
      e.clientY
    );
  });

  document.addEventListener("click", (e) => {
    if (!menu.hidden && !menu.contains(e.target)) hideFileCtxMenu();
  });
  document.addEventListener("contextmenu", (e) => {
    // 在文件列表上右键由上面的逻辑处理，其余位置隐藏旧菜单
    if (e.target.closest && e.target.closest("#file-list")) return;
    hideFileCtxMenu();
  });
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape") hideFileCtxMenu();
  });
  window.addEventListener("blur", hideFileCtxMenu);
  window.addEventListener("resize", hideFileCtxMenu);
}

function showFileCtxMenu(entry, x, y) {
  const menu = els.ctxMenu;
  const items = [];

  if (entry.is_dir) {
    items.push({ label: "打开", action: () => loadDir(entry.path) });
  } else {
    items.push({ label: "打开", action: () => onOpenFile && onOpenFile(entry.path) });
    items.push({
      label: "在新页面中打开",
      // 即使该文件已经开着，也另开新页签（对应浏览器"在新标签页打开"）
      action: () => onOpenFileInNewPage && onOpenFileInNewPage(entry.path),
    });
  }

  items.forEach((it) => {
    if (it.sep) {
      const sep = document.createElement("div");
      sep.className = "ctx-sep";
      menu.appendChild(sep);
      return;
    }
    const mi = document.createElement("div");
    mi.className = "ctx-item";
    mi.textContent = it.label;
    mi.addEventListener("click", () => {
      hideFileCtxMenu();
      it.action();
    });
    menu.appendChild(mi);
  });

  menu.hidden = false;
  // 先定位到左上角量出实际尺寸，再回夹到视口内，避免菜单超出屏幕被裁切
  menu.style.left = "0px";
  menu.style.top = "0px";
  const r = menu.getBoundingClientRect();
  menu.style.left = Math.max(4, Math.min(x, window.innerWidth - r.width - 4)) + "px";
  menu.style.top = Math.max(4, Math.min(y, window.innerHeight - r.height - 4)) + "px";
}

function hideFileCtxMenu() {
  const menu = els.ctxMenu;
  if (!menu) return;
  menu.hidden = true;
  menu.innerHTML = "";
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
