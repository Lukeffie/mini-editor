import { marked } from "marked";
import hljs from "highlight.js";

marked.setOptions({ gfm: true, breaks: true });

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
    iframeEl.srcdoc =
      '<!doctype html><html><head><meta charset="utf-8">' +
      "<style>body{font-family:system-ui,'Microsoft YaHei',sans-serif;padding:16px;line-height:1.7;color:#1f2328}" +
      "pre{background:#f6f8fa;padding:12px;border-radius:6px;overflow:auto}code{background:#f6f8fa;padding:2px 4px;border-radius:4px}" +
      "blockquote{border-left:3px solid #4f8cff;margin:8px 0;padding-left:8px;color:#555}</style>" +
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

  // markdown
  previewEl.innerHTML = marked.parse(content);
  previewEl.querySelectorAll("pre code").forEach((b) => {
    try {
      hljs.highlightElement(b);
    } catch (_) {}
  });
  annotateMarkdown(previewEl, content);
}
