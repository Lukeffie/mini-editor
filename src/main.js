import { createEditor } from "./editor.js";
import { render, detectMode } from "./preview.js";
import { EditorView } from "codemirror";
import { setupSplit } from "./split.js";
import { loadSettings, saveSettings } from "./settings.js";
import * as files from "./files.js";
import { dirname, join } from "@tauri-apps/api/path";
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
  previewTimer = setTimeout(() => render(previewEl, iframeEl, text, currentMode, currentPath), 200);
}

function onContentChange(text) {
  if (suppressChange) return; // 程序化加载文件，不标记为未保存
  statusSaved.textContent = "未保存";
  statusChars.textContent = text.length + " 字符";
  if (activeTab) setTabDirty(activeTab, true);
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

// ---- 页签（Tab）系统 ----
const tabs = [];
let activeTab = null;
let tabSeq = 0;
let suppressChange = false; // 程序化加载文件时抑制"未保存"标记
const history = []; // 浏览历史（path 序列），用于前进 / 后退
let histIndex = -1;

function updateNavButtons() {
  const b = $("btn-back");
  const f = $("btn-forward");
  if (b) b.disabled = histIndex <= 0;
  if (f) f.disabled = histIndex >= history.length - 1;
}

function renderTabs() {
  const list = $("tab-list");
  if (!list) return;
  list.innerHTML = "";
  tabs.forEach((t) => {
    const el = document.createElement("div");
    el.className = "tab" + (t === activeTab ? " active" : "");
    el.title = t.path;
    // 常驻透明圆点占位，修改后加 .on 显示，保存后去掉 .on 变透明（布局不跳动）
    const dot = document.createElement("span");
    dot.className = "tab-dot" + (t.dirty ? " on" : "");
    dot.title = "未保存";
    el.appendChild(dot);
    const name = document.createElement("span");
    name.className = "tab-name";
    name.textContent = t.path.split(/[\\/]/).pop();
    el.appendChild(name);
    const close = document.createElement("button");
    close.className = "tab-close";
    close.textContent = "×";
    close.title = "关闭";
    close.addEventListener("click", (e) => {
      e.stopPropagation();
      closeTab(t);
    });
    el.appendChild(close);
    el.addEventListener("click", () => switchToTab(t));
    el.addEventListener("contextmenu", (e) => {
      e.preventDefault();
      showTabCtxMenu(t, e.clientX, e.clientY);
    });
    list.appendChild(el);
  });
  updateTabScroll();
}

// 当 tab 列表超出可视宽度时显示左右滚动按钮，并按当前滚动位置启用/禁用
function updateTabScroll() {
  const list = $("tab-list");
  const left = $("tab-scroll-left");
  const right = $("tab-scroll-right");
  if (!list || !left || !right) return;
  const overflow = list.scrollWidth - list.clientWidth;
  const show = overflow > 2;
  left.hidden = !show;
  right.hidden = !show;
  if (show) {
    left.disabled = list.scrollLeft <= 0;
    right.disabled = list.scrollLeft >= overflow - 1;
  }
}

// 点击滚动按钮移动 tab 列表
function setupTabScrollButtons() {
  const list = $("tab-list");
  const left = $("tab-scroll-left");
  const right = $("tab-scroll-right");
  if (!list || !left || !right) return;
  const step = () => Math.max(120, list.clientWidth * 0.8);
  left.addEventListener("click", () => {
    list.scrollLeft -= step();
  });
  right.addEventListener("click", () => {
    list.scrollLeft += step();
  });
  list.addEventListener("scroll", updateTabScroll);
  window.addEventListener("resize", updateTabScroll);
}

// 更新单个页签的未保存标记：圆点常驻，仅切换 .on 透明度，不影响 tab 布局
function setTabDirty(t, v) {
  if (!t || t.dirty === v) return;
  t.dirty = v;
  const list = $("tab-list");
  const idx = tabs.indexOf(t);
  const el = list && list.children[idx];
  const dot = el && el.querySelector(".tab-dot");
  if (dot) {
    dot.classList.toggle("on", v);
  } else {
    renderTabs(); // 兜底：元素不存在时整体重建
  }
}

// 切换到一个已存在的 tab：先保存当前编辑器内容，再加载目标 tab 的内容
function switchToTab(t) {
  if (!t) return;
  if (activeTab) activeTab.content = editor.getContent();
  activeTab = t;
  currentPath = t.path;
  suppressChange = true;
  editor.setContent(t.content != null ? t.content : "");
  suppressChange = false;
  titleEl.textContent = "极简编辑器 — " + t.path.split(/[\\/]/).pop();
  statusSaved.textContent = "已打开";
  updateMode();
  renderTabs();
  // 将当前页签滚动到可见区域
  const list = $("tab-list");
  const idx = tabs.indexOf(t);
  if (list && list.children[idx]) {
    list.children[idx].scrollIntoView({ inline: "nearest", block: "nearest" });
  }
  updateNavButtons();
}

// 本编辑器支持的纯文本/可预览格式；其余（如 xlsx、docx、pdf、图片等二进制）直接交给系统默认程序打开
const TEXT_EXTS = [
  "txt", "md", "markdown", "html", "htm", "json", "xml", "yaml", "yml",
];

// 打开文件为 tab。activate=false 时只登记 tab 不切换当前视图（用于链接点击，避免跳动）。
function openFileInTab(path, { record = true, activate = true } = {}) {
  if (!path) return;
  // 不支持的二进制格式：交给系统默认程序打开，不尝试以文本读取
  const ext = (path.split(".").pop() || "").toLowerCase();
  if (!TEXT_EXTS.includes(ext)) {
    files
      .openInSystem(path)
      .then(() => {
        statusSaved.textContent = "已调用系统程序打开：" + path.split(/[\\/]/).pop();
      })
      .catch((e) => {
        statusSaved.textContent = "无法打开该文件";
        console.error(e);
      });
    return;
  }
  const existing = tabs.find((t) => t.path === path);
  if (existing) {
    if (activate && activeTab !== existing) switchToTab(existing);
    else renderTabs();
    if (record) pushHistory(path);
    return;
  }
  if (activeTab) activeTab.content = editor.getContent(); // 保存当前内容
  files
    .readFile(path)
    .then((txt) => {
      const t = { id: ++tabSeq, path, content: txt, dirty: false };
      tabs.push(t);
      if (activate) switchToTab(t);
      else {
        // 仅登记，保持当前视图不动
        if (!activeTab) switchToTab(t); // 首次无任何 tab 时仍要显示
        else renderTabs();
      }
      if (record) pushHistory(path);
    })
    .catch((e) => {
      statusSaved.textContent = "打开失败";
      console.error(e);
    });
}

function closeTab(t) {
  const idx = tabs.indexOf(t);
  if (idx < 0) return;
  // 若关闭的是当前 tab，先把其内容存好（其实已存），再从列表移除
  tabs.splice(idx, 1);
  if (activeTab === t) {
    activeTab = null;
    currentPath = null;
    if (tabs.length) {
      switchToTab(tabs[Math.max(0, idx - 1)]);
    } else {
      editor.setContent("");
      titleEl.textContent = "极简编辑器 — 未命名";
      updateMode();
    }
  }
  renderTabs();
}

// 重新加载当前页签：从磁盘重新读取并刷新内容
async function reloadTab(t) {
  try {
    const txt = await files.readFile(t.path);
    t.content = txt;
    if (activeTab === t) {
      suppressChange = true;
      editor.setContent(txt);
      suppressChange = false;
      updateMode();
    }
    setTabDirty(t, false);
    renderTabs();
    statusSaved.textContent = "已重新加载";
  } catch (e) {
    statusSaved.textContent = "重新加载失败";
    console.error(e);
  }
}

// 关闭除 target 外的所有页签
function closeOtherTabs(target) {
  for (let i = tabs.length - 1; i >= 0; i--) {
    if (tabs[i] !== target) closeTab(tabs[i]);
  }
}

// 关闭所有页签
function closeAllTabs() {
  for (let i = tabs.length - 1; i >= 0; i--) closeTab(tabs[i]);
}

// 关闭 target 左侧的所有页签
function closeLeftTabs(target) {
  const idx = tabs.indexOf(target);
  for (let i = idx - 1; i >= 0; i--) closeTab(tabs[i]);
}

// 关闭 target 右侧的所有页签
function closeRightTabs(target) {
  const idx = tabs.indexOf(target);
  for (let i = tabs.length - 1; i > idx; i--) closeTab(tabs[i]);
}

// 页签右键菜单
let ctxTargetTab = null;
function showTabCtxMenu(t, x, y) {
  ctxTargetTab = t;
  const menu = $("tab-ctx-menu");
  if (!menu) return;
  const items = [
    { label: "重新加载", action: () => reloadTab(t) },
    { label: "在新窗口中打开", action: () => files.openInNewWindow(t.path) },
    { sep: true },
    { label: "关闭", action: () => closeTab(t) },
    { label: "关闭其他页签", action: () => closeOtherTabs(t) },
    { label: "关闭所有页签", action: () => closeAllTabs() },
    { label: "关闭左侧页签", action: () => closeLeftTabs(t) },
    { label: "关闭右侧页签", action: () => closeRightTabs(t) },
  ];
  menu.innerHTML = "";
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
      hideTabCtxMenu();
      it.action();
    });
    menu.appendChild(mi);
  });
  menu.hidden = false;
  // 防止菜单超出视口
  const rect = menu.getBoundingClientRect();
  const px = Math.min(x, window.innerWidth - rect.width - 4);
  const py = Math.min(y, window.innerHeight - rect.height - 4);
  menu.style.left = px + "px";
  menu.style.top = py + "px";
}
function hideTabCtxMenu() {
  const menu = $("tab-ctx-menu");
  if (menu) menu.hidden = true;
  ctxTargetTab = null;
}

// 点击菜单外部、滚动、按 Esc、或在别处右键时隐藏菜单
function setupTabCtxMenu() {
  const menu = $("tab-ctx-menu");
  if (!menu) return;
  document.addEventListener("click", (e) => {
    if (!menu.hidden && !menu.contains(e.target)) hideTabCtxMenu();
  });
  document.addEventListener("contextmenu", (e) => {
    // 在页签上右键由 showTabCtxMenu 处理；其他位置右键时隐藏旧菜单
    if (e.target.closest && e.target.closest(".tab")) return;
    if (!menu.hidden) hideTabCtxMenu();
  });
  window.addEventListener("blur", hideTabCtxMenu);
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape") hideTabCtxMenu();
  });
  menu.addEventListener("scroll", () => {}, { passive: true });
}

function pushHistory(path) {
  history.splice(histIndex + 1); // 截断"未来"分支
  history.push(path);
  histIndex = history.length - 1;
  updateNavButtons();
}

function navigate(path, record = true) {
  openFileInTab(path, { record, activate: true });
}
function goBack() {
  if (histIndex > 0) {
    histIndex -= 1;
    openFileInTab(history[histIndex], { record: false, activate: true });
  }
}
function goForward() {
  if (histIndex < history.length - 1) {
    histIndex += 1;
    openFileInTab(history[histIndex], { record: false, activate: true });
  }
}
// 供外部（文件树、拖拽、菜单）调用的统一入口
function openFile(path) {
  openFileInTab(path, { record: true, activate: true });
}
// ---- 拖拽打开文件 ----
const isTauri = "__TAURI_INTERNALS__" in window;

// 浏览器/退化环境：从 File 对象读取并打开
function openDroppedFile(file) {
  const reader = new FileReader();
  reader.onload = () => {
    currentPath = null; // 拖入文件无本地路径，保存时按另存处理
    editor.setContent(reader.result);
    titleEl.textContent = "极简编辑器 — " + file.name;
    statusSaved.textContent = "已打开（拖入）";
    updateMode();
  };
  reader.onerror = () => {
    statusSaved.textContent = "打开失败";
    console.error(reader.error);
  };
  reader.readAsText(file);
}

// Tauri 环境：文件拖入 webview 走 onDragDropEvent，拿到本地路径
if (isTauri) {
  import("@tauri-apps/api/webview")
    .then(({ getCurrentWebview }) => {
      getCurrentWebview().onDragDropEvent(({ payload }) => {
        if (payload.type === "drop" && payload.paths && payload.paths.length) {
          openFile(payload.paths[0]);
        }
      });
    })
    .catch((e) => console.error("拖放初始化失败", e));

  // 文件关联（右键"打开方式"）启动时的路径，改为前端就绪后通过 files.getLaunchPath() 查询，
  // 避免 setup 阶段 emit 时前端尚未监听而丢失（见 DOMContentLoaded 中的处理）。
} else {
  // 浏览器退化：DOM drop 事件
  const appRoot = $("app");
  if (appRoot) {
    appRoot.addEventListener("dragover", (e) => e.preventDefault());
    appRoot.addEventListener("drop", (e) => {
      e.preventDefault();
      const f = e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files[0];
      if (f) openDroppedFile(f);
    });
  }
}

// 左上角"打开文件"按钮：选择单个文件并打开
const openFileBtn = $("btn-open-file");
if (openFileBtn) {
  openFileBtn.addEventListener("click", async () => {
    const p = await files.pickOpen();
    if (p) openFile(p);
  });
}

// 顶部"后退 / 前进"按钮
$("btn-back")?.addEventListener("click", goBack);
$("btn-forward")?.addEventListener("click", goForward);
updateNavButtons();

// 预览区内链接点击：相对链接（如 other.md）基于当前文档目录打开并记入历史，
// 远程 http(s) 链接在新窗口打开，锚点(#)不处理。
previewEl.addEventListener("click", async (e) => {
  // 点击可能落在 <a> 内的文本节点上，需要规整到 Element 再 closest
  const t = e.target;
  const el = t instanceof Element ? t : t && t.parentElement;
  if (!el) return;
  const a = el.closest("a[href]");
  if (!a) return;
  const href = a.getAttribute("href");
  if (!href) return;
  if (/^https?:\/\//i.test(href)) {
    e.preventDefault();
    window.open(href, "_blank");
    return;
  }
  if (/^(mailto:|#)/i.test(href)) return; // 邮件/锚点不拦截
  e.preventDefault();
  if (!currentPath) return;
  try {
    // marked 会把链接里的非 ASCII 路径做 URL 编码（如 图片和附件 -> %E5%9B%BE...），
    // 需解码回原始中文，否则 join 出的路径在磁盘上不存在
    let rawHref = href;
    try { rawHref = decodeURIComponent(href); } catch (_) {}
    const dir = await dirname(currentPath);
    const target = await join(dir, rawHref);
    console.log("[link] currentPath=", currentPath, " dir=", dir, " href=", href, " -> target=", target);
    // 点击链接后切换到新打开的页签；可后退跳回原文档
    openFileInTab(target, { record: true, activate: true });
  } catch (err) {
    console.error("链接跳转失败", err);
  }
});

initExplorer({ onOpenFile: openFile });
const scrollSync = setupScrollSync({ editor, previewPane: $("preview-pane"), previewEl: $("preview") });
setupTabScrollButtons();
setupTabCtxMenu();

// 文件关联（右键"打开方式" / 双击）启动时：
// 1) 首次启动由 Rust 在 setup 阶段把路径存入状态，前端就绪后查询并打开；
// 2) 应用已在运行时再次双击文件，Rust 会 emit "open-path"，此处监听并打开。
if (isTauri) {
  files
    .getLaunchPath()
    .then((p) => {
      if (p) openFile(p);
    })
    .catch((e) => console.error("读取启动路径失败", e));

  import("@tauri-apps/api/event")
    .then(({ listen }) => listen("open-path", (e) => openFile(e.payload)))
    .catch((e) => console.error("open-path 监听失败", e));
}

// 预览渲染（含图片加载）完成后重建滚动锚点，避免左右滚动对不齐
previewEl.addEventListener("preview:rendered", () => scrollSync && scrollSync.rebuild());

// 点击预览中的标题，把编辑器滚动到对应的源文件行（标题作为锚点）
previewEl.addEventListener("click", (e) => {
  // 链接点击已在上方单独处理，这里只处理标题跳转
  const t = e.target;
  const el = t instanceof Element ? t : t && t.parentElement;
  if (!el) return;
  const a = el.closest("a[href]");
  if (a) return;
  const h = el.closest("h1,h2,h3,h4,h5,h6");
  if (!h) return;
  const lineAttr = h.getAttribute("data-line");
  if (!lineAttr) return;
  const line = parseInt(lineAttr, 10);
  if (isNaN(line)) return;
  const ln = Math.min(line, editor.view.state.doc.lines);
  const lineObj = editor.view.state.doc.line(ln);
  editor.view.dispatch({
    effects: EditorView.scrollIntoView(lineObj.from, { y: "start" }),
  });
  editor.view.focus();
});


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
    if (activeTab) setTabDirty(activeTab, false);
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
