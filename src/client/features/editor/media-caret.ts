import { Fragment, type Node as EditorNode } from "prosemirror-model";
import { Plugin } from "prosemirror-state";
import { Debouncer } from "@tanstack/pacer";
import type { EditorView } from "prosemirror-view";
import { withCaretParagraphs } from "./editor-shape";
const media = (node: EditorNode | undefined | null) =>
  !!node?.isBlock && ["mediaSingle", "mediaGroup", "media"].includes(node.type.name);
/** Editor-only empty paragraphs give Chromium real caret positions beside block media, and one ends a document whose last
 * block is not text (a table, divider or code block), like Linear's trailing node. Empty, they are never saved. Placed by
 * the rule the loader's stand-in shares (editor-shape.ts), so the editor takes over at the stand-in's height (BJ-198). */
export function mediaCaretDocument(node: EditorNode): EditorNode {
  if (node.isLeaf) return node;
  const children: EditorNode[] = [];
  node.forEach((child) => children.push(mediaCaretDocument(child)));
  const content = Fragment.fromArray(
    withCaretParagraphs(children, {
      doc: node.type.name === "doc",
      type: (child) => child.type.name,
      textblock: (child) => child.isTextblock,
      caret: () => node.type.schema.nodes.paragraph!.create({ mediaBoundary: true }),
    }),
  );
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
      if (state.doc.lastChild && !state.doc.lastChild.isTextblock) gaps.add(state.doc.content.size);
      for (const pos of [...gaps].sort((a, b) => b - a))
        tr.insert(pos, state.schema.nodes.paragraph!.create({ mediaBoundary: true }));
      return tr.docChanged ? (gaps.size ? tr.setMeta("addToHistory", false) : tr) : null;
    },
  });
}
