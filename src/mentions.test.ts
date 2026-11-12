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

test("BJ-43: @ lists matching issues and inserts Jira's smart link to one; a typed issue key becomes one", async () => {
  const { matchingIssues } = await import("./mention-menu");
  const { insertIssueReference, issueReferenceRules } = await import("./mentions");
  const issues = [
    { key: "KAN-1", summary: "Login page" },
    { key: "KAN-12", summary: "Fix logout" },
    { key: "OPS-3", summary: "Rotate keys" },
  ] as any[];
  expect(matchingIssues(issues, "").map((i) => i.key)).toEqual([]);
  expect(matchingIssues(issues, "kan-1").map((i) => i.key)).toEqual(["KAN-1", "KAN-12"]);
  expect(matchingIssues(issues, "log").map((i) => i.key)).toEqual(["KAN-1", "KAN-12"]);

  const at = typed("see @kan");
  const card = at.apply(insertIssueReference(at, mentionTrigger(at)!, "https://x.test/browse/KAN-12"));
  expect(fromEditorDocument(card.doc).content![0]!.content).toEqual([
    { type: "text", text: "see " },
    { type: "inlineCard", attrs: { url: "https://x.test/browse/KAN-12" } },
    { type: "text", text: " " },
  ]);

  const rules = issueReferenceRules((key) => (key === "KAN-12" ? `https://x.test/browse/${key}` : null));
  const typeIn = (text: string) => {
    const doc = richSchema.nodes.doc!.create(null, richSchema.nodes.paragraph!.create());
    const view: any = {
      state: EditorState.create({ doc, selection: TextSelection.create(doc, 1) }),
      composing: false,
      dispatch(tr: any) {
        view.state = view.state.apply(tr);
      },
    };
    for (const char of text) {
      const { from, to } = view.state.selection;
      if (!rules.props.handleTextInput!.call(rules, view, from, to, char, () => view.state.tr))
        view.dispatch(view.state.tr.insertText(char, from, to));
    }
    return fromEditorDocument(view.state.doc).content![0]!.content;
  };
  expect(typeIn("fixed in KAN-12 today")).toEqual([
    { type: "text", text: "fixed in " },
    { type: "inlineCard", attrs: { url: "https://x.test/browse/KAN-12" } },
    { type: "text", text: " today" },
  ]);
  expect(typeIn("see KAN-99 ")).toEqual([{ type: "text", text: "see KAN-99 " }]);
});
