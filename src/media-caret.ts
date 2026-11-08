import { Fragment, type Node as EditorNode } from "prosemirror-model";
import { Plugin } from "prosemirror-state";
import { Debouncer } from "@tanstack/pacer";
import type { EditorView } from "prosemirror-view";
const media = (node: EditorNode | undefined | null) =>
  !!node?.isBlock && ["mediaSingle", "mediaGroup", "media"].includes(node.type.name);
/** Editor-only empty paragraphs give Chromium real caret positions beside block media. */
export function mediaCaretDocument(node: EditorNode): EditorNode {
  if (node.isLeaf) return node;
  const children: EditorNode[] = [];
  node.forEach((child) => children.push(mediaCaretDocument(child)));
  const out: EditorNode[] = [];
  for (let i = 0; i < children.length; i++) {
    const child = children[i]!;
    if (media(child) && !out.at(-1)?.isTextblock)
      out.push(node.type.schema.nodes.paragraph!.create({ mediaBoundary: true }));
    out.push(child);
    if (media(child) && !children[i + 1]?.isTextblock && !media(children[i + 1]))
      out.push(node.type.schema.nodes.paragraph!.create({ mediaBoundary: true }));
  }
  const content = Fragment.fromArray(out);
  return node.type.validContent(content) ? node.copy(content) : node;
}
export function mediaCaretPlugin() {
  let editor: EditorView | undefined;
  const compositionEnd = new Debouncer(
    (view: EditorView) => {
      if (!view.isDestroyed && !view.composing)
        view.dispatch(view.state.tr.setMeta("mediaCompositionEnd", true));
    },
    { wait: 0 },
  );
  return new Plugin({
    view(view) {
      editor = view;
      return {
        destroy() {
          compositionEnd.cancel();
          editor = undefined;
        },
      };
    },
    props: {
      handleDOMEvents: {
        compositionend(view) {
          // Run after ProseMirror has flushed the final composition mutation. Replacing a
          // paragraph during pre-edit detaches the IME's live text node in Chromium.
          compositionEnd.maybeExecute(view);
          return false;
        },
      },
    },
    appendTransaction(_transactions, _old, state) {
      let tr = state.tr;
      const gaps = new Set<number>();
      const inspect = (node: EditorNode, pos: number) => {
        if (
          !editor?.composing &&
          node.type.name === "paragraph" &&
          node.attrs.mediaBoundary &&
          node.content.size
        )
          tr.setNodeMarkup(pos, undefined, { ...node.attrs, mediaBoundary: false });
        if (node.isLeaf) return;
        node.forEach((child, offset, index) => {
          const at = pos + 1 + offset;
          if (media(child)) {
            const paragraph = state.schema.nodes.paragraph!.create({ mediaBoundary: true });
            if (
              !node.maybeChild(index - 1)?.isTextblock &&
              node.canReplace(index, index, Fragment.from(paragraph))
            )
              gaps.add(at);
            if (
              !node.maybeChild(index + 1)?.isTextblock &&
              node.canReplace(index + 1, index + 1, Fragment.from(paragraph))
            )
              gaps.add(at + child.nodeSize);
          }
        });
      };
      inspect(state.doc, -1);
      state.doc.descendants(inspect);
      for (const pos of [...gaps].sort((a, b) => b - a))
        tr.insert(pos, state.schema.nodes.paragraph!.create({ mediaBoundary: true }));
      return tr.docChanged ? (gaps.size ? tr.setMeta("addToHistory", false) : tr) : null;
    },
  });
}
