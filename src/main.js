import { createEditor } from "./editor.js";
import { render, detectMode } from "./preview.js";
import { setupSplit } from "./split.js";
import { loadSettings, saveSettings } from "./settings.js";
import * as files from "./files.js";
import { dirname, join } from "@tauri-apps/api/path";
import "highlight.js/styles/github.css";
import "./style.css";
import { initExplorer } from "./explorer.js";
import { setupScrollSync } from "./scrollsync.js";
import { findHighlight, setupFindReplace } from "./findreplace.js";

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
let loadingGuard = false; // 程序化加载文件时为真，期间不标记"未保存"/不触发自动保存

const editor = createEditor($("editor"), {
  initialDoc:
    "# 欢迎使用极简编辑器\n\n左边编辑，右边实时预览。\n\n- 支持 **Markdown** 渲染\n- 支持 HTML 预览（沙箱隔离）\n- 左侧可「打开目录」批量管理文件\n- 快捷键：Ctrl+S 保存，Ctrl+O 打开\n",
  onChange: (text) => onContentChange(text),
  extraExtensions: findHighlight,
});

let findReplace = null;

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

// ===== 预览渲染缓存（按页签） =====
// 切换页签并不会重新读磁盘（内容已在内存），但预览会被整块重绘：
//   marked.parse 解析 + 图片读盘转 base64 的 await + 200ms 防抖，
// 于是会先残留上一个页签的内容、再整块刷新，观感就是"闪一下"。
// 这里把每个页签「渲染完成后的最终 HTML」缓存下来（含已解析好的 data URI 图片、
// hljs 高亮、代码块装饰与 data-line 锚点），切回来时直接 innerHTML 还原：
// 不重新解析、不等图片、不等 200ms —— 同一帧内完成，肉眼无闪烁。

const MAX_PREVIEW_CACHE = 3000000; // 过长的 HTML 不缓存，避免占用过多内存

// 简单字符串哈希（djb2）生成缓存键，避免把整篇正文当 key 反复比对
function hashString(s) {
  let h = 5381;
  for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) | 0;
  return (h >>> 0).toString(36);
}

function makePreviewKey(text, mode, path) {
  return mode + "\u0000" + (path || "") + "\u0000" + hashString(text);
}

function currentPreviewKey() {
  return makePreviewKey(editor.getContent(), currentMode, currentPath);
}

// 本次渲染对应的缓存键。必须在调用 render 之前确定：渲染是异步的（要等图片），
// 若等 preview:rendered 再按"当时的正文"算键，可能把旧 HTML 挂到新正文的键上。
let pendingRender = null; // { key }

function runRender(text) {
  pendingRender = { key: makePreviewKey(text, currentMode, currentPath) };
  return render(previewEl, iframeEl, text, currentMode, currentPath);
}

function schedulePreview(text) {
  clearTimeout(previewTimer);
  previewTimer = setTimeout(() => runRender(text), 200);
}

// 切换页签后的预览处理：优先用缓存即时还原；没有缓存则立即重绘（跳过 200ms 防抖），
// 避免出现"先显示上一个页签内容、再跳变"的观感。
function refreshPreviewForTab(t) {
  currentMode = detectMode(currentPath, modeSelect.value);
  clearTimeout(previewTimer); // 取消上一个页签遗留的渲染任务

  const cached = t.previewCache;
  if (currentMode !== "html" && cached && cached.key === currentPreviewKey()) {
    iframeEl.hidden = true;
    previewEl.hidden = false;
    previewEl.innerHTML = cached.html; // 同步还原，图片已是 data URI，不会再有加载过程
    pendingRender = null;
    previewEl.dispatchEvent(
      new CustomEvent("preview:rendered", { detail: { preserved: true, clamped: false } })
    );
    return;
  }
  runRender(t.content != null ? t.content : "");
}

function onContentChange(text) {
  // 实时预览始终执行（这是修复"左边改右边不实时更新"的关键）
  statusChars.textContent = text.length + " 字符";
  schedulePreview(text);
  // 程序化加载（打开/切换/重新加载文件）期间不标记"未保存"、不触发自动保存
  if (loadingGuard) return;
  statusSaved.textContent = "未保存";
  if (activeTab) setTabDirty(activeTab, true);
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
let untitledSeq = 0; // "未命名-N" 的序号

// 页签显示名：已保存到磁盘的用文件名；尚未保存的新文件用"未命名-N"
function tabDisplayName(t) {
  if (t.path) return t.path.split(/[\\/]/).pop();
  return t.name || "未命名";
}

// 新建空白页签（尚未保存到磁盘，没有路径），避免沿用上一个页签的名称
function createUntitledTab() {
  const t = { id: ++tabSeq, path: null, name: "未命名-" + ++untitledSeq, content: "", dirty: false };
  tabs.push(t);
  return t;
}
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
    el.title = t.path || tabDisplayName(t);
    // 常驻透明圆点占位，修改后加 .on 显示，保存后去掉 .on 变透明（布局不跳动）
    const dot = document.createElement("span");
    dot.className = "tab-dot" + (t.dirty ? " on" : "");
    dot.title = "未保存";
    el.appendChild(dot);
    const name = document.createElement("span");
    name.className = "tab-name";
    name.textContent = tabDisplayName(t);
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

// ===== 每个页签独立的滚动位置 =====
// t.scroll = { editor: 编辑框 scrollTop, preview: 预览区 scrollTop }

function getPreviewPane() {
  return $("preview-pane");
}

function saveTabScroll(t) {
  if (!t || !editor) return;
  const pane = getPreviewPane();
  const es = editor.view ? editor.view.scrollDOM.scrollTop : 0;
  const ps = pane ? pane.scrollTop : 0;
  t.scroll = { editor: es, preview: ps };
}

// 预览是延迟渲染的（约 200ms 防抖），切换页签时必须等本次渲染完成后才能把滚动位置
// 落到正确的内容上，所以这里登记一个待恢复值，由 preview:rendered 处理。
let pendingPreviewScroll = null; // { id, top }

function restoreTabScroll(t) {
  const s = t.scroll || { editor: 0, preview: 0 };
  const pane = getPreviewPane();

  // 切换期间两侧都会被程序化滚动，这些不是用户操作，
  // 必须让滚动联动先"让位"，否则刚恢复的位置立刻会被自动对齐抢回去。
  if (scrollSync) scrollSync.suppressAlign(450);

  if (pane) {
    // 预览内容已在 refreshPreviewForTab 中就位，这里同帧直接落到记录的位置，
    // 不再"先归零再等渲染完成后跳回去"（那正是切换时看到的跳动）。
    pendingPreviewScroll = s.preview > 0 ? { id: t.id, top: s.preview } : null;
    const want = Math.min(s.preview, Math.max(0, pane.scrollHeight - pane.clientHeight));
    pane.scrollTop = want;
    // 图片等异步资源加载后布局可能变高，届时再校正一次（内容未变时 preview.js 会保留位置）
    if (scrollSync) scrollSync.suppressAlign(450);
  }

  // 恢复编辑框位置。文档刚换，必须等 CodeMirror 完成排版后 scrollTop 才有正确上限，
  // 所以分两步：先立刻尝试一次，再在一帧后补一次（处理长文档/换行因素导致的重排）。
  const applyEditorScroll = () => {
    const el = editor.view && editor.view.scrollDOM;
    if (!el) return;
    const top = Math.min(s.editor, Math.max(0, el.scrollHeight - el.clientHeight));
    if (top !== el.scrollTop) {
      el.scrollTop = top;
      if (scrollSync) scrollSync.suppressAlign(450);
    }
  };
  applyEditorScroll();
  editor.view.requestMeasure({ read: applyEditorScroll });
}

// 切换到一个已存在的 tab：先保存当前编辑器内容与滚动位置，再加载目标 tab 的内容。
// 每个页签各自记录编辑框与预览区的滚动位置，切回来时能回到原来的位置。
function switchToTab(t) {
  if (!t) return;
  if (activeTab) {
    activeTab.content = editor.getContent();
    if (activeTab !== t) saveTabScroll(activeTab);
  }
  activeTab = t;
  currentPath = t.path;
  loadingGuard = true;
  editor.setContent(t.content != null ? t.content : "");
  loadingGuard = false;
  // 先把预览内容就位（命中缓存则同步完成），再落滚动位置，避免看到"从顶部跳回去"
  refreshPreviewForTab(t);
  restoreTabScroll(t);
  titleEl.textContent = "极简编辑器 — " + tabDisplayName(t);
  statusSaved.textContent = "已打开";
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
// forceNew：即使该文件已打开，也再开一个新页签（对应"在新页面中打开"）
function openFileInTab(path, { record = true, activate = true, forceNew = false } = {}) {
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
  const existing = forceNew ? null : tabs.find((t) => t.path === path);
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
      const pane2 = $("preview-pane");
      if (pane2) pane2.scrollTop = 0;
      titleEl.textContent = "极简编辑器 — 未命名";
      updateMode();
    }
  }
  renderTabs();
}

// 重新加载当前页签：从磁盘重新读取并刷新内容
async function reloadTab(t) {
  if (!t.path) return; // 未保存的新文件无处可重新加载
  try {
    const txt = await files.readFile(t.path);
    t.content = txt;
    t.previewCache = null; // 内容来自磁盘重读，旧缓存失效
    if (activeTab === t) {
      loadingGuard = true;
      editor.setContent(txt);
      loadingGuard = false;
      updateMode(); // 重新检测模式并刷新预览
      schedulePreview(editor.getContent()); // 显式刷新预览，确保重新加载后立即生效
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
  const named = !!t.path; // 未保存的新文件没有路径，读盘相关的操作不可用
  const items = [
    { label: "重新加载", disabled: !named, action: () => reloadTab(t) },
    { label: "在新窗口中打开", disabled: !named, action: () => files.openInNewWindow(t.path) },
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
    mi.className = "ctx-item" + (it.disabled ? " disabled" : "");
    mi.textContent = it.label;
    if (it.disabled) {
      mi.title = "该页签尚未保存到文件";
    } else {
      mi.addEventListener("click", () => {
        hideTabCtxMenu();
        it.action();
      });
    }
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
    loadingGuard = true;
    editor.setContent(reader.result);
    loadingGuard = false;
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

initExplorer({
  onOpenFile: openFile,
  onOpenFileInNewPage: (p) => openFileInTab(p, { record: true, activate: true, forceNew: true }),
});
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

// 预览渲染（含图片加载）完成后的处理。
// 滚动锚点的重建与重新对齐已由 scrollsync 内部订阅该事件完成，这里不再重复调用。
previewEl.addEventListener("preview:rendered", () => {
  // 渲染完成后把最终 HTML 存入当前页签的缓存，供下次切回来时直接还原。
  // 用 pendingRender.key（渲染前算好的）而不是"当时的正文"，避免正文在渲染异步期间
  // 又变了导致键与内容对不上。
  if (pendingRender && activeTab && !previewEl.hidden) {
    const html = previewEl.innerHTML;
    activeTab.previewCache =
      html.length <= MAX_PREVIEW_CACHE ? { key: pendingRender.key, html } : null;
    pendingRender = null;
  }
  // 切到某个页签后，等预览重绘完成再校正一次该页签记录的滚动位置
  // （正常已在切换时同帧落好，这里只是图片等资源加载后布局变化的兜底）
  if (pendingPreviewScroll && activeTab && pendingPreviewScroll.id === activeTab.id) {
    const top = pendingPreviewScroll.top;
    pendingPreviewScroll = null;
    const pane = $("preview-pane");
    if (pane) {
      const max = Math.max(0, pane.scrollHeight - pane.clientHeight);
      pane.scrollTop = Math.min(top, max);
      if (scrollSync) scrollSync.suppressAlign(450);
    }
  }
  // 预览重渲染后文本节点失效，正在预览区查找时重算匹配
  if (findReplace) findReplace.refresh();
});

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
  // 用带同步守卫的方式跳转，避免随后的反向同步把预览"闪"回去
  scrollSync.scrollEditorToLine(line);
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

// ---- 查找 / 替换面板（顶部浮动条，替换 CodeMirror 自带的底部小面板） ----
// 编辑框可见时搜编辑器，预览视图（编辑框隐藏）时自动改搜预览区
findReplace = setupFindReplace(editor.view, $("find-bar"), {
  previewEl: $("preview"),
  previewPane: $("preview-pane"),
  isPreviewActive: () => currentView === "preview",
});

// 初始化：确保所有 DOM 元素已赋值后再应用设置/模式/视图
applySettings();
updateMode();
setView(currentView);

  // ——— 键盘快捷键（全局）：保存 / 打开 / 新建 用 Ctrl，避免与 CodeMirror 冲突 ———
  window.addEventListener("keydown", (e) => {
    const mod = e.ctrlKey || e.metaKey;
    if (mod && e.key.toLowerCase() === "s") { e.preventDefault(); menuActions["save"](); }
    else if (mod && e.key.toLowerCase() === "o") { e.preventDefault(); menuActions["open"](); }
    else if (mod && e.key.toLowerCase() === "n") { e.preventDefault(); menuActions["new"](); }
  });

  // ——— 菜单栏动作分发 ———
  const menuActions = {
    // 新建：开一个独立的"未命名-N"页签，不再复用/顶替当前页签（否则会沿用上一个文件的名称）
    "new": () => {
      const t = createUntitledTab();
      switchToTab(t);
      statusSaved.textContent = "就绪";
      editor.view.focus();
    },
    // 打开：同样开一个独立页签，避免内容换了而页签名还留着旧文件
    "open": async () => {
      const p = await files.pickOpen();
      if (!p) return;
      openFileInTab(p, { record: true, activate: true });
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

  // 菜单栏点击分发
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
  // 点击菜单项 / 菜单外区域时关闭下拉
  document.addEventListener("click", (e) => {
    if (!e.target.closest(".menu")) closeAllMenus();
  });
  // 关闭所有 .menu.open
  function closeAllMenus() {
    document.querySelectorAll(".menu.open").forEach((m) => m.classList.remove("open"));
  }
}); // end DOMContentLoaded

// file operations
async function saveFile(path) {
  try {
    await files.writeFile(path, editor.getContent());
    currentPath = path;
    if (activeTab) {
      // 首次保存"未命名-N"：把路径补上、去掉占位名，页签即改显示真实文件名，
      // 之后从文件树再打开同一文件也能复用这个页签，不会重复开一个
      activeTab.path = path;
      delete activeTab.name;
      setTabDirty(activeTab, false);
      renderTabs();
    } else {
      // 之前没有任何页签（如拖入文件后直接保存）：补建一个
      const t = { id: ++tabSeq, path, content: editor.getContent(), dirty: false };
      tabs.push(t);
      switchToTab(t);
      renderTabs();
    }
    titleEl.textContent = "极简编辑器 — " + path.split(/[\\/]/).pop();
    statusSaved.textContent = "已保存";
  } catch (e) {
    statusSaved.textContent = "保存失败";
    console.error(e);
  }
}

// 查找 / 替换快捷键。
// 用捕获阶段监听，确保在 CodeMirror 自己的 Mod-f / Mod-g / F3 之前拦下，
// 否则 basicSetup 自带的底部搜索面板会被打开。
window.addEventListener(
  "keydown",
  (e) => {
    if (!findReplace) return;
    const k = e.key.toLowerCase();
    const mod = e.ctrlKey || e.metaKey;
    const open = findReplace.isOpen();

    if (mod && k === "f") {
      e.preventDefault();
      e.stopPropagation();
      findReplace.open("find");
      return;
    }
    if (mod && k === "h") {
      e.preventDefault();
      e.stopPropagation();
      // 面板已开着就只展开替换框，保留当前查询词与匹配位置
      if (open) findReplace.expandReplace();
      else findReplace.open("replace");
      return;
    }
    // 面板打开时接管 Esc / F3 / Ctrl+G，避免触发 CodeMirror 自带搜索
    if (open && (e.key === "Escape" || e.key === "F3" || (mod && k === "g"))) {
      e.preventDefault();
      e.stopPropagation();
      if (e.key === "Escape") findReplace.close();
      else findReplace.step(e.shiftKey ? -1 : 1);
    }
  },
  true
);

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
  // 编辑框显隐会改变查找目标（编辑器 / 预览区），刷新一下已打开的查找条
  if (findReplace) findReplace.refresh();
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
