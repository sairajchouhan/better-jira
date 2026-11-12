import { expect, test } from "bun:test";
import { EditorState, TextSelection } from "prosemirror-state";
import { activeSlash, matchingSlashCommands } from "./slash-commands";
import { fromEditorDocument, richSchema } from "./rich-document";

const at = (text: string) => {
  const doc = richSchema.nodes.doc!.create(null, richSchema.nodes.paragraph!.create(null, richSchema.text(text)));
  return EditorState.create({ doc, selection: TextSelection.atEnd(doc) });
};

test("BJ-42: / opens the slash menu at a word start, filtered by name or keyword", () => {
  expect(activeSlash(at("/"))?.query).toBe("");
  expect(activeSlash(at("then /head"))?.query).toBe("head");
  expect(activeSlash(at("a/b"))).toBeNull();
  expect(activeSlash(at("see https://x.test/"))).toBeNull();
  expect(matchingSlashCommands("").length).toBeGreaterThan(10);
  expect(matchingSlashCommands("h2").map((c) => c.id)).toEqual(["heading-2"]);
  expect(matchingSlashCommands("heading 3").map((c) => c.id)).toEqual(["heading-3"]);
  expect(matchingSlashCommands("hr").map((c) => c.id)).toEqual(["divider"]);
  expect(matchingSlashCommands("coll").map((c) => c.id)).toEqual(["expand"]);
  expect(matchingSlashCommands("zzz")).toEqual([]);
});

test("BJ-42: a picked block command applies to the line the / was typed on", () => {
  const state = at("/div");
  const trigger = activeSlash(state)!;
  const cleared = state.apply(state.tr.delete(trigger.from, trigger.to));
  let after = cleared;
  matchingSlashCommands("div")[0]!.command!(cleared, (tr) => (after = cleared.apply(tr)));
  expect(fromEditorDocument(after.doc).content!.map((n) => n.type)).toEqual(["rule", "paragraph"]);
});
