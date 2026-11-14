import { expect, test } from "bun:test";
import { alreadyLinked, inverseKind, linkRelation, relationName, relationSections } from "./relations";

/** Jira's link types as a work site lists them (`/rest/api/3/issueLinkType`), names and phrases only. */
const types = {
  blocks: { name: "Blocks", inward: "is blocked by", outward: "blocks" },
  cloners: { name: "Cloners", inward: "is cloned by", outward: "clones" },
  duplicate: { name: "Duplicate", inward: "is duplicated by", outward: "duplicates" },
  relates: { name: "Relates", inward: "relates to", outward: "relates to" },
  incident: { name: "Problem/Incident", inward: "is caused by", outward: "causes" },
  implements: { name: "Polaris work item link", inward: "is implemented by", outward: "implements" },
  split: { name: "Work item split", inward: "split from", outward: "split to" },
};
const other = (key: string) => ({
  key,
  fields: {
    summary: `Made-up ${key}`,
    status: { id: "10001", name: "To Do", statusCategory: { key: "new" } },
    priority: { name: "Normal" },
    issuetype: { name: "Task" },
  },
});
const side = (type: object, end: "outwardIssue" | "inwardIssue", key = "ZZ-1") =>
  linkRelation({ id: "1", type, [end]: other(key) });

test("BJ-15: Blocks, Duplicate and Relates map to Linear's kinds from either end", () => {
  expect([
    side(types.blocks, "outwardIssue")?.kind,
    side(types.blocks, "inwardIssue")?.kind,
    side(types.duplicate, "outwardIssue")?.kind,
    side(types.duplicate, "inwardIssue")?.kind,
    side(types.relates, "outwardIssue")?.kind,
    side(types.relates, "inwardIssue")?.kind,
  ]).toEqual(["blocking", "blocked", "duplicate", "duplicated", "related", "related"]);
  // Linear's kinds carry no Jira phrase.
  expect(side(types.blocks, "inwardIssue")?.label).toBeUndefined();
});

test("BJ-15: any other Jira link type keeps its own phrase for this end, never folded into Related", () => {
  const rows = [
    [types.cloners, "outwardIssue", "outward:Cloners", "clones", "Clones"],
    [types.cloners, "inwardIssue", "inward:Cloners", "is cloned by", "Is cloned by"],
    [types.incident, "outwardIssue", "outward:Problem/Incident", "causes", "Causes"],
    [types.incident, "inwardIssue", "inward:Problem/Incident", "is caused by", "Is caused by"],
    [types.implements, "outwardIssue", "outward:Polaris work item link", "implements", "Implements"],
    [types.implements, "inwardIssue", "inward:Polaris work item link", "is implemented by", "Is implemented by"],
    [types.split, "inwardIssue", "inward:Work item split", "split from", "Split from"],
  ] as const;
  for (const [type, end, kind, label, heading] of rows) {
    const relation = side(type, end)!;
    expect([relation.kind, relation.label, relationName(relation)]).toEqual([kind, label, heading]);
  }
  // A custom type without phrases is named by its type name.
  expect(relationName(side({ name: "Depends" }, "outwardIssue")!)).toBe("Depends");
});

test("BJ-15: the linked issue's title and status come from the link itself; a hidden issue is dropped", () => {
  expect(side(types.relates, "outwardIssue", "OTHER-4")).toEqual({
    key: "OTHER-4",
    kind: "related",
    issue: { summary: "Made-up OTHER-4", status: { name: "To Do", category: "new" } },
  });
  // Jira omits `fields` for a bare key: the relation stays, without a snapshot.
  expect(linkRelation({ type: types.blocks, inwardIssue: { key: "OTHER-5" } })).toEqual({
    key: "OTHER-5",
    kind: "blocked",
  });
  expect(linkRelation({ type: types.relates })).toBeNull();
  // A link with no type name still shows, as Related.
  expect(linkRelation({ outwardIssue: { key: "OTHER-6" } })?.kind).toBe("related");
});

test("BJ-15: each kind's inverse is the other end of the same Jira link", () => {
  expect(["blocked", "blocking", "duplicate", "duplicated", "related"].map(inverseKind)).toEqual([
    "blocking",
    "blocked",
    "duplicated",
    "duplicate",
    "related",
  ]);
  expect(inverseKind("inward:Problem/Incident")).toBe("outward:Problem/Incident");
  expect(inverseKind("outward:Problem/Incident")).toBe("inward:Problem/Incident");
});

test("BJ-15: sections follow Linear's order, then each Jira kind under its phrase in Jira's order", () => {
  const sections = relationSections([
    { key: "A-1", kind: "related" },
    { key: "A-2", kind: "inward:Problem/Incident", label: "is caused by" },
    { key: "A-3", kind: "duplicated" },
    { key: "A-4", kind: "blocked" },
    { key: "A-5", kind: "outward:Cloners", label: "clones" },
    { key: "A-6", kind: "duplicate" },
    { key: "A-7", kind: "inward:Problem/Incident", label: "is caused by" },
    { key: "A-8", kind: "blocking" },
  ]);
  expect(sections.map((s) => [s.heading, s.rows.map((r) => r.key)])).toEqual([
    ["Duplicate of", ["A-6"]],
    ["Blocked by", ["A-4"]],
    ["Blocking", ["A-8"]],
    ["Related", ["A-1"]],
    ["Duplicates", ["A-3"]],
    ["Is caused by", ["A-2", "A-7"]],
    ["Clones", ["A-5"]],
  ]);
  expect(relationSections([])).toEqual([]);
});

test("R3-relations-D6: Linear disables an issue already linked by the same link type, either way, with its reason", () => {
  const relations = [
    { key: "K-2", kind: "blocking" },
    { key: "K-3", kind: "related" },
    { key: "K-4", kind: "duplicated" },
  ];
  expect([...alreadyLinked(relations, "blocked")]).toEqual([["K-2", "Already blocked by this issue"]]);
  expect([...alreadyLinked(relations, "blocking")]).toEqual([["K-2", "Already blocking this issue"]]);
  expect([...alreadyLinked(relations, "related")]).toEqual([["K-3", "Already referenced"]]);
  expect([...alreadyLinked(relations, "duplicate")]).toEqual([["K-4", "Already duplicated"]]);
  expect(alreadyLinked(relations, "parent").size).toBe(0);
});
