import { expect, test } from "bun:test";
import { EditorState } from "prosemirror-state";
import {
  fromEditorDocument,
  richSchema,
  toEditorDocument,
  type AdfDocument,
} from "./rich-document";

export const richFixture: AdfDocument = {
  type: "doc",
  version: 1,
  content: [
    {
      type: "heading",
      attrs: { level: 2, localId: "heading-id" },
      content: [{ type: "text", text: "A formatted document" }],
    },
    {
      type: "paragraph",
      attrs: { localId: "paragraph-id" },
      content: [
        {
          type: "text",
          text: "Formatted text",
          marks: [
            { type: "link", attrs: { href: "https://example.com", title: "Example" } },
            { type: "strong" },
            { type: "em" },
            { type: "textColor", attrs: { color: "#ff0000" } },
            { type: "unfamiliarMark", attrs: { value: 42 } },
          ],
        },
        { type: "hardBreak" },
        { type: "mention", attrs: { id: "user-id", text: "A person", accessLevel: "CONTAINER" } },
      ],
    },
    {
      type: "bulletList",
      content: [
        {
          type: "listItem",
          content: [{ type: "paragraph", content: [{ type: "text", text: "A list item" }] }],
        },
      ],
    },
    {
      type: "orderedList",
      attrs: { order: 3 },
      content: [
        {
          type: "listItem",
          content: [{ type: "paragraph", content: [{ type: "text", text: "A numbered item" }] }],
        },
      ],
    },
    {
      type: "codeBlock",
      attrs: { language: "typescript" },
      content: [{ type: "text", text: "const value = 1;\nconsole.log(value);" }],
    },
    {
      type: "table",
      attrs: { isNumberColumnEnabled: true, layout: "wide", localId: "table-id" },
      content: [
        {
          type: "tableRow",
          content: [
            {
              type: "tableHeader",
              attrs: { colspan: 1, rowspan: 1, colwidth: [180], background: "#eeeeee" },
              content: [{ type: "paragraph", content: [{ type: "text", text: "Header" }] }],
            },
            {
              type: "tableCell",
              content: [{ type: "paragraph", content: [{ type: "text", text: "Cell" }] }],
            },
          ],
        },
      ],
    },
    {
      type: "taskList",
      attrs: { localId: "tasks" },
      content: [
        {
          type: "taskItem",
          attrs: { localId: "task-id", state: "DONE" },
          content: [{ type: "text", text: "Keep this task" }],
        },
      ],
    },
    {
      type: "mediaSingle",
      attrs: { layout: "center" },
      content: [
        { type: "media", attrs: { id: "attachment-id", type: "file", collection: "private" } },
      ],
    },
    {
      type: "extension",
      attrs: { extensionType: "unknown-app", parameters: { nested: { keep: true } } },
    },
  ],
};

test("rich Jira documents round-trip without flattening marks, tables, IDs, or unknown content", () => {
  const editor = toEditorDocument(richFixture);
  editor.check();
  expect(fromEditorDocument(editor)).toEqual(richFixture);
});
test("editing formatted text preserves unrelated rich branches and opaque content", () => {
  const state = EditorState.create({ schema: richSchema, doc: toEditorDocument(richFixture) });
  let position = 0;
  state.doc.descendants((node, pos) => {
    if (node.isText && node.text === "Formatted text") position = pos;
  });
  const next = state.apply(state.tr.insertText(" updated", position + 9));
  const result = fromEditorDocument(next.doc);
  expect(result.content?.slice(2)).toEqual(richFixture.content?.slice(2));
  expect(result.content?.[1]?.attrs).toEqual({ localId: "paragraph-id" });
  expect(JSON.stringify(result)).toContain("Formatted updated text");
  expect(result.content?.[1]?.content?.[0]?.marks).toEqual(
    richFixture.content?.[1]?.content?.[0]?.marks,
  );
});
test("legacy plain descriptions and empty descriptions remain editable", () => {
  expect(fromEditorDocument(toEditorDocument("First\nline\n\nSecond")).content).toHaveLength(2);
  expect(fromEditorDocument(toEditorDocument(null))).toEqual({
    type: "doc",
    version: 1,
    content: [],
  });
});

const nestedMedia: AdfDocument = {
  type: "doc",
  version: 1,
  content: [
    { type: "paragraph", content: [{ type: "text", text: "Prelude" }] },
    {
      type: "mediaSingle",
      attrs: { layout: "wrap-left", width: 30, widthType: "percentage", localId: "single-local" },
      content: [
        {
          type: "media",
          attrs: {
            id: "video-uuid",
            type: "file",
            collection: "private",
            width: 1680,
            height: 560,
            localId: "file-local",
          },
        },
        {
          type: "caption",
          content: [{ type: "text", text: "Caption", marks: [{ type: "strong" }] }],
        },
      ],
    },
    {
      type: "paragraph",
      content: [
        { type: "text", text: "Before " },
        {
          type: "mediaInline",
          attrs: { id: "inline-uuid", type: "file", collection: "", localId: "inline-local" },
        },
        { type: "text", text: " after" },
      ],
    },
    {
      type: "mediaSingle",
      attrs: { layout: "align-end", width: 180, widthType: "pixel" },
      content: [
        {
          type: "media",
          attrs: {
            type: "external",
            url: "https://images.example.invalid/image.png",
            width: 320,
            height: 480,
            alt: "External portrait",
          },
        },
      ],
    },
    {
      type: "mediaGroup",
      attrs: { localId: "group-local" },
      content: [
        { type: "media", attrs: { id: "first-uuid", type: "file", collection: "" } },
        { type: "media", attrs: { id: "second-uuid", type: "file", collection: "" } },
      ],
    },
    {
      type: "table",
      content: [
        {
          type: "tableRow",
          content: [
            {
              type: "tableCell",
              content: [
                { type: "paragraph", content: [{ type: "text", text: "Cell" }] },
                {
                  type: "mediaSingle",
                  attrs: { layout: "center" },
                  content: [
                    { type: "media", attrs: { id: "cell-uuid", type: "file", collection: "" } },
                  ],
                },
              ],
            },
          ],
        },
      ],
    },
    {
      type: "bulletList",
      content: [
        {
          type: "listItem",
          content: [
            { type: "paragraph", content: [{ type: "text", text: "List" }] },
            {
              type: "mediaGroup",
              content: [
                { type: "media", attrs: { id: "list-uuid", type: "file", collection: "" } },
              ],
            },
          ],
        },
      ],
    },
  ],
};

test("all media shapes and nested locations remain byte-identical after unrelated editing", () => {
  const editor = toEditorDocument(nestedMedia);
  editor.check();
  expect(JSON.stringify(fromEditorDocument(editor))).toBe(JSON.stringify(nestedMedia));
  const state = EditorState.create({ schema: richSchema, doc: editor });
  const next = state.apply(state.tr.insertText("Updated ", 1));
  expect(JSON.stringify(fromEditorDocument(next.doc).content?.slice(1))).toBe(
    JSON.stringify(nestedMedia.content?.slice(1)),
  );
});

test("Backspace removes a selected media atom and undo restores exact ADF", async () => {
  const { NodeSelection } = await import("prosemirror-state");
  const { baseKeymap } = await import("prosemirror-commands");
  const { history, undo } = await import("prosemirror-history");
  let state = EditorState.create({
    schema: richSchema,
    doc: toEditorDocument(nestedMedia),
    plugins: [history()],
  });
  let position = 0;
  state.doc.forEach((node, pos) => {
    if (node.type.name === "mediaSingle" && node.attrs.raw.attrs.localId === "single-local")
      position = pos;
  });
  state = state.apply(state.tr.setSelection(NodeSelection.create(state.doc, position)));
  expect(
    baseKeymap.Backspace!(state, (tr) => {
      state = state.apply(tr);
    }),
  ).toBe(true);
  expect(JSON.stringify(fromEditorDocument(state.doc))).not.toContain("single-local");
  expect(
    undo(state, (tr) => {
      state = state.apply(tr);
    }),
  ).toBe(true);
  expect(JSON.stringify(fromEditorDocument(state.doc))).toBe(JSON.stringify(nestedMedia));
});
