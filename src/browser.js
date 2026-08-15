import * as files from "./files.js";
import { patchSettings } from "./settings.js";

let tabs = [];
let activeId = null;
let tabSeq = 0;
let elements = []; // 当前提取到的页面元素
let downloadDir = null; // 本次会话复用的下载目录

function flash(msg) {
  const s = document.getElementById("status-saved");
  if (s) s.textContent = msg;
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c])
  );
}

// 注入 <base> 让相对资源（图片/CSS/JS）能正确解析
function injectBase(html, base) {
  const b = `<base href="${base.replace(/"/g, "&quot;")}">`;
  if (/<head[^>]*>/i.test(html))
    return html.replace(/<head[^>]*>/i, (m) => m + b);
  if (/<html[^>]*>/i.test(html))
    return html.replace(/<html[^>]*>/i, (m) => m + "<head>" + b + "</head>");
  return "<head>" + b + "</head>" + html;
}

// 注入到被浏览页面里的脚本：接管 console / 错误 / 弹窗，并回传父窗口
const HOOK = `
(function(){
  function fmt(a){try{return typeof a==='object'?JSON.stringify(a):String(a);}catch(e){return String(a);}}
  function post(level,args){try{parent.postMessage({__console:true,level:level,text:Array.prototype.map.call(args,fmt).join(' ')},'*');}catch(e){}}
  ['log','info','warn','error','debug'].forEach(function(l){var o=console[l];console[l]=function(){post(l,arguments);try{o.apply(console,arguments);}catch(e){}};});
  window.addEventListener('error',function(e){post('error',[(e.message||'Error')+' @ '+(e.filename||'')+':'+(e.lineno||'')]);});
  window.addEventListener('unhandledrejection',function(e){post('error',['Unhandled rejection: '+(e.reason&&e.reason.message||e.reason)]);});
  window.open=function(u){parent.postMessage({__nav:String(u||location.href)},'*');return null;};
  document.addEventListener('click',function(e){var a=e.target.closest?e.target.closest('a'):null;if(a&&a.getAttribute('target')==='_blank'){e.preventDefault();parent.postMessage({__nav:String(a.href)},'*');}},true);
})();
`;

export function initBrowser() {
  const urlInput = document.getElementById("url-input");
  const btnGo = document.getElementById("btn-go");
  const btnBack = document.getElementById("btn-back");
  const btnReload = document.getElementById("btn-reload");
  const btnNewTab = document.getElementById("btn-new-tab");
  const btnExtract = document.getElementById("btn-extract");
  const btnBatch = document.getElementById("btn-batch-download");
  const filterType = document.getElementById("filter-type");
  const btnToggle = document.getElementById("btn-toggle-toolbar");
  const toolbar = document.getElementById("toolbar");
  const toolbarBody = document.getElementById("toolbar-body");
  const btnConsole = document.getElementById("btn-console");
  const consolePanel = document.getElementById("console-panel");
  const consoleLog = document.getElementById("console-log");
  const btnClearConsole = document.getElementById("btn-clear-console");
  const frame = document.getElementById("browser-frame");

  const saved = JSON.parse(localStorage.getItem("mini-editor-settings") || "{}");
  if (saved.toolbarHidden) {
    toolbar.classList.add("collapsed");
    toolbarBody.hidden = true;
  }
  if (saved.consoleHidden) {
    consolePanel.hidden = true;
  }

  // 单次绑定 load：每次 srcdoc 重新加载都会触发，注入控制台钩子
  frame.addEventListener("load", () => {
    try {
      const cw = frame.contentWindow;
      if (!cw || !cw.document) return;
      const s = cw.document.createElement("script");
      s.textContent = HOOK;
      cw.document.documentElement.appendChild(s);
    } catch (e) {}
  });

  // 接收被浏览页面回传的 console / 导航请求
  window.addEventListener("message", (e) => {
    const d = e.data;
    if (!d) return;
    if (d.__console) appendConsole(consoleLog, d.level, d.text);
    else if (d.__nav) {
      let u = d.__nav;
      try {
        const base = activeTab() ? activeTab().url : "";
        u = new URL(u, base).href;
      } catch {}
      if (u) navigate(u);
    }
  });

  const go = () => {
    const u = normalizeUrl(urlInput.value);
    if (u) navigate(u);
  };
  btnGo.addEventListener("click", go);
  urlInput.addEventListener("keydown", (e) => {
    if (e.key === "Enter") go();
  });
  btnBack.addEventListener("click", back);
  btnReload.addEventListener("click", () => {
    const t = activeTab();
    if (t) setFrame(t.url);
  });
  btnNewTab.addEventListener("click", () => {
    urlInput.focus();
    urlInput.select();
  });
  btnExtract.addEventListener("click", extract);
  btnBatch.addEventListener("click", batchDownload);
  filterType.addEventListener("change", renderElements);
  btnToggle.addEventListener("click", () => {
    const collapsed = toolbar.classList.toggle("collapsed");
    toolbarBody.hidden = collapsed;
    patchSettings({ toolbarHidden: collapsed });
  });
  btnConsole.addEventListener("click", () => {
    const hidden = consolePanel.hidden;
    consolePanel.hidden = !hidden;
    patchSettings({ consoleHidden: !hidden });
  });
  btnClearConsole.addEventListener("click", () => {
    consoleLog.innerHTML = "";
  });

  addTab("https://example.com");
}

function appendConsole(el, level, text) {
  const li = document.createElement("li");
  li.className = "lvl-" + (level || "log");
  li.textContent = text;
  el.appendChild(li);
  // 限制条数，避免无限增长
  while (el.children.length > 500) el.removeChild(el.firstChild);
  el.scrollTop = el.scrollHeight;
}

function normalizeUrl(u) {
  u = (u || "").trim();
  if (!u) return "";
  if (/^https?:\/\//i.test(u) || /^file:\/\//i.test(u) || /^about:blank/i.test(u))
    return u;
  return "https://" + u;
}

function activeTab() {
  return tabs.find((t) => t.id === activeId) || null;
}

function addTab(url) {
  const t = { id: ++tabSeq, url, title: url, history: [url], idx: 0 };
  tabs.push(t);
  activeId = t.id;
  setFrame(url);
  renderTabs();
  return t;
}

function navigate(url) {
  let t = activeTab();
  if (!t) {
    addTab(url);
    return;
  }
  t.history = t.history.slice(0, t.idx + 1);
  t.history.push(url);
  t.idx = t.history.length - 1;
  t.url = url;
  t.title = url;
  setFrame(url);
  renderTabs();
}

async function setFrame(url) {
  const frame = document.getElementById("browser-frame");
  const urlInput = document.getElementById("url-input");
  urlInput.value = url;

  // 本地文件直接加载（避免 file:// 子资源在 srcdoc 中被拦截）；
  // 远程页面走同源 srcdoc 代理，以便接管点击/弹窗并抓取控制台。
  if (url.startsWith("file://")) {
    frame.removeAttribute("srcdoc");
    frame.src = url;
    return;
  }

  try {
    const html = await files.fetchHtml(url);
    frame.removeAttribute("src");
    frame.srcdoc = injectBase(html, url);
  } catch (e) {
    frame.srcdoc = `<!doctype html><meta charset="utf-8"><body style="font-family:sans-serif;padding:20px;color:#c0392b">加载失败：${escapeHtml(
      e
    )}</body>`;
  }
}

function back() {
  const t = activeTab();
  if (!t || t.idx <= 0) return;
  t.idx--;
  t.url = t.history[t.idx];
  setFrame(t.url);
  renderTabs();
}

function renderTabs() {
  const ul = document.getElementById("tab-list");
  ul.innerHTML = "";
  for (const t of tabs) {
    const li = document.createElement("li");
    if (t.id === activeId) li.classList.add("active");
    li.innerHTML = `<span class="ic">🌐</span><span class="name"></span><span class="close">✕</span>`;
    li.querySelector(".name").textContent = t.title || t.url;
    li.querySelector(".name").title = t.url;
    li.addEventListener("click", (e) => {
      if (e.target.classList.contains("close")) {
        closeTab(t.id);
        return;
      }
      activeId = t.id;
      setFrame(t.url);
      renderTabs();
    });
    ul.appendChild(li);
  }
}

function closeTab(id) {
  const i = tabs.findIndex((t) => t.id === id);
  if (i < 0) return;
  tabs.splice(i, 1);
  if (activeId === id) {
    const next = tabs[tabs.length - 1];
    if (next) {
      activeId = next.id;
      setFrame(next.url);
    } else {
      activeId = null;
      document.getElementById("browser-frame").src = "about:blank";
    }
  }
  renderTabs();
}

// ===== 页面元素提取 =====
async function extract() {
  const t = activeTab();
  if (!t) return;
  const elList = document.getElementById("element-list");
  elList.innerHTML = `<li class="empty">提取中…</li>`;
  let html;
  try {
    html = await files.fetchHtml(t.url);
  } catch (e) {
    elList.innerHTML = `<li class="empty">提取失败：${e}</li>`;
    return;
  }
  elements = parseElements(html, t.url);
  renderElements();
  flash(`已提取 ${elements.length} 个元素`);
}

function parseElements(html, base) {
  const doc = new DOMParser().parseFromString(html, "text/html");
  const out = [];
  const abs = (u) => {
    try {
      return new URL(u, base).href;
    } catch {
      return u;
    }
  };
  const fname = (u) => u.split("?")[0].split("#")[0].split("/").pop() || "file";

  doc.querySelectorAll("img").forEach((img) => {
    const src =
      img.getAttribute("src") ||
      img.dataset.src ||
      img.getAttribute("data-src") ||
      "";
    if (src) out.push({ type: "image", url: abs(src), name: img.alt || fname(src) });
  });
  doc.querySelectorAll("a[href]").forEach((a) => {
    const h = a.getAttribute("href");
    if (h && !h.startsWith("#") && !/^javascript:/i.test(h))
      out.push({
        type: "link",
        url: abs(h),
        name: (a.textContent || "").trim().slice(0, 40) || fname(h),
      });
  });
  doc.querySelectorAll("script[src]").forEach((s) => {
    const src = s.getAttribute("src");
    if (src) out.push({ type: "script", url: abs(src), name: fname(src) });
  });
  doc.querySelectorAll("link[rel~=stylesheet][href]").forEach((l) => {
    const h = l.getAttribute("href");
    if (h) out.push({ type: "stylesheet", url: abs(h), name: fname(h) });
  });
  return out;
}

function renderElements() {
  const filter = document.getElementById("filter-type").value;
  const elList = document.getElementById("element-list");
  const btnBatch = document.getElementById("btn-batch-download");
  elList.innerHTML = "";
  const list = filter === "all" ? elements : elements.filter((e) => e.type === filter);
  if (!list.length) {
    elList.innerHTML = `<li class="empty">暂无${
      filter === "all" ? "" : "「" + filter + "」"
    }元素，先点「提取元素」</li>`;
    btnBatch.disabled = true;
    return;
  }
  list.forEach((e) => {
    const li = document.createElement("li");
    li._el = e;
    li.innerHTML = `<input type="checkbox" class="chk"/><span class="etype">${e.type}</span><span class="ename" title="${e.url}"></span><span class="dl">下载</span>`;
    li.querySelector(".ename").textContent = e.name || e.url;
    li.querySelector(".chk").addEventListener("change", updateBatchState);
    li.querySelector(".dl").addEventListener("click", () => singleDownload(e));
    elList.appendChild(li);
  });
  elList._filtered = list;
  btnBatch.disabled = false;
}

function updateBatchState() {
  const checks = document.querySelectorAll("#element-list .chk:checked");
  document.getElementById("btn-batch-download").disabled = checks.length === 0;
}

async function ensureDownloadDir() {
  if (downloadDir) return downloadDir;
  const d = await files.openDirectory();
  if (d) {
    downloadDir = d;
    patchSettings({ lastDownloadDir: d });
  }
  return downloadDir;
}

async function singleDownload(e) {
  const dir = await ensureDownloadDir();
  if (!dir) return;
  try {
    const saved = await files.downloadUrl(e.url, dir);
    flash(`已保存：${saved.split(/[\\/]/).pop()}`);
  } catch (err) {
    flash(`下载失败：${err}`);
  }
}

async function batchDownload() {
  const checks = [...document.querySelectorAll("#element-list .chk:checked")];
  if (!checks.length) return;
  const dir = await ensureDownloadDir();
  if (!dir) return;
  const list = document.getElementById("element-list")._filtered || elements;
  const chosen = checks.map((c) => c.closest("li")._el).filter(Boolean);
  const set = new Set(list);
  let ok = 0;
  let fail = 0;
  for (const e of chosen) {
    if (!set.has(e)) continue;
    try {
      await files.downloadUrl(e.url, dir);
      ok++;
    } catch {
      fail++;
    }
  }
  flash(`批量下载完成：成功 ${ok}，失败 ${fail}`);
}
