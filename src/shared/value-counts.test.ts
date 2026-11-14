import { type Issue } from "@/shared/issue-model";
import { expect, test } from "bun:test";
import { matchesRule, parentKeys, parentName, valueCounts, valuesFor, type Field } from "./view-model";

const issue = (key: string, patch: Partial<Issue> = {}): Issue => ({
  key,
  board: 1,
  summary: `Summary of ${key}`,
  status: "todo",
  assignee: null,
  labels: [],
  comments: 0,
  updated: "2026-11-06T10:00:00Z",
  resolved: null,
  ...patch,
});
const person = (id: string) => ({ id, name: id.toUpperCase() });
const issues = [
  issue("A-1", { assignee: person("me"), labels: ["bug", "ui", "bug"], priority: "High", watchers: [person("me")], watchersComplete: true }),
  issue("A-2", { assignee: person("pat"), labels: ["ui"], parent: "A-1", watchers: [person("pat")], watchersComplete: false }),
  issue("A-3", { labels: [], parent: "A-1", relations: [{ kind: "blocks", key: "A-1" }] as Issue["relations"], watchersComplete: true }),
  issue("A-4", { assignee: person("me"), priority: "Low", watchers: [], watchersComplete: true }),
];
const byRule = (field: Field, value: string) =>
  issues.filter((i) => matchesRule(i, { id: "x", field, op: "is", values: [value] }, issues, "me")).length;

test("valueCounts gives every value the count matchesRule gives it, $none, $me and partly loaded watchers included", () => {
  const cases: [Field, string[]][] = [
    ["assignee", ["$none", "$me", "me", "pat", "nobody"]],
    ["labels", ["$none", "bug", "ui", "missing"]],
    ["priority", ["$none", "High", "Low"]],
    ["watchers", ["$none", "$me", "me", "pat"]],
    ["relations", ["parent", "child", "related", "blocks"]],
    ["parent", ["$none", "A-1"]],
  ];
  for (const [field, values] of cases) {
    const count = valueCounts(issues, field, issues, "me");
    for (const value of values) expect([field, value, count(value)]).toEqual([field, value, byRule(field, value)]);
  }
});

/** Issues whose `labels` and `parent` reads are counted, to tell one pass from one pass per value. */
function counted(n: number) {
  const reads = { labels: 0, parent: 0 };
  const list = Array.from({ length: n }, (_, k) => {
    const base = issue(`B-${k}`, { labels: [`label-${k}`], parent: k ? `B-${k - 1}` : undefined });
    return Object.defineProperties(base, {
      labels: { get: () => (reads.labels++, [`label-${k}`]) },
      parent: { get: () => (reads.parent++, k ? `B-${k - 1}` : undefined) },
    });
  });
  return { list, reads };
}

test("valueCounts reads each issue once for all its values, not once per value (1,000 labels × 1,000 issues was a million checks)", () => {
  const { list, reads } = counted(300);
  const count = valueCounts(list, "labels", list, "me");
  for (let k = 0; k < 300; k++) expect(count(`label-${k}`)).toBe(1);
  expect(reads.labels).toBeLessThanOrEqual(300);
});

test("Relations' parent check looks sub-issues up in an index built once per list, not a scan of every issue per issue", () => {
  const { list, reads } = counted(300);
  for (const i of list) valuesFor(i, "relations", list);
  // Building the index reads each issue's parent once; each issue's own parentOf reads its own a few times more.
  expect(reads.parent).toBeLessThan(300 * 6);
  expect(parentKeys(list)).toBe(parentKeys(list));
  expect(parentKeys(list).has("B-0")).toBe(true);
});

test("parentName names a parent by key from a lookup or a list", () => {
  expect(parentName("A-1", issues)).toBe("A-1 Summary of A-1");
  expect(parentName("A-1", (key) => issues.find((i) => i.key === key))).toBe("A-1 Summary of A-1");
  expect(parentName("Z-9", issues)).toBe("Z-9");
});
