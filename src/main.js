import { createEditor } from "./editor.js";
import { render, detectMode } from "./preview.js";
import { setupSplit } from "./split.js";
import { loadSettings, saveSettings } from "./settings.js";
import * as files from "./files.js";
import "highlight.js/styles/github.css";
import "./style.css";
import { initExplorer } from "./explorer.js";
import { initBrowser } from "./browser.js";
import { setupScrollSync } from "./scrollsync.js";

const $ = (id) => document.getElementById(id);

const editorPane = $("editor-pane");
const divider = $("divider");
const split = $("split");
const previewEl = $("preview");
const iframeEl = $("preview-frame");
const titleEl = $("title");
const statusChars = $("status-chars");
const statusSaved = $("status-saved");
const modeSelect = $("mode-select");
const btnMode = $("btn-mode");

let settings = loadSettings();
let currentPath = null;
let currentMode = "md";
let previewTimer = null;
let autoSaveTimer = null;

const editor = createEditor($("editor"), {
  initialDoc:
    "# 欢迎使用极简编辑器\n\n左边编辑，右边实时预览。\n\n- 支持 **Markdown** 渲染\n- 支持 HTML 预览（沙箱隔离）\n- 左侧可「打开目录」批量管理文件\n- 顶部可切换到「浏览模式」当浏览器用\n- 快捷键：Ctrl+S 保存，Ctrl+O 打开\n",
  onChange: (text) => onContentChange(text),
});

function applySettings() {
  editorPane.style.flexBasis = settings.ratio + "%";
  document.body.classList.toggle("dark", settings.theme === "dark");
  document.documentElement.style.setProperty("--editor-font", settings.fontSize + "px");
  $("ratio").value = settings.ratio;
  $("ratio-out").textContent = `${settings.ratio}% / ${100 - settings.ratio}%`;
  $("theme-select").value = settings.theme;
  $("font-size").value = settings.fontSize;
  $("font-size-out").textContent = settings.fontSize + "px";
  $("auto-save").checked = settings.autoSave;
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
modeSelect.addEventListener("change", updateMode);

setupSplit({
  container: split,
  editorPane,
  divider,
  onRatioChange: (r) => {
    settings.ratio = Math.round(r);
    saveSettings(settings);
    $("ratio-out").textContent = `${settings.ratio}% / ${100 - settings.ratio}%`;
    $("ratio").value = settings.ratio;
  },
});

// ---- 文件浏览器（编辑模式左侧） ----
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
initBrowser();
setupScrollSync({ editor, previewPane: $("preview-pane"), previewEl: $("preview") });

// ---- 模式切换 ----
function setMode(mode) {
  settings.mode = mode;
  const s = loadSettings();
  s.mode = mode;
  saveSettings(s);

  const browse = mode === "browse";
  $("editor-area").hidden = browse;
  $("browser-area").hidden = !browse;
  $("side-edit").hidden = browse;
  $("side-browse").hidden = !browse;
  $("edit-actions").hidden = browse;
  btnMode.textContent = browse ? "编辑模式" : "浏览模式";
  titleEl.textContent = browse ? "浏览器" : "极简编辑器";
}
btnMode.addEventListener("click", () =>
  setMode(settings.mode === "edit" ? "browse" : "edit")
);

// settings drawer
const settingsEl = $("settings");
const backdrop = $("settings-backdrop");
$("btn-settings").addEventListener("click", () => {
  settingsEl.hidden = false;
  backdrop.hidden = false;
});
$("settings-close").addEventListener("click", closeSettings);
backdrop.addEventListener("click", closeSettings);
function closeSettings() {
  settingsEl.hidden = true;
  backdrop.hidden = true;
}

$("ratio").addEventListener("input", (e) => {
  const r = +e.target.value;
  settings.ratio = r;
  editorPane.style.flexBasis = r + "%";
  $("ratio-out").textContent = `${r}% / ${100 - r}%`;
  saveSettings(settings);
});
$("theme-select").addEventListener("change", (e) => {
  settings.theme = e.target.value;
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

$("btn-new").addEventListener("click", () => {
  editor.setContent("");
  currentPath = null;
  titleEl.textContent = "极简编辑器 — 未命名";
  statusSaved.textContent = "就绪";
  updateMode();
});

$("btn-open").addEventListener("click", async () => {
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
});

$("btn-save").addEventListener("click", async () => {
  let p = currentPath;
  if (!p) p = await files.pickSave();
  if (!p) return;
  await saveFile(p);
});

// keyboard shortcuts
window.addEventListener("keydown", (e) => {
  const k = e.key.toLowerCase();
  if ((e.ctrlKey || e.metaKey) && k === "s") {
    e.preventDefault();
    $("btn-save").click();
  }
  if ((e.ctrlKey || e.metaKey) && k === "o") {
    e.preventDefault();
    $("btn-open").click();
  }
});

applySettings();
updateMode();
setMode(settings.mode || "edit");
