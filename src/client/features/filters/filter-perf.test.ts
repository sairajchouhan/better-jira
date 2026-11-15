import { type Board, type Issue } from "@/shared/issue-model";
import { expect, test } from "bun:test";
import { defaultPreferences, type Preferences } from "@/shared/view-model";
import { filterChoices, settingsKey, ValueRow, withoutRule } from "./property-filter";

const MEMO = Symbol.for("react.memo");
const board: Board = { id: 1, name: "Board", columns: [] };

test("a field's issues keep their cache key while its own rule's values change, and change with any other rule", () => {
  const base = defaultPreferences();
  const withRules = (labels: string[], status: string[]): Preferences => ({
    ...base,
    filters: {
      ...base.filters,
      children: [
        { id: "own", field: "labels", op: "is", values: labels },
        { id: "other", field: "status", op: "is", values: status },
      ],
    },
  });
  const key = (prefs: Preferences) => settingsKey(withoutRule(prefs, "own"));
  expect(key(withRules(["a"], ["todo"]))).toBe(key(withRules(["a", "b"], ["todo"])));
  expect(key(withRules(["a"], ["todo"]))).not.toBe(key(withRules(["a"], ["done"])));
  // A rule not in the view yet (a new pick) leaves the settings themselves.
  const prefs = withRules(["a"], ["todo"]);
  expect(withoutRule(prefs, "new")).toBe(prefs);
});

test("filterChoices counts every label in one pass over the issues", () => {
  let reads = 0;
  const issues = Array.from({ length: 200 }, (_, k): Issue => {
    const labels = [`label-${k}`];
    return Object.defineProperty(
      { key: `A-${k}`, boards: [1], summary: "", status: "todo", assignee: null, comments: 0, updated: "", resolved: null } as unknown as Issue,
      "labels",
      { get: () => (reads++, labels), enumerable: true },
    );
  });
  const labels = issues.map((_, k) => `label-${k}`);
  const choices = filterChoices("labels", board, issues, issues, { labels });
  expect(choices.find((c) => c.value === "label-7")?.count).toBe(1);
  // Listing the values reads each issue once and counting them once more: never once per value (200 × 200).
  expect(reads).toBeLessThanOrEqual(issues.length * 3);
});

test("a value row is memoised, so toggling one value re-renders that row alone", () => {
  expect((ValueRow as unknown as { $$typeof: symbol }).$$typeof).toBe(MEMO);
});
