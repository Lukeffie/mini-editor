import { createEditor } from "./editor.js";
import { render, detectMode } from "./preview.js";
import { setupSplit } from "./split.js";
import { loadSettings, saveSettings } from "./settings.js";
import * as files from "./files.js";
import "highlight.js/styles/github.css";
import "./style.css";
import { initExplorer } from "./explorer.js";
import { setupScrollSync } from "./scrollsync.js";

const $ = (id) => document.getElementById(id);

// DOM 元素延迟到 DOMContentLoaded 中统一获取，避免在脚本早于 DOM 解析时取到 null
let editorPane = null;
let divider = null;
let split = null;
let previewEl = null;
let iframeEl = null;
let titleEl = null;
let statusChars = null;
let statusSaved = null;
let modeSelect = null;
let settingsModal = null;
let aboutModal = null;

let settings = loadSettings();
let currentPath = null;
let currentMode = "md";
let previewTimer = null;
let autoSaveTimer = null;

const editor = createEditor($("editor"), {
  initialDoc:
    "# 欢迎使用极简编辑器\n\n左边编辑，右边实时预览。\n\n- 支持 **Markdown** 渲染\n- 支持 HTML 预览（沙箱隔离）\n- 左侧可「打开目录」批量管理文件\n- 快捷键：Ctrl+S 保存，Ctrl+O 打开\n",
  onChange: (text) => onContentChange(text),
});

function applySettings() {
  editorPane.style.flexBasis = settings.ratio + "%";
  // 应用风格 + 亮/暗
  if (settings.style === "minimal") document.body.removeAttribute("data-style");
  else document.body.setAttribute("data-style", settings.style);
  document.body.classList.toggle("dark", !!settings.dark);
  document.documentElement.style.setProperty("--editor-font", settings.fontSize + "px");
  $("ratio").value = settings.ratio;
  $("ratio-out").textContent = `${settings.ratio}% / ${100 - settings.ratio}%`;
  if ($("style-select")) $("style-select").value = settings.style;
  if ($("dark-toggle")) $("dark-toggle").checked = settings.dark;
  $("font-size").value = settings.fontSize;
  $("font-size-out").textContent = settings.fontSize + "px";
  $("auto-save").checked = settings.autoSave;
  updateStyleMenu();
}

// 切换风格：更新设置、立即生效并持久化（重新打开仍为该风格）
function setStyle(style) {
  settings.style = style;
  applySettings();
  saveSettings(settings);
}

// 切换亮/暗模式
function setDark(dark) {
  settings.dark = dark;
  applySettings();
  saveSettings(settings);
}

// 在视图菜单中标记当前风格与亮/暗状态
function updateStyleMenu() {
  document.querySelectorAll('[data-action^="style-"]').forEach((li) => {
    li.classList.toggle("theme-active", settings.style === li.dataset.action.slice(6));
  });
  document.querySelectorAll('[data-action^="mode-"]').forEach((li) => {
    const isDark = li.dataset.action === "mode-dark";
    li.classList.toggle("theme-active", settings.dark === isDark);
  });
}

function schedulePreview(text) {
  clearTimeout(previewTimer);
  previewTimer = setTimeout(() => render(previewEl, iframeEl, text, currentMode), 200);
}

function onContentChange(text) {
  statusSaved.textContent = "未保存";
  statusChars.textContent = text.length + " 字符";
  schedulePreview(text);
  if (settings.autoSave && currentPath) {
    clearTimeout(autoSaveTimer);
    autoSaveTimer = setTimeout(() => saveFile(currentPath), 800);
  }
}

function updateMode() {
  currentMode = detectMode(currentPath, modeSelect.value);
  schedulePreview(editor.getContent());
}
function openSettings() {
  applySettings();
  if (typeof settingsModal.showModal === "function") settingsModal.showModal();
  else settingsModal.hidden = false;
}
function openAbout() {
  if (typeof aboutModal.showModal === "function") aboutModal.showModal();
  else aboutModal.hidden = false;
}
// 所有 DOM 获取与事件绑定统一在 DOMContentLoaded 后执行，确保元素一定存在
window.addEventListener("DOMContentLoaded", () => {
  editorPane = $("editor-pane");
  divider = $("divider");
  split = $("editor-area");
  previewEl = $("preview");
  iframeEl = $("preview-frame");
  titleEl = $("title");
  statusChars = $("status-chars");
  statusSaved = $("status-saved");
  modeSelect = $("mode-select");

  if (modeSelect) modeSelect.addEventListener("change", updateMode);
  else console.error("初始化警告：未找到 #mode-select 元素，请确认运行的是最新构建的前端代码。");

setupSplit({
  container: split,
  editorPane,
  divider,
  onRatioChange: (r) => {
    const rr = Math.round(r);
    settings.ratio = rr;
    saveSettings(settings);
    $("ratio-out").textContent = `${rr}% / ${100 - rr}%`;
    $("ratio").value = rr;
    // 仅同步视图状态标记（不重设 flex-basis，否则会覆盖拖动值）
    currentView = rr <= 0 ? "preview" : rr >= 100 ? "editor" : "split";
    document.body.dataset.view = currentView;
    updateViewSwitch();
    editor.refresh();
  },
});

// ---- 文件浏览器 ----
function openFile(path) {
  files
    .readFile(path)
    .then((txt) => {
      currentPath = path;
      editor.setContent(txt);
      titleEl.textContent = "极简编辑器 — " + path.split(/[\\/]/).pop();
      statusSaved.textContent = "已打开";
      updateMode();
    })
    .catch((e) => {
      statusSaved.textContent = "打开失败";
      console.error(e);
    });
}
initExplorer({ onOpenFile: openFile });
setupScrollSync({ editor, previewPane: $("preview-pane"), previewEl: $("preview") });

// settings / about modal dialogs
settingsModal = $("settings-modal");
aboutModal = $("about-modal");
$("settings-close").addEventListener("click", () => settingsModal.close());
$("about-close").addEventListener("click", () => aboutModal.close());
settingsModal.addEventListener("click", (e) => {
  if (e.target === settingsModal) settingsModal.close();
});
aboutModal.addEventListener("click", (e) => {
  if (e.target === aboutModal) aboutModal.close();
});

$("ratio").addEventListener("input", (e) => {
  const r = +e.target.value;
  settings.ratio = r;
  editorPane.style.flexBasis = r + "%";
  $("ratio-out").textContent = `${r}% / ${100 - r}%`;
  saveSettings(settings);
});
$("style-select").addEventListener("change", (e) => {
  settings.style = e.target.value;
  applySettings();
  saveSettings(settings);
});
$("dark-toggle").addEventListener("change", (e) => {
  settings.dark = e.target.checked;
  applySettings();
  saveSettings(settings);
});
$("font-size").addEventListener("input", (e) => {
  settings.fontSize = +e.target.value;
  applySettings();
  saveSettings(settings);
});
$("auto-save").addEventListener("change", (e) => {
  settings.autoSave = e.target.checked;
  saveSettings(settings);
});

// 初始化：确保所有 DOM 元素已赋值后再应用设置/模式/视图
applySettings();
updateMode();
setView(currentView);
}); // end DOMContentLoaded

// file operations
async function saveFile(path) {
  try {
    await files.writeFile(path, editor.getContent());
    currentPath = path;
    titleEl.textContent = "极简编辑器 — " + path.split(/[\\/]/).pop();
    statusSaved.textContent = "已保存";
  } catch (e) {
    statusSaved.textContent = "保存失败";
    console.error(e);
  }
}

// keyboard shortcuts
window.addEventListener("keydown", (e) => {
  const k = e.key.toLowerCase();
  if ((e.ctrlKey || e.metaKey) && k === "s") {
    e.preventDefault();
    menuActions["save"]();
  }
  if ((e.ctrlKey || e.metaKey) && k === "o") {
    e.preventDefault();
    menuActions["open"]();
  }
  if ((e.ctrlKey || e.metaKey) && k === "n") {
    e.preventDefault();
    menuActions["new"]();
  }
});

// ---- 视图切换：编辑 / 分栏 / 预览 ----
let currentView = "split";
function updateViewSwitch() {
  document.querySelectorAll("#view-switch .view-btn").forEach((b) => {
    b.classList.toggle("active", b.dataset.view === currentView);
  });
}
function setView(view) {
  currentView = view;
  document.body.dataset.view = view;
  updateViewSwitch();
  // 切换视图时同步分栏比例（编辑=0，预览=100，分栏=上次比例）
  if (view === "editor") {
    editorPane.style.flexBasis = "100%";
  } else if (view === "preview") {
    editorPane.style.flexBasis = "0%";
  } else {
    editorPane.style.flexBasis = settings.ratio + "%";
  }
  editor.refresh();
}

// ---- 文件树显示 / 隐藏（折叠为左侧窄工具栏，不全隐藏） ----
let sidebarSavedWidth = "250px";
function toggleSidebar() {
  const sb = $("sidebar");
  const resizer = $("sidebar-resizer");
  const collapsed = sb.classList.toggle("collapsed");
  if (collapsed) {
    // 记住当前宽度，折叠成窄栏
    if (sb.style.flexBasis) sidebarSavedWidth = sb.style.flexBasis;
    sb.style.flexBasis = "44px";
    if (resizer) resizer.setAttribute("hidden", "");
  } else {
    sb.style.flexBasis = sidebarSavedWidth;
    if (resizer) resizer.removeAttribute("hidden");
  }
}

$("btn-toggle-sidebar")?.addEventListener("click", toggleSidebar);

// ---- 右上角视图切换图标 ----
$("view-switch")?.addEventListener("click", (e) => {
  const btn = e.target.closest(".view-btn");
  if (btn) setView(btn.dataset.view);
});

// ---- 字体缩放 ----
function zoom(delta) {
  settings.fontSize = Math.min(22, Math.max(12, settings.fontSize + delta));
  applySettings();
  saveSettings(settings);
}

// ---- 菜单栏动作分发 ----
const menuActions = {
  "new": () => {
    editor.setContent("");
    currentPath = null;
    titleEl.textContent = "极简编辑器 — 未命名";
    statusSaved.textContent = "就绪";
    updateMode();
  },
  "open": async () => {
    const p = await files.pickOpen();
    if (!p) return;
    try {
      const txt = await files.readFile(p);
      currentPath = p;
      editor.setContent(txt);
      titleEl.textContent = "极简编辑器 — " + p.split(/[\\/]/).pop();
      statusSaved.textContent = "已打开";
      updateMode();
    } catch (e) {
      statusSaved.textContent = "打开失败";
      console.error(e);
    }
  },
  "open-dir": () => $("btn-open-dir").click(),
  "save": async () => {
    let p = currentPath;
    if (!p) p = await files.pickSave();
    if (!p) return;
    await saveFile(p);
  },
  "save-as": async () => {
    const p = await files.pickSave();
    if (!p) return;
    await saveFile(p);
  },
  "undo": () => editor.undo(),
  "redo": () => editor.redo(),
  "cut": () => document.execCommand("cut"),
  "copy": () => document.execCommand("copy"),
  "paste": () => document.execCommand("paste"),
  "select-all": () => editor.view.dispatch({ selection: { anchor: 0, head: editor.view.state.doc.length } }),
  "select-line": () => {
    const s = editor.view.state.selection.main;
    const line = editor.view.state.doc.lineAt(s.head);
    editor.view.dispatch({ selection: { anchor: line.from, head: line.to } });
    editor.view.focus();
  },
  "toggle-sidebar": toggleSidebar,
  "view-editor": () => setView("editor"),
  "view-split": () => setView("split"),
  "view-preview": () => setView("preview"),
  "style-minimal": () => setStyle("minimal"),
  "style-mint": () => setStyle("mint"),
  "style-vibrant": () => setStyle("vibrant"),
  "style-cyber": () => setStyle("cyber"),
  "style-classic": () => setStyle("classic"),
  "style-ink": () => setStyle("ink"),
  "mode-light": () => setDark(false),
  "mode-dark": () => setDark(true),
  "zoom-in": () => zoom(1),
  "zoom-out": () => zoom(-1),
  "zoom-reset": () => { settings.fontSize = 14; applySettings(); saveSettings(settings); },
  "settings": openSettings,
  "about": openAbout,
};

document.getElementById("menubar").addEventListener("click", (e) => {
  const item = e.target.closest("[data-action]");
  if (item) {
    const fn = menuActions[item.dataset.action];
    if (fn) fn();
    closeAllMenus();
    return;
  }
  const menu = e.target.closest(".menu");
  if (menu) {
    const open = menu.classList.contains("open");
    closeAllMenus();
    if (!open) {
      menu.classList.add("open");
      if (menu.dataset.menu === "view") updateStyleMenu();
    }
  }
});
document.addEventListener("click", (e) => {
  if (!e.target.closest(".menu")) closeAllMenus();
});
function closeAllMenus() {
  document.querySelectorAll(".menu.open").forEach((m) => m.classList.remove("open"));
}

// ---- 文件树宽度拖拽 ----
(function setupSidebarResize() {
  const resizer = $("sidebar-resizer");
  const sidebar = $("sidebar");
  const workspace = $("workspace");
  if (!resizer || !sidebar || !workspace) return;
  let dragging = false;

  resizer.addEventListener("pointerdown", (e) => {
    e.preventDefault();
    dragging = true;
    resizer.setPointerCapture(e.pointerId);
    document.body.style.cursor = "col-resize";
    document.body.style.userSelect = "none";
  });
  resizer.addEventListener("pointermove", (e) => {
    if (!dragging) return;
    const rect = workspace.getBoundingClientRect();
    let w = e.clientX - rect.left;
    w = Math.min(rect.width - 200, Math.max(160, w));
    sidebar.style.flexBasis = w + "px";
  });
  function stop() {
    if (!dragging) return;
    dragging = false;
    document.body.style.cursor = "";
    document.body.style.userSelect = "";
    try { localStorage.setItem("me.sidebarWidth", sidebar.style.flexBasis); } catch (_) {}
  }
  resizer.addEventListener("pointerup", stop);
  resizer.addEventListener("pointercancel", stop);

  // 恢复上次宽度
  try {
    const saved = localStorage.getItem("me.sidebarWidth");
    if (saved) sidebar.style.flexBasis = saved;
  } catch (_) {}
})();
