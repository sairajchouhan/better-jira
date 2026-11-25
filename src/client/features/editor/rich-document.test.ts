import { expect, test } from "bun:test";
import { fromEditorDocument, toEditorDocument } from "./rich-document";

const line = (text: string) => ({ type: "paragraph", content: [{ type: "text", text }] });
const image = {
  type: "mediaSingle",
  attrs: { layout: "align-start", width: 320, widthType: "pixel" },
  content: [{ type: "media", attrs: { type: "file", id: "image-1", collection: "", alt: "shot.png", width: 320, height: 480 } }],
};
const code = { type: "codeBlock", attrs: { language: "ts" }, content: [{ type: "text", text: "run()" }] };

test("a list item that starts with an image or code shows as a list and saves back as Jira holds it", () => {
  const doc = {
    type: "doc" as const,
    version: 1 as const,
    content: [
      {
        type: "orderedList",
        attrs: { order: 1 },
        content: [
          { type: "listItem", content: [line("Open the entry")] },
          { type: "listItem", content: [image, line("Assign the role")] },
          { type: "listItem", content: [code, line("Save it")] },
        ],
      },
    ],
  };
  const editor = toEditorDocument(doc);

  expect(editor.firstChild?.type.name).toBe("orderedList");
  expect(editor.firstChild?.childCount).toBe(3);
  expect(fromEditorDocument(editor)).toEqual(doc);
});
