import { EditorView } from "codemirror";

// 编辑器（左）与预览（右）滚动联动：对应行尽量显示在同一行。
// 锚点来自预览元素上的 data-line（标题 / 纯文本行）。

let anchors = [];
let syncing = false;
let t1 = null;
let t2 = null;

function buildAnchors(previewEl, previewPane) {
  anchors = [];
  const els = previewEl.querySelectorAll("[data-line]");
  const baseTop = previewPane.getBoundingClientRect().top;
  els.forEach((el) => {
    const line = parseInt(el.getAttribute("data-line"), 10);
    if (isNaN(line)) return;
    const top = el.getBoundingClientRect().top - baseTop + previewPane.scrollTop;
    anchors.push({ line, top });
  });
  anchors.sort((a, b) => a.line - b.line);
}

function editorTopLine(view) {
  const block = view.lineBlockAtHeight(view.scrollDOM.scrollTop);
  return view.state.doc.lineAt(block.from).number;
}

function syncPreviewToEditor(view, previewPane) {
  if (!anchors.length) return;
  const line = editorTopLine(view);
  let lo = anchors[0];
  let hi = anchors[anchors.length - 1];
  for (const a of anchors) {
    if (a.line <= line) lo = a;
    if (a.line >= line) {
      hi = a;
      break;
    }
  }
  let targetTop;
  if (hi.line === lo.line) targetTop = lo.top;
  else {
    const f = (line - lo.line) / (hi.line - lo.line);
    targetTop = lo.top + f * (hi.top - lo.top);
  }
  previewPane.scrollTop = Math.max(0, targetTop - 8);
}

function syncEditorToPreview(view, previewPane) {
  if (!anchors.length) return;
  const y = previewPane.scrollTop + 8;
  let cur = anchors[0];
  for (const a of anchors) if (a.top <= y) cur = a;
  const line = Math.min(cur.line, view.state.doc.lines);
  const lineObj = view.state.doc.line(line);
  view.dispatch({
    effects: EditorView.scrollIntoView(lineObj.from, { y: "start" }),
  });
}

export function setupScrollSync({ editor, previewPane, previewEl, debounce = 30 }) {
  const view = editor.view;

  const obs = new MutationObserver(() => buildAnchors(previewEl, previewPane));
  obs.observe(previewEl, { childList: true, subtree: true });
  buildAnchors(previewEl, previewPane);

  view.scrollDOM.addEventListener("scroll", () => {
    if (syncing) return;
    clearTimeout(t1);
    t1 = setTimeout(() => {
      syncing = true;
      syncPreviewToEditor(view, previewPane);
      setTimeout(() => (syncing = false), 80);
    }, debounce);
  });

  previewPane.addEventListener("scroll", () => {
    if (syncing) return;
    clearTimeout(t2);
    t2 = setTimeout(() => {
      syncing = true;
      syncEditorToPreview(view, previewPane);
      setTimeout(() => (syncing = false), 80);
    }, debounce);
  });

  return { rebuild: () => buildAnchors(previewEl, previewPane) };
}
