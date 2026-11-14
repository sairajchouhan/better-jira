import { expect, test } from "bun:test";
import type { PropertyActivity } from "./issue-activity";
import { descriptionVersions, versionBucket, wordDiff } from "./description-versions";

// Made-up fixtures in the shape of Jira's description changelog items (whole wiki-markup text on both sides).
const ada = { id: "ada", name: "Ada Example" },
  lin = { id: "lin", name: "Lin Example" };
const edit = (id: string, at: string, before: string, after: string, actor = ada): PropertyActivity => ({
  id,
  field: "description",
  before,
  after,
  actor,
  at,
});

test("prod parity #8: description versions run newest first, each with the text it replaced, from the issue's original", () => {
  const versions = descriptionVersions(
    [
      edit("2", "2026-03-02T10:00:00Z", "h2. Steps\nOpen it", "h2. Steps\nOpen it twice", lin),
      edit("1", "2026-03-01T10:00:00Z", "Open it", "h2. Steps\nOpen it"),
      { id: "x", field: "status", before: null, after: null, actor: ada, at: "2026-03-01T11:00:00Z" },
    ],
    { at: "2026-02-28T09:00:00Z", actor: ada },
  );
  expect(versions.map((v) => [v.id, v.kind, v.text, v.previous, v.actor?.name])).toEqual([
    ["2", "history", "h2. Steps\nOpen it twice", "h2. Steps\nOpen it", "Lin Example"],
    ["1", "history", "h2. Steps\nOpen it", "Open it", "Ada Example"],
    ["creation", "creation", "Open it", undefined, "Ada Example"],
  ]);
  // An issue created without a description has no original version.
  expect(descriptionVersions([edit("1", "2026-03-01T10:00:00Z", "", "First")]).map((v) => v.id)).toEqual(["1"]);
});

test("prod parity #8: the word diff marks what an edit added and removed, keeping line breaks", () => {
  expect(wordDiff("Open the entry\nthen save", "Open the draft entry\nthen publish")).toEqual([
    { kind: "same", text: "Open the " },
    { kind: "added", text: "draft " },
    { kind: "same", text: "entry\nthen " },
    { kind: "removed", text: "save" },
    { kind: "added", text: "publish" },
  ]);
  expect(wordDiff("same", "same")).toEqual([{ kind: "same", text: "same" }]);
  expect(wordDiff("", "new text")).toEqual([{ kind: "added", text: "new text" }]);
  // Past the budget the middle reads as replaced, as Linear's diff gives up on a budget.
  const big = (word: string) => Array.from({ length: 2100 }, (_, i) => `${word}${i}`).join(" ");
  const parts = wordDiff(`a ${big("x")} z`, `a ${big("y")} z`);
  expect(parts.map((p) => p.kind)).toEqual(["same", "removed", "added", "same"]);
});

test("prod parity #8: versions bucket by day as Linear's list does (Today, Yesterday, N days/weeks/months/years ago)", () => {
  const now = new Date(2026, 10, 14, 12);
  const at = (y: number, m: number, d: number) => new Date(y, m, d, 9).toISOString();
  expect(versionBucket(at(2026, 10, 14), now)).toBe("Today");
  expect(versionBucket(at(2026, 10, 13), now)).toBe("Yesterday");
  expect(versionBucket(at(2026, 10, 10), now)).toBe("4 days ago");
  expect(versionBucket(at(2026, 10, 1), now)).toBe("1 week ago");
  expect(versionBucket(at(2026, 8, 20), now)).toBe("1 month ago");
  expect(versionBucket(at(2024, 10, 20), now)).toBe("1 year ago");
});

test("prod parity #35: a rewritten sentence reads as one deletion then one addition, not old and new words in turn", () => {
  // Made-up rewrite: no word of the old sentence survives, only the single spaces between words.
  const parts = wordDiff(
    "Intro\nNotes from the call are linked in thread 4821 on DEMO-7.\nOutro",
    "Intro\n*Clip* !Demo capture 2026-01-02 at 10.11.12.mov|width=300!\nOutro",
  );
  expect(parts).toEqual([
    { kind: "same", text: "Intro\n" },
    { kind: "removed", text: "Notes from the call are linked in thread 4821 on DEMO-7." },
    { kind: "added", text: "*Clip* !Demo capture 2026-01-02 at 10.11.12.mov|width=300!" },
    { kind: "same", text: "\nOutro" },
  ]);
  // A one-word edit far from the next stays its own change, with the unchanged words around it.
  expect(wordDiff("Open the entry, then save it to the stack", "Open the draft, then save it to the stack")).toEqual([
    { kind: "same", text: "Open the " },
    { kind: "removed", text: "entry" },
    { kind: "added", text: "draft" },
    { kind: "same", text: ", then save it to the stack" },
  ]);
});
