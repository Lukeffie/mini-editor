import { EditorView } from "codemirror";

// 编辑器（左）与预览（右）滚动联动：以预览中的标题/行号（data-line）为锚点对齐。
//
// 设计要点（都是为消除"闪跳"服务的）：
// 1) 锚点只来自标题（md）或每行（txt），文档末尾往往没有锚点。
//    如果不补一个"末尾虚拟锚点"，末尾段落就完全无法跟随，只能被钉在最后一个
//    锚点上——这正是"在文件末尾打字时页面闪跳"的原因。
// 2) 所有"预览跟随编辑器"的对齐都走同一个入口（scheduleAlign），同一时刻只有一个
//    待执行任务，且执行时重新读取当前位置。否则"编辑器滚动"和"预览重渲染"会各自
//    触发一次对齐，先后写入两个不同位置，表现为跳一下又跳回来。
// 3) 反向同步（预览 → 编辑器）只认用户主动滚动。内容变短时浏览器会把 scrollTop
//    夹回，这同样会触发 scroll 事件；不加区分就会把编辑器硬拽到别处。
// 4) 内容重排（图片解码、字体回退）会让布局在渲染完成后继续变化，因此对齐要
//    多进行一次"沉淀"校正；位置没变时会被跳过，不会产生多余滚动。

let anchors = [];
let view = null;
let previewPaneRef = null;

// 同步进行中的守卫，避免 A→B→A 回环
let syncing = false;
// 反向（预览 → 编辑器）防抖
let t2 = null;
// 窗口缩放的锚点重建防抖
let r1 = null;
// 唯一的"预览跟随编辑器"待执行任务
let alignTimer = null;
// 该任务是否由"用户滚动编辑器"触发（由用户滚动触发的更强势，不受浏览守卫限制）
let alignForce = false;
// 外部正在恢复滚动位置（如切换页签），此期间禁止自动对齐去争抢位置
let suppressUntil = 0;
// 布局沉淀后的二次校正
let settleTimer = null;

// 我们自己刚动过某一侧的时间窗口
let ownEditorScrollUntil = 0;
let ownPreviewScrollUntil = 0;
// 用户在预览区真实滚动的最后时刻
let userPreviewScrollAt = 0;

const OWN_WINDOW = 150; // 程序化滚动后的抑制窗口
const USER_INTENT_WINDOW = 400; // 用户滚动意图的有效期
const ALIGN_DEBOUNCE = 30; // 对齐防抖
const SETTLE_DELAY = 160; // 布局沉淀后再校正一次的延迟
const SYNC_HOLD = 80; // 一次同步期间屏蔽反向同步的时长

function markOwnEditor() {
  ownEditorScrollUntil = Date.now() + OWN_WINDOW;
}
function markOwnPreview() {
  ownPreviewScrollUntil = Date.now() + OWN_WINDOW;
}
function markUserPreviewScroll() {
  userPreviewScrollAt = Date.now();
}
function isUserPreviewScroll() {
  return Date.now() - userPreviewScrollAt < USER_INTENT_WINDOW;
}
// 用户是否刚在手动浏览预览（此时不要去抢滚动位置）
function userBrowsingPreview() {
  return Date.now() - userPreviewScrollAt < USER_INTENT_WINDOW * 1.5;
}

// 执行一次同步，并在 SYNC_HOLD 内屏蔽反向同步
function isSuppressed() {
  return Date.now() < suppressUntil;
}

// 切换页签等场景：两侧都会程序化地恢复各自的滚动位置，这期间产生的 scroll 事件
// 不是用户意图，必须短时禁止自动对齐，否则恢复出来的位置会被立刻覆盖掉。
function suppressAlign(ms = 450) {
  suppressUntil = Math.max(suppressUntil, Date.now() + ms);
}

function withSyncGuard(fn) {
  syncing = true;
  try {
    fn();
  } finally {
    setTimeout(() => (syncing = false), SYNC_HOLD);
  }
}

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

  // 补一个末尾虚拟锚点：行号 = 文档末行，位置 = 预览可滚动内容的底部。
  // 没有它的话，最后一个标题之后的整段内容都无法被跟随。
  const total = view ? view.state.doc.lines : 0;
  const last = anchors[anchors.length - 1];
  if (total > 0 && (!last || last.line < total)) {
    anchors.push({ line: total, top: previewPane.scrollHeight, virtual: true });
  }
}

function editorTopLine(view) {
  const block = view.lineBlockAtHeight(view.scrollDOM.scrollTop);
  return view.state.doc.lineAt(block.from).number;
}

function previewMaxScroll(previewPane) {
  return Math.max(0, previewPane.scrollHeight - previewPane.clientHeight);
}

// 只在目标值与当前值确实不同时才赋值，避免"设了个相同值"也触发一次 scroll 事件。
function setPreviewScroll(previewPane, top) {
  const v = Math.max(0, Math.min(top, previewMaxScroll(previewPane)));
  // 差值在 1px 内视为没变：插值本身有亚像素误差，放过它可以避免肉眼可见的微抖
  if (Math.abs(previewPane.scrollTop - v) < 1) return;
  previewPane.scrollTop = v;
  markOwnPreview();
}

// 在两个相邻锚点之间做线性插值，让同步滚动能连续跟踪，而不是只"跳"到标题顶部。
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
      else {
        b = x;
        break;
      }
    }
    if (!b) target = a.top;
    else {
      const span = b.line - a.line || 1;
      const f = (line - a.line) / span;
      target = a.top + (b.top - a.top) * f;
    }
  }
  setPreviewScroll(previewPane, target - 8);
}

// 预览滚动到某 y 位置时，在相邻锚点之间插值出对应的源行号，把编辑器滚动到该行。
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
      else {
        b = x;
        break;
      }
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
  markOwnEditor();
  view.dispatch({
    effects: EditorView.scrollIntoView(lineObj.from, { y: "start" }),
  });
}

// 唯一的"预览跟随编辑器"入口。
// 同一时刻只允许一个待执行任务：编辑器滚动与预览重渲染会先后请求对齐，
// 这里把请求合并成一次，执行时再读最新位置，避免两次写入互相推挤。
// force=true 表示"用户明确在滚动编辑器"，此时不受预览浏览守卫限制。
function scheduleAlign(delay = ALIGN_DEBOUNCE, force = false) {
  if (isSuppressed()) return; // 外部正在恢复滚动位置，不去争抢
  if (force) alignForce = true;
  if (alignTimer) return; // 已有待执行的任务，直接合并（force 已记录到 alignForce）
  alignTimer = setTimeout(() => {
    alignTimer = null;
    const f = alignForce;
    alignForce = false;
    if (syncing) return;
    if (!anchors.length || !previewPaneRef) return;
    if (!f && userBrowsingPreview()) return; // 用户正在手动浏览预览，不打扰
    withSyncGuard(() => syncPreviewToEditor(view, previewPaneRef));
  }, delay);
}

// 点击预览标题跳到源码时调用：滚动编辑器到目标行，但标记为"我们自己的滚动"，
// 阻止随之而来的反向同步把预览"闪"回去（解决点击闪滚）。
function scrollEditorToLine(line) {
  const ln = Math.min(Math.max(line, 1), view.state.doc.lines);
  const lineObj = view.state.doc.line(ln);
  markOwnEditor();
  withSyncGuard(() => {
    view.dispatch({
      effects: EditorView.scrollIntoView(lineObj.from, { y: "start" }),
    });
  });
}

export function setupScrollSync({ editor, previewPane, previewEl, debounce = ALIGN_DEBOUNCE }) {
  view = editor.view;
  previewPaneRef = previewPane;

  const rebuild = () => buildAnchors(previewEl, previewPane);

  // 内容 / 布局变化后调用。
  // 关键：preview.js 重绘时会保留预览的滚动位置，所以正常情况下预览应当原地更新、
  // 一动不动——这里只重建锚点，绝不重新定位。只有位置确实丢了（重绘被归零，或内容
  // 变短被浏览器夹回）才校正。这正是"每敲一个字预览就抖一下"的根因所在。
  const refresh = (e) => {
    buildAnchors(previewEl, previewPane);
    const d = e && e.detail;
    const lost = !d || !d.preserved || d.clamped;
    if (!lost) return;

    scheduleAlign(debounce);
    // 渲染完成时布局未必是最终态（图片尚未解码、字体还在回退），
    // 稍后再校正一次。位置没变化时 setPreviewScroll 会跳过，不会抖动。
    if (settleTimer) clearTimeout(settleTimer);
    settleTimer = setTimeout(() => {
      settleTimer = null;
      buildAnchors(previewEl, previewPane);
      scheduleAlign(0);
    }, SETTLE_DELAY);
  };

  // 预览内容变化时（含图片异步加载完成）重建锚点
  previewEl.addEventListener("preview:rendered", refresh);
  new ResizeObserver(rebuild).observe(previewPane);
  window.addEventListener("resize", () => {
    clearTimeout(r1);
    r1 = setTimeout(() => {
      buildAnchors(previewEl, previewPane);
      scheduleAlign(0);
    }, 100);
  });

  // 防抖：装饰代码块等操作会连续改动 DOM，逐次重建锚点会造成大量强制回流。
  // 注意这里只重建锚点、不重新定位，避免与输入竞争滚动位置。
  let m1 = null;
  const obs = new MutationObserver(() => {
    if (m1) clearTimeout(m1);
    m1 = setTimeout(() => {
      m1 = null;
      buildAnchors(previewEl, previewPane);
    }, 50);
  });
  obs.observe(previewEl, { childList: true, subtree: true });
  buildAnchors(previewEl, previewPane);

  // 用户主动滚动预览的信号：滚轮、触摸拖动、键盘翻页、拖动滚动条。
  // 只有这些才算"用户意图"，内容变短引起的 scrollTop 回弹不会命中。
  ["wheel", "touchmove", "pointerdown", "keydown"].forEach((ev) =>
    previewPane.addEventListener(ev, markUserPreviewScroll, { passive: true })
  );

  // 编辑器 → 预览（编辑器是主方向）。
  // 用户滚动、以及删行/追加后 CodeMirror 自身的位置调整，都应该让预览跟随，
  // 所以这一侧不需要判断用户意图。
  view.scrollDOM.addEventListener("scroll", () => {
    if (syncing) return;
    if (Date.now() < ownEditorScrollUntil) return;
    scheduleAlign(debounce, true);
  });

  // 预览 → 编辑器（从方向）。必须是用户主动滚动，否则内容回弹会把编辑器拽走。
  previewPane.addEventListener("scroll", () => {
    if (syncing) return;
    if (Date.now() < ownPreviewScrollUntil) return;
    if (!isUserPreviewScroll()) return;
    if (t2) clearTimeout(t2);
    t2 = setTimeout(() => {
      t2 = null;
      // 防抖期间状态可能已变，执行前重新确认
      if (syncing) return;
      if (!isUserPreviewScroll()) return;
      withSyncGuard(() => syncEditorToPreview(view, previewPane));
    }, debounce);
  });

  return { rebuild, refresh, suppressAlign, scrollEditorToLine };
}
