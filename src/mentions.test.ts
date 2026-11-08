import { expect, test } from "bun:test";
import { EditorState, TextSelection } from "prosemirror-state";
import {
  activeMention,
  dismissMention,
  insertMention,
  mentionPlugin,
  mentionTrigger,
} from "./mentions";
import { fromEditorDocument, richSchema, toEditorDocument } from "./rich-document";

const typed = (text: string, block = "paragraph") => {
  const doc = richSchema.nodes.doc!.create(null, [
    richSchema.nodes[block]!.create(null, text ? richSchema.text(text) : undefined),
  ]);
  return EditorState.create({
    doc,
    plugins: [mentionPlugin(() => false)],
    selection: TextSelection.create(doc, 1 + text.length),
  });
};
const query = (text: string, block?: string) => mentionTrigger(typed(text, block))?.query ?? null;

test("@ at a word start opens the picker with the name typed so far", () => {
  expect(query("@")).toBe("");
  expect(query("hi @sai")).toBe("sai");
  expect(query("hi @Sairaj Ch")).toBe("Sairaj Ch");
  expect(query("(@al")).toBe("al");
  expect(mentionTrigger(typed("hi @sai"))).toEqual({ from: 4, to: 8, query: "sai" });
});

test("emails, double spaces, long text and code are not mentions", () => {
  expect(query("me@example.com")).toBeNull();
  expect(query("@sai  done")).toBeNull();
  expect(query(`@${"a".repeat(31)}`)).toBeNull();
  expect(query("@sai", "codeBlock")).toBeNull();
});

test("Esc keeps this @ dismissed while typing on; a new @ opens again", () => {
  let state = typed("hi @sa");
  state = state.apply(dismissMention(state));
  expect(activeMention(state)).toBeNull();
  state = state.apply(state.tr.insertText("i"));
  expect(activeMention(state)).toBeNull();
  state = state.apply(state.tr.insertText(" @a"));
  expect(activeMention(state)?.query).toBe("a");
});

test("picking a person writes Jira's mention node, which round-trips unchanged", () => {
  const state = typed("Ping @pri"),
    next = state.apply(
      insertMention(state, mentionTrigger(state)!, { id: "acc-1", name: "Priya" }),
    );
  const adf = fromEditorDocument(next.doc);
  expect(adf.content).toEqual([
    {
      type: "paragraph",
      content: [
        { type: "text", text: "Ping " },
        { type: "mention", attrs: { id: "acc-1", text: "@Priya", accessLevel: "" } },
        { type: "text", text: " " },
      ],
    },
  ]);
  expect(next.selection.from).toBe(next.doc.content.size - 1);
  expect(fromEditorDocument(toEditorDocument(adf))).toEqual(adf);
});
