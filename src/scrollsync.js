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

// 在两个相邻锚点之间做线性插值，让同步滚动能连续跟踪，而不是只"跳"到标题顶部。
// 这样在一段标题内部滚动时，左右两侧也能保持对齐（解决"对不上"）。
function syncPreviewToEditor(view, previewPane) {
  if (!anchors.length) return;
  const line = editorTopLine(view);
  let target;
  if (line <= anchors[0].line) {
    // 当前行在第一条锚点之前：从预览顶部按行比例推算
    const f = anchors[0].line > 1 ? (line - 1) / (anchors[0].line - 1) : 0;
    target = anchors[0].top * f;
  } else {
    let a = anchors[0];
    let b = null;
    for (const x of anchors) {
      if (x.line <= line) a = x;
      else { b = x; break; }
    }
    if (!b) target = a.top;
    else {
      const span = b.line - a.line || 1;
      const f = (line - a.line) / span;
      target = a.top + (b.top - a.top) * f;
    }
  }
  const max = previewPane.scrollHeight - previewPane.clientHeight;
  previewPane.scrollTop = Math.max(0, Math.min(target - 8, max < 0 ? 0 : max));
}

// 预览滚动到某 y 位置时，在相邻锚点之间插值出对应的源行号，把编辑器滚动到该行，
// 使两侧尽量对齐，而不是只对齐到最近的标题。
function syncEditorToPreview(view, previewPane) {
  if (!anchors.length) return;
  const y = previewPane.scrollTop + 8;
  let line;
  if (y <= anchors[0].top) {
    const f = anchors[0].top > 0 ? y / anchors[0].top : 0;
    line = Math.max(1, Math.round(1 + (anchors[0].line - 1) * f));
  } else {
    let a = anchors[0];
    let b = null;
    for (const x of anchors) {
      if (x.top <= y) a = x;
      else { b = x; break; }
    }
    if (!b) line = a.line;
    else {
      const span = b.top - a.top || 1;
      const f = (y - a.top) / span;
      line = Math.round(a.line + (b.line - a.line) * f);
    }
  }
  const ln = Math.min(line, view.state.doc.lines);
  const lineObj = view.state.doc.line(ln);
  view.dispatch({
    effects: EditorView.scrollIntoView(lineObj.from, { y: "start" }),
  });
}

// 点击预览标题跳到源码时调用：滚动编辑器到目标行，但置位 syncing 守卫，
// 阻止随之而来的 preview→editor 反向同步把预览"闪"回去（解决点击闪滚）。
function scrollEditorToLine(line) {
  const ln = Math.min(Math.max(line, 1), view.state.doc.lines);
  const lineObj = view.state.doc.line(ln);
  syncing = true;
  view.dispatch({
    effects: EditorView.scrollIntoView(lineObj.from, { y: "start" }),
  });
  setTimeout(() => (syncing = false), 80);
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

  return { rebuild, scrollEditorToLine };
}
