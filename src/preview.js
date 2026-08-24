import { marked } from "marked";
import hljs from "highlight.js";
import xml from "highlight.js/lib/languages/xml";
import json from "highlight.js/lib/languages/json";
import yaml from "highlight.js/lib/languages/yaml";
import { dirname, join } from "@tauri-apps/api/path";
import * as files from "./files.js";

// 显式注册语言：highlight.js 默认构建未包含 xml/json/yaml，未注册时高亮会报错导致预览空白。
// 用 try/catch 包裹，避免任何注册异常导致整个 preview 模块加载失败（进而使 detectMode/render 失效、所有文件都打不开）。
try {
  if (xml) hljs.registerLanguage("xml", xml);
  if (json) hljs.registerLanguage("json", json);
  if (yaml) hljs.registerLanguage("yaml", yaml);
} catch (_) {
  /* 语言包缺失时降级为纯文本高亮，不影响打开与预览 */
}

marked.setOptions({ gfm: true, breaks: true });

// 把相对图片路径解析为可在 webview 中加载的地址。
// 策略：本地图片统一读取为 base64 data URI 内联，避免依赖 asset 协议
// （dev 模式下 asset 服务器可能未监听，导致 ERR_CONNECTION_REFUSED；且不受 CSP 限制）。
// 远程 http(s)/data/blob 地址原样返回。
async function resolveImageSrc(src, filePath) {
  if (!src) return src;
  if (/^(https?:)?\/\//i.test(src) || /^(data|blob):/i.test(src)) {
    return src;
  }
  if (!filePath) return src; // 无本地路径（如拖入）则保持原样
  // marked/浏览器会把链接/图片里的非 ASCII 路径做 URL 编码，需解码回原始中文
  let rawSrc = src;
  try { rawSrc = decodeURIComponent(src); } catch (_) {}
  // 用 Tauri 官方 path API 基于文档目录拼接出绝对路径
  let abs;
  if (/^[a-zA-Z]:[\\/]/.test(rawSrc) || rawSrc.startsWith("/")) {
    abs = rawSrc; // 绝对路径直接用
  } else {
    const dir = await dirname(filePath);
    abs = await join(dir, rawSrc);
  }
  // Tauri 环境：读取图片二进制并内联为 data URI
  if (typeof window !== "undefined" && "__TAURI_INTERNALS__" in window) {
    try {
      const dataUri = await files.readFileBase64(abs);
      console.log("[img] src=", src, " decoded=", rawSrc, " abs=", abs, " dataUri?", !!dataUri);
      if (dataUri) return dataUri;
    } catch (e) {
      console.error("读取图片失败", abs, e);
    }
  }
  // 退化：浏览器环境尝试 file://；Tauri 下若读不到则不强行 file://（会被跨源拦截显示 about:blank#blocked）
  if (typeof window !== "undefined" && "__TAURI_INTERNALS__" in window) {
    return src; // 保持原始相对路径，至少不出现 about:blank#blocked
  }
  return "file:///" + abs.replace(/\\/g, "/").replace(/^\//, "");
}

// HTML 预览：把内容里 <img src="相对"> 的相对路径转为可加载地址（脚本/样式不动）
async function resolveHtmlImages(html, filePath) {
  const re = /(<img\b[^>]*\bsrc=")([^"]*)(")/gi;
  const promises = [];
  const out = html.replace(re, (m, pre, src, post) => {
    promises.push(
      resolveImageSrc(src, filePath).then((resolved) => ({ src, resolved }))
    );
    return m; // 先占位，异步替换
  });
  if (!promises.length) return html;
  const map = await Promise.all(promises);
  const bySrc = new Map(map.map((x) => [x.src, x.resolved]));
  return out.replace(re, (m, pre, src, post) =>
    bySrc.has(src) ? pre + bySrc.get(src) + post : m
  );
}

// 编辑器支持的文件格式（用于文件树过滤、预览模式识别）
export const SUPPORTED_EXT = [
  "txt",
  "md",
  "markdown",
  "html",
  "htm",
  "json",
  "xml",
  "yaml",
  "yml",
];

function escapeHtml(s) {
  return s.replace(/[&<>"']/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c])
  );
}

export function detectMode(filename, selected) {
  if (selected && selected !== "auto") return selected;
  if (!filename) return "md";
  const ext = (filename.split(".").pop() || "").toLowerCase();
  if (ext === "md" || ext === "markdown") return "md";
  if (ext === "html" || ext === "htm") return "html";
  if (ext === "json") return "json";
  if (ext === "xml") return "xml";
  if (ext === "yaml" || ext === "yml") return "yaml";
  return "txt";
}

// 给 Markdown 的各级标题标注其在源文件中的行号，供滚动联动定位
function annotateMarkdown(previewEl, content) {
  const headings = previewEl.querySelectorAll("h1,h2,h3,h4,h5,h6");
  let cursor = 0;
  headings.forEach((h) => {
    const text = h.textContent.trim();
    if (!text) return;
    const idx = content.indexOf(text, cursor);
    let line = 1;
    if (idx >= 0) {
      line = content.slice(0, idx).split("\n").length;
      cursor = idx + text.length;
    }
    h.setAttribute("data-line", String(line));
  });
}

// 渲染（含图片异步加载）完成后通知，供滚动联动重建锚点，避免图片加载后布局变化导致左右对不齐
function notifyRendered(previewEl) {
  previewEl.dispatchEvent(new CustomEvent("preview:rendered"));
}

export async function render(previewEl, iframeEl, content, mode, filePath) {
  if (mode === "html") {
    previewEl.hidden = true;
    iframeEl.hidden = false;
    // 显示 loading，等待 iframe 加载完成再隐藏（HTML 渲染需一点时间）
    const pane = previewEl.parentNode;
    let loading = pane && pane.querySelector(".preview-loading");
    if (!loading && pane) {
      loading = document.createElement("div");
      loading.className = "preview-loading";
      loading.innerHTML = '<div class="spinner"></div><span>预览渲染中…</span>';
      pane.appendChild(loading);
    }
    if (loading) loading.style.display = "flex";
    iframeEl.onload = () => {
      if (loading) loading.style.display = "none";
      notifyRendered(previewEl);
    };
    // 允许脚本执行（sandbox="allow-scripts"，不含 allow-same-origin，避免可逃逸沙箱警告），
    // 并注入内联错误捕获脚本：把脚本错误 / 资源加载失败直接显示在预览页顶部，
    // 这样任何异常都可见，而不是空白或只在控制台。
    const errCatcher =
      "<script>(function(){" +
      'var box=document.createElement("div");' +
      'box.setAttribute("style","position:relative;margin:0 0 12px;padding:10px 12px;background:#fff3f3;border:1px solid #f3c2c2;color:#b00020;border-radius:6px;font:13px/1.6 ui-monospace,Consolas,monospace;white-space:pre-wrap");' +
      'box.id="__preview_errors__";' +
      'function add(msg){box.appendChild(document.createTextNode("• "+msg+"\\n"));if(!box.parentNode)document.body.insertBefore(box,document.body.firstChild);}' +
      'window.addEventListener("error",function(e){' +
      'if(e.target&&(e.target.src||e.target.href))add("资源加载失败: "+(e.target.src||e.target.href));' +
      'else add("脚本错误: "+(e.message||e.error||"未知")+(e.filename?(" @ "+e.filename+":"+e.lineno):""));},true);' +
      'window.addEventListener("unhandledrejection",function(e){add("Promise 异常: "+(e.reason&&e.reason.message?e.reason.message:e.reason));});' +
      "})();<\/script>";
    iframeEl.srcdoc =
      '<!doctype html><html><head><meta charset="utf-8">' +
      "<style>body{font-family:system-ui,'Microsoft YaHei',sans-serif;padding:16px;line-height:1.7;color:#1f2328}" +
      "pre{background:#f6f8fa;padding:12px;border-radius:6px;overflow:auto}code{background:#f6f8fa;padding:2px 4px;border-radius:4px}" +
      "blockquote{border-left:3px solid #4f8cff;margin:8px 0;padding-left:8px;color:#555}</style>" +
      errCatcher +
      "</head><body>" +
      await resolveHtmlImages(content, filePath) +
      "</body></html>";
    return;
  }

  iframeEl.hidden = true;
  previewEl.hidden = false;

  if (mode === "txt") {
    // 纯文本：逐行包成带 data-line 的 div，滚动联动可精确到行
    const lines = content.split("\n");
    previewEl.innerHTML =
      '<div class="raw">' +
      lines
        .map(
          (ln, i) =>
            `<div class="ln" data-line="${i + 1}">${escapeHtml(ln) || "&nbsp;"}</div>`
        )
        .join("") +
      "</div>";
    notifyRendered(previewEl);
    return;
  }

  if (mode === "json" || mode === "xml" || mode === "yaml") {
    renderData(previewEl, content, mode);
    notifyRendered(previewEl);
    return;
  }

  // markdown
  previewEl.innerHTML = marked.parse(content);
  // 把相对图片路径解析为可加载地址（基于当前文档目录）
  const imgs = Array.from(previewEl.querySelectorAll("img"));
  await Promise.all(
    imgs.map(async (img) => {
      const resolved = await resolveImageSrc(img.getAttribute("src"), filePath);
      if (resolved) img.setAttribute("src", resolved);
    })
  );
  previewEl.querySelectorAll("pre code").forEach((b) => {
    try {
      hljs.highlightElement(b);
    } catch (_) {}
  });
  annotateMarkdown(previewEl, content);
  notifyRendered(previewEl);
}

// JSON / XML 格式化 + 语法高亮预览
function renderData(previewEl, content, mode) {
  let pretty = content;
  let code = "";
  let lang = mode;

  if (mode === "json") {
    try {
      pretty = JSON.stringify(JSON.parse(content), null, 2);
    } catch (_) {
      pretty = content; // 无法解析时原样展示
    }
    code = pretty;
    lang = "json";
  } else if (mode === "yaml") {
    // YAML 不需格式化，直接高亮原内容
    code = content;
    lang = "yaml";
  } else {
    // XML：尽量美化缩进
    try {
      pretty = formatXml(content);
    } catch (_) {
      pretty = content;
    }
    code = pretty;
    lang = "xml";
  }

  previewEl.innerHTML =
    '<pre class="code-block"><code class="language-' +
    lang +
    '">' +
    escapeHtml(code) +
    "</code></pre>";

  const block = previewEl.querySelector("code");
  if (block) {
    try {
      // 仅当语言已注册才高亮，否则保留格式化后的纯文本
      if (hljs.getLanguage(lang)) hljs.highlightElement(block);
    } catch (_) {}
  }
}

// 轻量 XML 美化：按标签断行并缩进
function formatXml(xml) {
  const PADDING = "  ";
  const reg = /(>)(<)(\/*)/g;
  let formatted = xml.replace(reg, "$1\n$2$3");
  let pad = 0;
  return formatted
    .split("\n")
    .map((line) => {
      line = line.trim();
      if (!line) return "";
      const isClosing = /^<\//.test(line);
      const isSelfClose = /\/>$/.test(line);
      const isOpening = /^<[^!?]/.test(line) && !isClosing && !isSelfClose;
      let out;
      if (isClosing) {
        pad = Math.max(0, pad - 1);
        out = PADDING.repeat(pad) + line;
      } else {
        out = PADDING.repeat(pad) + line;
        if (isOpening) pad += 1;
      }
      return out;
    })
    .join("\n")
    .trim();
}
