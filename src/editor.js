import { EditorView, basicSetup } from "codemirror";
import { EditorState } from "@codemirror/state";
import { markdown } from "@codemirror/lang-markdown";
import { undo, redo } from "@codemirror/commands";

let suppress = false;

export function createEditor(parent, { onChange, initialDoc = "" }) {
  const view = new EditorView({
    parent,
    state: EditorState.create({
      doc: initialDoc,
      extensions: [
        basicSetup,
        markdown(),
        EditorView.lineWrapping,
        EditorView.theme({
          "&": { height: "100%" },
          ".cm-scroller": { overflow: "auto" },
        }),
        EditorView.updateListener.of((u) => {
          if (u.docChanged && !suppress) onChange(u.state.doc.toString());
        }),
      ],
    }),
  });

  return {
    view,
    getContent: () => view.state.doc.toString(),
    setContent: (text) => {
      suppress = true;
      view.dispatch({
        changes: { from: 0, to: view.state.doc.length, insert: text },
      });
      suppress = false;
    },
    undo: () => undo(view),
    redo: () => redo(view),
    refresh: () => view.requestMeasure(),
  };
}
