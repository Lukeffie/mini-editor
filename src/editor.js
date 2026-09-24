import { EditorView, basicSetup } from "codemirror";
import { EditorState } from "@codemirror/state";
import { markdown } from "@codemirror/lang-markdown";
import { undo, redo } from "@codemirror/commands";

export function createEditor(parent, { onChange, initialDoc = "", extraExtensions = [] }) {
  const view = new EditorView({
    parent,
    state: EditorState.create({
      doc: initialDoc,
      extensions: [
        basicSetup,
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
