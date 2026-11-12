import { expect, test } from "bun:test";
import { EditorState, TextSelection } from "prosemirror-state";
import { activeEmoji, emojiRules, insertEmoji, matchingEmoji } from "./emoji";
import { fromEditorDocument, richSchema } from "./rich-document";

const typed = (text: string) => {
  const doc = richSchema.nodes.doc!.create(null, richSchema.nodes.paragraph!.create());
  const view: any = {
    state: EditorState.create({ doc, selection: TextSelection.create(doc, 1), plugins: [emojiRules] }),
    composing: false,
    dispatch(tr: any) {
      view.state = view.state.apply(tr);
    },
  };
  const handle = emojiRules.props.handleTextInput!;
  for (const char of text) {
    const { from, to } = view.state.selection;
    if (!handle.call(emojiRules, view, from, to, char, () => view.state.tr))
      view.dispatch(view.state.tr.insertText(char, from, to));
  }
  return view.state as EditorState;
};

test("BJ-57: :shortcode opens the emoji picker and inserts Jira's emoji node", () => {
  expect(matchingEmoji("thu").map((e) => e.name)).toEqual(["thumbsup", "thumbsdown"]);
  expect(matchingEmoji("heart")[0]!.name).toBe("heart");
  const open = typed("nice :tad");
  const at = activeEmoji(open)!;
  expect(at.query).toBe("tad");
  expect(activeEmoji(typed("at 12:30"))).toBeNull();
  expect(activeEmoji(typed("Note: x"))).toBeNull();
  const after = open.apply(insertEmoji(open, at, matchingEmoji("tad")[0]!));
  expect(fromEditorDocument(after.doc).content![0]!.content).toEqual([
    { type: "text", text: "nice " },
    { type: "emoji", attrs: { shortName: ":tada:", id: "1f389", text: "🎉" } },
  ]);
});

test("BJ-57: a typed-out :name: becomes its emoji; an unknown one stays text", () => {
  const doc = fromEditorDocument(typed("ok :fire: done :nope:").doc);
  expect(doc.content![0]!.content).toEqual([
    { type: "text", text: "ok " },
    { type: "emoji", attrs: { shortName: ":fire:", id: "1f525", text: "🔥" } },
    { type: "text", text: " done :nope:" },
  ]);
});
