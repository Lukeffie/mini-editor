import { EditorView } from "codemirror";

// 编辑器（左）与预览（右）滚动联动：以预览中的标题/行号（data-line）为锚点对齐。
// 关键：图片是异步加载的，加载完成后预览布局会变，因此必须在渲染完成事件
// （preview:rendered）后重建锚点，否则锚点位置是过期的，导致左右滚动对不齐。

let anchors = [];
let syncing = false;
let t1 = null;
let t2 = null;
let r1 = null;

function buildAnchors(previewEl, previewPane) {
  anchors = [];
  if (!previewPane) return;
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

// 找到「行号 <= 当前行」且最大的锚点（即当前编辑位置所属的上一标题/行），
// 把预览滚动到该锚点顶部对齐，使左右两侧在该标题处对齐。
function anchorForLine(line) {
  if (!anchors.length) return null;
  let a = anchors[0];
  for (const x of anchors) {
    if (x.line <= line) a = x;
    else break;
  }
  return a;
}

function syncPreviewToEditor(view, previewPane) {
  if (!anchors.length) return;
  const line = editorTopLine(view);
  const a = anchorForLine(line);
  if (!a) return;
  previewPane.scrollTop = Math.max(0, a.top - 8);
}

// 预览滚动到某 y 位置时，找到其下方最近的锚点，把编辑器滚动到对应源行，
// 并尽量让该行处于编辑器顶部，使两侧对齐。
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

  const rebuild = () => buildAnchors(previewEl, previewPane);

  // 预览内容变化时（含图片异步加载完成）重建锚点
  previewEl.addEventListener("preview:rendered", rebuild);
  previewEl.addEventListener &&
    new ResizeObserver(rebuild).observe(previewPane);
  window.addEventListener("resize", () => {
    clearTimeout(r1);
    r1 = setTimeout(rebuild, 100);
  });

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

  return { rebuild };
}
