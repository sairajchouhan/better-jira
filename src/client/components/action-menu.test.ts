import { expect, test } from "bun:test";
import { searchActions, type ActionEntry } from "./action-menu";

const leaf = (name: string, extra: Partial<ActionEntry> = {}): ActionEntry => ({ name, run: () => {}, ...extra });
const menu: ActionEntry[] = [
  { name: "Status", children: [leaf("To Do"), leaf("In Progress"), leaf("In Review"), leaf("Done")] },
  {
    name: "Priority",
    nameAsParent: "Change priority to",
    children: [leaf("No priority"), leaf("High"), leaf("Low")],
  },
  {
    name: "Labels",
    hoistFrom: 3,
    nameAsParent: (child) => (child.selected ? "Change label" : "Add label"),
    children: [leaf("bug", { selected: true }), leaf("backend")],
  },
  { name: "Copy", children: [leaf("Copy ID"), leaf("Copy URL")] },
  { name: "Remove", children: [leaf("Blocking issue TEST-2")] },
  { name: "Remind me", hoistFrom: Infinity, children: [leaf("Tomorrow"), leaf("Next week")] },
  leaf("Make a copy…"),
  leaf("Restore mirrored Jira version"),
];
const names = (query: string) => searchActions(menu, query).map((e) => e.name);

test("ISSUE-8 / CORE-13: a matching submenu row is listed, ahead of the children it hoists", () => {
  expect(names("copy")[0]).toBe("Copy");
  expect(names("copy")).toContain("Copy › Copy ID");
  expect(names("st")[0]).toBe("Status");
  expect(names("copy id")[0]).toBe("Copy › Copy ID");
});

test("ISSUE-8: results are ranked, not left in tree order", () => {
  // A word-start match outranks a mid-word one listed above it.
  const flat = [leaf("Show description history"), leaf("Set due date"), leaf("History")];
  expect(searchActions(flat, "hist").map((e) => e.name)).toEqual(["History", "Show description history"]);
  expect(names("review")[0]).toBe("Status › In Review");
});

test("ISSUE-8: hoisting follows each submenu's own threshold", () => {
  expect(names("remind")).toEqual(["Remind me"]);
  expect(names("tomorrow")).toEqual([]);
  expect(names("ba")).not.toContain("Add label › backend");
  expect(names("bac")).toContain("Add label › backend");
  expect(names("h")).not.toContain("Change priority to › High");
  expect(names("hi")).toContain("Change priority to › High");
});

test("ISSUE-17: hoisted children read Linear's parent names (nameAsParent)", () => {
  expect(names("high")).toContain("Change priority to › High");
  expect(names("bug")).toContain("Change label › bug");
  expect(names("backend")).toContain("Add label › backend");
  expect(names("zzz")).toEqual([]);
});

test("ISSUE-8: a child is found by its parent's label too, below the rows its own name matches", () => {
  expect(names("remove").slice(0, 2)).toEqual(["Remove", "Remove › Blocking issue TEST-2"]);
  expect(names("rem")).toContain("Remove › Blocking issue TEST-2");
});

import { rowKeywords } from "@/client/lib/fuzzy-score";

/** The fixture board's workflow, as issuePropertyEntries lists it: each status with its place (Linear's indexInWorkflow). */
const workflow = ["Backlog", "Todo", "Doing", "Review", "Done"].map((name, i) =>
  leaf(name, { keywords: rowKeywords({ order: i }) }),
);

test("C3: the right-click Status submenu ranks the statuses a query starts in workflow order, as the S picker does", () => {
  expect(searchActions(workflow, "do").slice(0, 2).map((e) => e.name)).toEqual(["Doing", "Done"]);
});

test("C3: hoisted into the right-click root, statuses keep workflow order under their breadcrumb", () => {
  const root = [{ name: "Status", children: workflow }, leaf("Duplicate issue")];
  const hits = searchActions(root, "do").map((e) => e.name);
  expect(hits.indexOf("Status › Doing")).toBeLessThan(hits.indexOf("Status › Done"));
});

import { keptRows } from "./action-menu";

test("BJ-393: a menu opened on a placeholder takes the rows that replace it, but keeps out a row added beside the ones it opened with", () => {
  const loading = [leaf("Loading pull requests…")];
  const opened = keptRows(new Set(), loading);
  expect([...opened]).toEqual(["Loading pull requests…"]);
  const loaded = [leaf("Open pull request"), leaf("Copy URL")];
  const swapped = keptRows(opened, loaded);
  expect([...swapped]).toEqual(["Open pull request", "Copy URL"]);
  // A row appearing while some opened rows remain stays out (it would shift the menu under the pointer), and nothing changes.
  expect(keptRows(swapped, [...loaded, leaf("Restore mirrored Jira version")])).toBe(swapped);
  // No rows at all keeps the old ones rather than emptying the menu.
  expect(keptRows(swapped, [])).toBe(swapped);
});

import { hoistedChildren } from "./action-menu";
import { personKeywords } from "@/client/lib/fuzzy-score";

test("BJ-245: a right-click root lists at most 10 of one submenu's values, in the submenu's order (Linear's limitSubActionsInRootMenu)", () => {
  const labels = { name: "Labels", hoistFrom: 3, children: Array.from({ length: 12 }, (_, i) => leaf(`label ${i + 1}`)) };
  const hits = searchActions([labels], "label").filter((e) => e.name.startsWith("Labels › "));
  expect(hits).toHaveLength(10);
  expect(hits.map((e) => e.name)).not.toContain("Labels › label 11");
  // Inside a submenu (not the root) nothing is capped.
  expect(searchActions([labels], "label", { root: false }).filter((e) => e.name.startsWith("Labels › "))).toHaveLength(12);
});

test("BJ-245: a hoisted value scores as ⌘K scores it: your own row on \"me\" is a hoisted exact hit lifted by Linear's mH, not a flat 1", () => {
  const assignee = {
    name: "Assignee",
    hoistFrom: 2,
    children: [leaf("Ann Lee", { keywords: personKeywords("Ann Lee", { me: true }), exact: ["me"] })],
  };
  const [me] = hoistedChildren(assignee, "me", { root: true });
  expect(me?.path).toEqual(["Assignee"]);
  // 1 − 0.15, then mH's +20 for the current user.
  expect(me!.score).toBeGreaterThan(20);
});

test("BJ-250: in a root search, Epic's values hoist only once the query names the action (Linear's whenMatchKeywords)", () => {
  const epic = { name: "Epic", nameAsParent: "Move to epic", hoistFrom: 3, hoistWhen: ["move", "add", "project"], children: [leaf("Alpha launch"), leaf("Beta")] };
  expect(hoistedChildren(epic, "alpha", { root: true })).toEqual([]);
  expect(hoistedChildren(epic, "move alpha", { root: true }).map((h) => h.child.name)).toEqual(["Alpha launch"]);
  // In a submenu the gate is off.
  expect(hoistedChildren(epic, "alpha", { root: false }).map((h) => h.child.name)).toEqual(["Alpha launch"]);
});
