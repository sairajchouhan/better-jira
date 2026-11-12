import { expect, test } from "bun:test";
import { EditorState, TextSelection } from "prosemirror-state";
import { clickSelectionRange, linkSelected } from "./editor-links";
import { toEditorDocument } from "./rich-document";

const link = (href: string) => [{ type: "link", attrs: { href } }];
// "a " then "link" (positions 3–7, half of it bold) then " b" then "xy" (positions 9–11).
const doc = toEditorDocument({
  type: "doc",
  version: 1,
  content: [
    {
      type: "paragraph",
      content: [
        { type: "text", text: "a " },
        { type: "text", text: "li", marks: link("https://example.test/a") },
        { type: "text", text: "nk", marks: [{ type: "strong" }, ...link("https://example.test/a")] },
        { type: "text", text: " b" },
        { type: "text", text: "xy", marks: link("https://example.test/b") },
      ],
    },
  ],
});
const state = (from: number, to = from) =>
  EditorState.create({ doc, selection: TextSelection.create(doc, from, to) });

test("BJ-179: a click inside a link selects the whole link; at a longer link's edge it only places the caret", () => {
  expect(clickSelectionRange(state(1), 5)).toEqual({ from: 3, to: 7 });
  expect(clickSelectionRange(state(1), 4)).toEqual({ from: 3, to: 7 });
  expect(clickSelectionRange(state(1), 3)).toBeNull();
  expect(clickSelectionRange(state(1), 7)).toBeNull();
  expect(clickSelectionRange(state(1), 2)).toBeNull();
  // A link of two characters is selected from either edge.
  expect(clickSelectionRange(state(1), 11)).toEqual({ from: 9, to: 11 });
});

test("BJ-179: the link editor replaces the toolbar only when the selection is all link", () => {
  expect(linkSelected(state(3, 7))).toBe(true);
  expect(linkSelected(state(4, 6))).toBe(true);
  expect(linkSelected(state(2, 7))).toBe(false);
  expect(linkSelected(state(5))).toBe(false);
});
