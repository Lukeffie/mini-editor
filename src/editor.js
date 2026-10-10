import { EditorView, basicSetup } from "codemirror";
import { EditorState, Prec } from "@codemirror/state";
import { HighlightStyle, syntaxHighlighting } from "@codemirror/language";
import { tags } from "@lezer/highlight";
import { markdown } from "@codemirror/lang-markdown";
import { undo, redo } from "@codemirror/commands";

/* 编辑器的 Markdown 语法着色。
   CodeMirror 自带的 defaultHighlightStyle 是按浅色底调的：
   - ``` 这类围栏标记（CodeMark → processingInstruction）是 #404740 深灰
   - ``` 后的语言名（CodeInfo → labelName）是 #219 深蓝
   在深色主题下对比度只有 1.2~1.7:1，几乎看不见。
   这里改用一组随主题切换的 CSS 变量（--cm-*，见 style.css），
   并用 Prec.high 抬高优先级，盖过 basicSetup 里的默认高亮。 */
const mdHighlight = HighlightStyle.define([
  { tag: tags.heading, fontWeight: "bold", textDecoration: "underline" },
  { tag: tags.strong, fontWeight: "bold" },
  { tag: tags.emphasis, fontStyle: "italic" },
  { tag: tags.strikethrough, textDecoration: "line-through" },
  { tag: [tags.link, tags.url], color: "var(--cm-link)", textDecoration: "underline" },
  // 行内代码与 ``` 块正文：默认高亮里没有着色项（DOM 上根本没有 span，CSS 也改不动）
  { tag: tags.monospace, color: "var(--cm-code)", background: "color-mix(in srgb, var(--text) 8%, transparent)" },
  { tag: [tags.processingInstruction, tags.contentSeparator], color: "var(--cm-mark)" },
  { tag: tags.labelName, color: "var(--cm-label)" },
  { tag: tags.comment, color: "var(--cm-comment)", fontStyle: "italic" },
  { tag: tags.keyword, color: "var(--cm-keyword)" },
  { tag: tags.string, color: "var(--cm-string)" },
  { tag: [tags.number, tags.literal, tags.bool, tags.atom], color: "var(--cm-number)" },
  { tag: tags.invalid, color: "var(--danger)" },
]);

export function createEditor(parent, { onChange, initialDoc = "", extraExtensions = [] }) {
  const view = new EditorView({
    parent,
    state: EditorState.create({
      doc: initialDoc,
      extensions: [
        basicSetup,
        Prec.high(syntaxHighlighting(mdHighlight, { fallback: true })),
        markdown(),
        EditorView.lineWrapping,
        ...extraExtensions,
        EditorView.theme({
          "&": { height: "100%" },
          ".cm-scroller": { overflow: "auto" },
        }),
        EditorView.updateListener.of((u) => {
          // 每次文档变化都通知（含程序化 setContent）；"程序化加载不标记未保存"由 main.js 的 loadingGuard 控制
          if (u.docChanged) onChange(u.state.doc.toString());
        }),
      ],
    }),
  });

  return {
    view,
    getContent: () => view.state.doc.toString(),
    setContent: (text) => {
      view.dispatch({
        changes: { from: 0, to: view.state.doc.length, insert: text },
      });
    },
    undo: () => undo(view),
    redo: () => redo(view),
    refresh: () => view.requestMeasure(),
  };
}
