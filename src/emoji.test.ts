import { expect, test } from "bun:test";
import { EditorState, TextSelection } from "prosemirror-state";
import { activeEmoji, emojiRules, insertEmoji, loadEmoji, matchingEmoji } from "./emoji";
import { fromEditorDocument, richSchema } from "./rich-document";

await loadEmoji();

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
  expect(matchingEmoji("thu").map((e) => e.name).slice(0, 2)).toEqual(["+1", "thunder_cloud_and_rain"]);
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

test("BJ-180: Linear's full emoji set opens after one character and shows 12 results, common ones first", () => {
  expect(activeEmoji(typed("so :t"))!.query).toBe("t");
  expect(activeEmoji(typed("so :t "))).toBeNull();
  const t = matchingEmoji("t").map((e) => e.name);
  expect(t).toHaveLength(12);
  expect(t.slice(0, 3)).toEqual(["+1", "pray", "white_check_mark"]);
  expect(matchingEmoji("hourglass_flowing_sand")[0]!.name).toBe("hourglass_flowing_sand");
});

test("BJ-180: emoticons followed by a space become emoji, as Linear converts them", () => {
  const content = (text: string) => fromEditorDocument(typed(text).doc).content![0]!.content;
  expect(content("hi :) ")).toEqual([
    { type: "text", text: "hi " },
    { type: "emoji", attrs: { shortName: ":slightly_smiling_face:", id: "1f642", text: "🙂" } },
    { type: "text", text: " " },
  ]);
  expect(content("<3 ")![0]).toMatchObject({ type: "emoji", attrs: { shortName: ":heart:" } });
  expect(content("a:) ")).toEqual([{ type: "text", text: "a:) " }]);
});
