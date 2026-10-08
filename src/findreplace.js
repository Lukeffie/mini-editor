// 一键查找 / 替换：页面顶部的浮动工具栏（Chrome 风格）
// 只提供「查找 + 替换」，不做正则 / 大小写 / 全词等复杂选项。
//
// 有两套后端，按当前视图自动切换：
//   - editor 后端：编辑框可见时用 CodeMirror StateField 维护匹配并渲染高亮
//   - preview 后端：预览视图（编辑框隐藏）时直接扫描预览 DOM 的文本节点，
//     用原生 Selection 高亮当前匹配项，避免改动渲染结果
// 两者共用同一条工具栏 UI。

import { StateEffect, StateField } from "@codemirror/state";
import { Decoration, EditorView } from "@codemirror/view";

// 匹配过多时截断，避免超大文档卡死
const MAX_MATCHES = 20000;

// 是否支持 CSS 自定义高亮（::highlight）。支持时用它标记预览区的当前匹配项：
// 不改动 DOM、也不占用原生选区。不支持（旧版 WebView）时退回用选区标记。
const SUPPORTS_HIGHLIGHT =
  typeof CSS !== "undefined" && !!CSS.highlights && typeof Highlight !== "undefined";

const setQueryEffect = StateEffect.define(); // payload: string
const setIndexEffect = StateEffect.define(); // payload: number

const matchDeco = Decoration.mark({ class: "cm-find-match" });
const activeDeco = Decoration.mark({ class: "cm-find-match cm-find-active" });

// 纯文本子串查找（不区分大小写，与 Chrome 默认行为一致）
function findMatchesInText(text, query) {
  if (!query) return [];
  const hay = text.toLowerCase();
  const needle = query.toLowerCase();
  const out = [];
  let from = hay.indexOf(needle);
  while (from !== -1) {
    out.push({ from, to: from + needle.length });
    if (out.length >= MAX_MATCHES) break;
    from = hay.indexOf(needle, from + needle.length);
  }
  return out;
}

const findStateField = StateField.define({
  create: () => ({ query: "", matches: [], index: 0 }),
  update(value, tr) {
    let next = value;

    // 显式更新：改查询词 / 改当前下标
    for (const e of tr.effects) {
      if (e.is(setQueryEffect)) {
        const q = e.value;
        next = { query: q, matches: findMatchesInText(tr.state.doc.toString(), q), index: 0 };
      } else if (e.is(setIndexEffect)) {
        next = { ...next, index: e.value };
      }
    }

    // 文档被改动（编辑、替换、切换页签）：重算匹配，并尽量停留在原来的位置
    if (tr.docChanged) {
      if (!next.query) {
        next = { query: "", matches: [], index: 0 };
      } else {
        const anchor =
          value.matches.length && value.index < value.matches.length
            ? tr.changes.mapPos(value.matches[value.index].from, 1)
            : null;
        const matches = findMatchesInText(tr.state.doc.toString(), next.query);
        let index = 0;
        if (anchor != null && matches.length) {
          let best = 0;
          let bestDelta = Infinity;
          for (let i = 0; i < matches.length; i++) {
            const d = Math.abs(matches[i].from - anchor);
            if (d < bestDelta) {
              bestDelta = d;
              best = i;
            }
          }
          index = best;
        }
        next = { query: next.query, matches, index };
      }
    }
    return next;
  },
  provide: (f) =>
    EditorView.decorations.from(f, (s) => {
      if (!s.matches.length) return Decoration.none;
      const idx = Math.max(0, Math.min(s.index, s.matches.length - 1));
      return Decoration.set(
        s.matches.map((m, i) => (i === idx ? activeDeco : matchDeco).range(m.from, m.to)),
        true
      );
    }),
});

// 文档在面板打开期间被直接编辑时，用于刷新计数与按钮状态的钩子
let onDocChanged = null;

// 需要挂到编辑器上的扩展（高亮 + 变更监听）
export const findHighlight = [
  findStateField,
  EditorView.updateListener.of((u) => {
    if (u.docChanged && onDocChanged) onDocChanged();
  }),
];

// ===================== 后端一：编辑框（CodeMirror） =====================

function createEditorBackend(view) {
  const getState = () => view.state.field(findStateField, false) || { query: "", matches: [], index: 0 };
  const curIndex = (s) => (s.matches.length ? Math.max(0, Math.min(s.index, s.matches.length - 1)) : -1);

  // 把第 i 个匹配项设为当前项：选中 + 滚动到可视区
  function showMatch(i, scroll = true) {
    const s = getState();
    if (!s.matches.length) return;
    const idx = ((i % s.matches.length) + s.matches.length) % s.matches.length;
    const m = s.matches[idx];
    const effects = [setIndexEffect.of(idx)];
    if (scroll) effects.push(EditorView.scrollIntoView(m.from, { y: "center" }));
    view.dispatch({ effects, selection: { anchor: m.from, head: m.to } });
  }

  return {
    kind: "editor",
    supportsReplace: true,

    state() {
      const s = getState();
      return { query: s.query, total: s.matches.length, index: curIndex(s), unsupported: false };
    },

    // nearest=true 时跳到光标处（或其后第一个）的匹配项，与浏览器行为一致
    setQuery(q, { nearest = false, scroll = true } = {}) {
      view.dispatch({ effects: setQueryEffect.of(q) });
      const s = getState();
      if (s.matches.length) {
        let idx = 0;
        if (nearest) {
          const pos = view.state.selection.main.head;
          const found = s.matches.findIndex((m) => m.from >= pos);
          idx = found < 0 ? 0 : found;
        }
        showMatch(idx, scroll);
      }
    },

    step(delta) {
      const s = getState();
      if (!s.matches.length) return;
      showMatch(curIndex(s) + delta);
    },

    // 返回被替换的处数
    replaceCurrent(text) {
      const s = getState();
      const idx = curIndex(s);
      if (idx < 0) return 0;
      const m = s.matches[idx];
      view.dispatch({
        changes: { from: m.from, to: m.to, insert: text },
        scrollIntoView: true,
      });
      // 文档变更后 matches/index 已重算，停在原位（即原匹配之后的那一项）
      const s2 = getState();
      if (s2.matches.length) showMatch(Math.min(curIndex(s2), s2.matches.length - 1));
      return 1;
    },

    replaceAll(text) {
      const s = getState();
      if (!s.matches.length) return 0;
      const n = s.matches.length;
      view.dispatch({
        changes: s.matches.map((m) => ({ from: m.from, to: m.to, insert: text })),
        scrollIntoView: true,
      });
      return n;
    },

    selectedText() {
      const sel = view.state.selection.main;
      if (sel.empty) return "";
      const picked = view.state.sliceDoc(sel.from, sel.to);
      if (!picked || picked.length > 200 || picked.includes("\n")) return "";
      return picked;
    },

    clear() {
      view.dispatch({ effects: setQueryEffect.of("") });
    },

    refresh() {}, // 编辑器后端随文档变更自动更新，无需手动刷新
  };
}

// ===================== 后端二：预览区（DOM 文本节点） =====================

function createPreviewBackend(previewEl, previewPane) {
  // 文本节点索引：把预览内所有文本拼成一个大字符串，记录每段对应的节点与偏移
  let nodes = [];
  let text = "";
  let matches = [];
  let index = 0;
  let query = "";

  function collect() {
    text = "";
    nodes = [];
    const walker = document.createTreeWalker(previewEl, NodeFilter.SHOW_TEXT, {
      acceptNode(n) {
        const v = n.nodeValue;
        if (!v) return NodeFilter.FILTER_REJECT;
        const p = n.parentElement;
        if (!p) return NodeFilter.FILTER_REJECT;
        // 排除代码块标题栏（语言名 / 复制按钮等非正文内容）与隐藏节点
        if (p.closest(".code-head")) return NodeFilter.FILTER_REJECT;
        if (p.closest("[hidden]")) return NodeFilter.FILTER_REJECT;
        return NodeFilter.FILTER_ACCEPT;
      },
    });
    while (walker.nextNode()) {
      const n = walker.currentNode;
      nodes.push({ node: n, start: text.length, end: text.length + n.nodeValue.length });
      text += n.nodeValue;
    }
  }

  // 二分查找偏移 pos 落在哪个文本节点上
  function locate(pos) {
    let lo = 0;
    let hi = nodes.length - 1;
    while (lo <= hi) {
      const mid = (lo + hi) >> 1;
      if (pos < nodes[mid].start) hi = mid - 1;
      else if (pos > nodes[mid].end) lo = mid + 1;
      else return nodes[mid];
    }
    return null;
  }

  function rangeFor(m) {
    const a = locate(m.from);
    const b = locate(m.to);
    if (!a || !b) return null;
    try {
      const r = document.createRange();
      r.setStart(a.node, m.from - a.start);
      r.setEnd(b.node, m.to - b.start);
      return r;
    } catch (_) {
      return null;
    }
  }

  // 用 CSS 自定义高亮标记当前匹配项：不改动 DOM、不影响渲染结果
  function setHighlight(r) {
    if (!SUPPORTS_HIGHLIGHT || !r) return false;
    CSS.highlights.set("find-match", new Highlight(r));
    return true;
  }

  function clearHighlight() {
    if (SUPPORTS_HIGHLIGHT) CSS.highlights.delete("find-match");
    // 只有在兜底模式（我们确实占用了选区）下才清选区，避免误清用户自己的选中内容
    const wasFallback = document.body.classList.contains("find-fallback");
    document.body.classList.remove("find-fallback");
    if (wasFallback) {
      const sel = window.getSelection();
      if (sel) sel.removeAllRanges();
    }
  }

  function scrollRangeIntoView(r) {
    const rect = r.getBoundingClientRect();
    if (!rect.height) return;
    const paneRect = previewPane.getBoundingClientRect();
    const delta = rect.top - paneRect.top - (paneRect.height / 2 - rect.height / 2);
    previewPane.scrollTop += delta;
  }

  function show(i, scroll = true) {
    if (!matches.length) return;
    index = ((i % matches.length) + matches.length) % matches.length;
    const r = rangeFor(matches[index]);
    if (!r) return;
    if (!setHighlight(r)) {
      // 兜底：用原生选区标记，并挂上 find-fallback 让它显示为查找色
      document.body.classList.add("find-fallback");
      const sel = window.getSelection();
      if (sel) {
        sel.removeAllRanges();
        sel.addRange(r);
      }
    }
    if (scroll) scrollRangeIntoView(r);
  }

  return {
    kind: "preview",
    supportsReplace: false, // 预览是渲染结果，替换没有意义

    state() {
      // HTML 模式渲染在沙箱 iframe 里，同源策略下拿不到内部文档，无法查找
      const unsupported = previewEl.hidden === true;
      return {
        query,
        total: unsupported ? 0 : matches.length,
        index: matches.length ? Math.max(0, Math.min(index, matches.length - 1)) : -1,
        unsupported,
      };
    },

    setQuery(q, { nearest = false, scroll = true } = {}) {
      query = q;
      matches = [];
      index = 0;
      if (previewEl.hidden) return;
      if (!q) {
        clearHighlight();
        return;
      }
      collect();
      matches = findMatchesInText(text, q);
      if (!matches.length) return;

      let idx = 0;
      if (nearest) {
        // 定位到当前视口内第一个可见的匹配项
        const paneTop = previewPane.getBoundingClientRect().top;
        const cap = Math.min(matches.length, 5000);
        for (let i = 0; i < cap; i++) {
          const rr = rangeFor(matches[i]);
          if (rr && rr.getBoundingClientRect().top >= paneTop) {
            idx = i;
            break;
          }
        }
      }
      show(idx, scroll);
    },

    step(delta) {
      if (!matches.length) return;
      show(index + delta);
    },

    replaceCurrent() {
      return 0;
    },
    replaceAll() {
      return 0;
    },

    selectedText() {
      const sel = window.getSelection();
      if (!sel || sel.isCollapsed || !sel.rangeCount) return "";
      const r = sel.getRangeAt(0);
      if (!previewEl.contains(r.commonAncestorContainer)) return "";
      const picked = sel.toString();
      if (!picked || picked.length > 200 || picked.includes("\n")) return "";
      return picked;
    },

    clear() {
      query = "";
      matches = [];
      index = 0;
      clearHighlight();
    },

    // 预览重渲染后文本节点全部失效，需要重新扫描；保持当前下标、不滚动
    refresh() {
      if (!query || previewEl.hidden) return;
      const keep = index;
      collect();
      matches = findMatchesInText(text, query);
      if (matches.length) show(Math.min(keep, matches.length - 1), false);
      else clearHighlight();
    },
  };
}

// ===================== 工具栏控制 =====================

export function setupFindReplace(view, bar, opts = {}) {
  const findInput = bar.querySelector("#find-input");
  const replaceInput = bar.querySelector("#replace-input");
  const replaceRow = bar.querySelector("#replace-row");
  const toggleBtn = bar.querySelector("#find-toggle");
  const countEl = bar.querySelector("#find-count");
  const hintEl = bar.querySelector("#find-hint");
  const prevBtn = bar.querySelector("#find-prev");
  const nextBtn = bar.querySelector("#find-next");
  const closeBtn = bar.querySelector("#find-close");
  const replaceOneBtn = bar.querySelector("#replace-one");
  const replaceAllBtn = bar.querySelector("#replace-all");

  const editorBackend = createEditorBackend(view);
  const previewBackend =
    opts.previewEl && opts.previewPane ? createPreviewBackend(opts.previewEl, opts.previewPane) : null;

  let backend = editorBackend;
  let flashTimer = 0;

  // 编辑框隐藏（预览视图）时切到预览后端，否则用编辑器后端
  function pickBackend() {
    if (previewBackend && opts.isPreviewActive && opts.isPreviewActive()) return previewBackend;
    return editorBackend;
  }

  // 切换后端时返回 changed，供调用方决定是否要把查询词带到另一侧重搜
  function syncBackend() {
    const next = pickBackend();
    if (next !== backend) {
      backend.clear();
      backend = next;
      return true;
    }
    return false;
  }

  // 切换「仅查找」/「查找+替换」两种形态：Ctrl+F 只出查找，Ctrl+H 才展开替换
  function setReplaceVisible(visible) {
    replaceRow.hidden = !visible;
    toggleBtn.setAttribute("aria-expanded", String(!!visible));
    toggleBtn.title = visible ? "收起替换框" : "展开替换框 (Ctrl+H)";
    toggleBtn.classList.toggle("expanded", !!visible);
  }

  function applyModeUi() {
    const can = backend.supportsReplace;
    toggleBtn.hidden = !can;
    if (!can) setReplaceVisible(false);
  }

  function updateUi() {
    const s = backend.state();
    clearTimeout(flashTimer);
    hintEl.hidden = true;

    if (s.unsupported) {
      countEl.textContent = "不支持";
      countEl.classList.add("none");
      countEl.title = "HTML 预览渲染在沙箱 iframe 中，无法查找文本";
      findInput.classList.remove("no-match");
    } else if (!s.query) {
      countEl.textContent = "";
      countEl.title = "";
      countEl.classList.remove("none");
      findInput.classList.remove("no-match");
    } else if (!s.total) {
      countEl.textContent = "无结果";
      countEl.title = "";
      countEl.classList.add("none");
      findInput.classList.add("no-match");
    } else {
      countEl.textContent = `${s.index + 1}/${s.total}`;
      countEl.title = "";
      countEl.classList.remove("none");
      findInput.classList.remove("no-match");
    }

    const disabled = s.unsupported || !s.query || s.total === 0;
    prevBtn.disabled = disabled;
    nextBtn.disabled = disabled;
    replaceOneBtn.disabled = disabled || !backend.supportsReplace;
    replaceAllBtn.disabled = disabled || !backend.supportsReplace;
  }

  onDocChanged = updateUi;

  function applyQuery(q, opts2 = {}) {
    backend.setQuery(q, opts2);
    updateUi();
  }

  function step(delta) {
    backend.step(delta);
    updateUi();
  }

  function replaceCurrent() {
    backend.replaceCurrent(replaceInput.value);
    updateUi();
  }

  function replaceAll() {
    const n = backend.replaceAll(replaceInput.value);
    updateUi();
    if (!n) return;
    // 短暂提示替换数量
    countEl.textContent = `已替换 ${n} 处`;
    countEl.classList.remove("none");
    flashTimer = setTimeout(() => {
      const s = backend.state();
      if (!s.query) countEl.textContent = "";
      else countEl.textContent = s.total ? `${s.index + 1}/${s.total}` : "无结果";
    }, 1600);
  }

  function open(focusTarget = "find") {
    syncBackend();
    applyModeUi();
    hintEl.hidden = true;
    // Chrome 风格：已有选中内容时自动填入查询框
    const picked = backend.selectedText();
    if (picked) findInput.value = picked;
    bar.hidden = false;
    setReplaceVisible(focusTarget === "replace" && backend.supportsReplace);
    if (findInput.value) applyQuery(findInput.value, { nearest: true });
    else updateUi();
    // 预览模式下给出说明，避免用户困惑为何没有替换框
    if (backend.kind === "preview") {
      hintEl.textContent = "当前在预览区查找（只读）";
      hintEl.hidden = false;
    }
    if (focusTarget === "replace" && backend.supportsReplace) {
      replaceInput.focus();
      replaceInput.select();
    } else {
      findInput.focus();
      findInput.select();
    }
  }

  function close() {
    backend.clear();
    bar.hidden = true;
    updateUi();
    if (backend.kind === "editor") view.focus();
  }

  // 面板已打开时按 Ctrl+H：就地展开替换框，不重填查询词、不重启搜索
  function expandReplace() {
    if (!backend.supportsReplace) return;
    setReplaceVisible(true);
    replaceInput.focus();
    replaceInput.select();
  }

  // 视图切换 / 预览重渲染后调用：重新选后端并重算匹配
  function refresh() {
    if (bar.hidden) return;
    const changed = syncBackend();
    applyModeUi();
    if (changed) {
      // 视图切换导致查找目标换了（编辑器 <-> 预览区）：沿用查询词在另一侧重搜
      backend.setQuery(findInput.value, { nearest: true });
    } else {
      backend.refresh();
    }
    updateUi();
    if (backend.kind === "preview") {
      hintEl.textContent = "当前在预览区查找（只读）";
      hintEl.hidden = false;
    } else {
      hintEl.hidden = true;
    }
  }

  // ---- 面板内交互 ----
  findInput.addEventListener("input", () => applyQuery(findInput.value, { nearest: true }));
  findInput.addEventListener("keydown", (e) => {
    if (e.key === "Enter") {
      e.preventDefault();
      step(e.shiftKey ? -1 : 1);
    } else if (e.key === "Escape") {
      e.preventDefault();
      e.stopPropagation();
      close();
    }
  });

  replaceInput.addEventListener("keydown", (e) => {
    if (e.key === "Enter") {
      e.preventDefault();
      replaceCurrent();
    } else if (e.key === "Escape") {
      e.preventDefault();
      e.stopPropagation();
      close();
    }
  });

  toggleBtn.addEventListener("click", () => {
    const show = replaceRow.hidden;
    setReplaceVisible(show);
    if (show) {
      replaceInput.focus();
      replaceInput.select();
    } else {
      findInput.focus();
    }
  });

  prevBtn.addEventListener("click", () => step(-1));
  nextBtn.addEventListener("click", () => step(1));
  closeBtn.addEventListener("click", close);
  replaceOneBtn.addEventListener("click", replaceCurrent);
  replaceAllBtn.addEventListener("click", replaceAll);

  setReplaceVisible(false);
  updateUi();

  return { open, close, step, expandReplace, refresh, isOpen: () => !bar.hidden };
}
