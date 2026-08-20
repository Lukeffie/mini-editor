import { marked } from "marked";
import hljs from "highlight.js";
import xml from "highlight.js/lib/languages/xml";
import json from "highlight.js/lib/languages/json";

// 显式注册语言：highlight.js 默认构建未包含 xml/json，未注册时高亮会报错导致预览空白。
// 用 try/catch 包裹，避免任何注册异常导致整个 preview 模块加载失败（进而使 detectMode/render 失效、所有文件都打不开）。
try {
  if (xml) hljs.registerLanguage("xml", xml);
  if (json) hljs.registerLanguage("json", json);
} catch (_) {
  /* 语言包缺失时降级为纯文本高亮，不影响打开与预览 */
}

marked.setOptions({ gfm: true, breaks: true });

// 编辑器支持的文件格式（用于文件树过滤、预览模式识别）
export const SUPPORTED_EXT = [
  "txt",
  "md",
  "markdown",
  "html",
  "htm",
  "json",
  "xml",
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

export function render(previewEl, iframeEl, content, mode) {
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
      content +
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
    return;
  }

  if (mode === "json" || mode === "xml") {
    renderData(previewEl, content, mode);
    return;
  }

  // markdown
  previewEl.innerHTML = marked.parse(content);
  previewEl.querySelectorAll("pre code").forEach((b) => {
    try {
      hljs.highlightElement(b);
    } catch (_) {}
  });
  annotateMarkdown(previewEl, content);
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
