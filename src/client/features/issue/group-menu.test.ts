import { expect, test } from "bun:test";
import type { Issue } from "@/shared/issue-model";
import { defaultPreferences } from "@/shared/view-model";
import type { ActionEntry } from "@/client/components/action-menu";
import { get } from "@/client/state/store";
import { groupMenuEntries } from "./personal-controls";

const issue = (key: string): Issue => ({
  key,
  board: 1,
  summary: key,
  status: "todo",
  assignee: null,
  labels: [],
  updated: "",
  resolved: null,
  comments: 0,
});
const display = defaultPreferences().display;
const rows = (entries: ActionEntry[]) => entries.map((e) => `${e.divider ? "┄ " : ""}${e.name}`);
const noop = () => {};

test("a board column's menu is Linear's qu: Select all in column, Hide column, ┄ Order completed by recency", () => {
  expect(rows(groupMenuEntries({ unit: "column", issues: [issue("G-1")], hide: noop, completed: true, display }))).toEqual([
    "Select all in column",
    "Hide column",
    "┄ Order completed by recency",
  ]);
  // An empty, open column: no Select all, and nothing above Hide column to divide from.
  expect(rows(groupMenuEntries({ unit: "column", issues: [], hide: noop, completed: false, display }))).toEqual(["Hide column"]);
});

test("a list group's menu is Linear's useListContextualActions h, its names following the group's state", () => {
  const collapse = (collapsed: boolean) => ({ collapsed, toggle: noop, toggleAll: noop });
  expect(
    rows(groupMenuEntries({ unit: "group", issues: [issue("G-1")], hide: noop, completed: true, display, collapse: collapse(false) })),
  ).toEqual(["Collapse", "Collapse all", "┄ Select all in group", "Hide group", "┄ Order completed by recency"]);
  // Collapsed: Expand, and no Select all for rows that aren't showing.
  expect(
    rows(groupMenuEntries({ unit: "group", issues: [issue("G-1")], hide: noop, completed: false, display, collapse: collapse(true) })),
  ).toEqual(["Expand", "Expand all", "┄ Hide group"]);
});

test("Collapse all / Expand all follows this group's state, not the others' (Linear's ListCell `$t`)", () => {
  // Only this group is collapsed, the rest are open: Linear still offers Expand all, which opens every group.
  const names = groupMenuEntries({
    unit: "group",
    issues: [issue("G-1")],
    hide: noop,
    completed: false,
    display,
    collapse: { collapsed: true, toggle: noop, toggleAll: noop },
  }).map((e) => e.name);
  expect(names).toContain("Expand all");
  expect(names).not.toContain("Collapse all");
});

test("Select all selects the group's issues, and its rows run the header's own callbacks", () => {
  const calls: string[] = [];
  const entries = groupMenuEntries({
    unit: "group",
    issues: [issue("G-1"), issue("G-2")],
    hide: () => calls.push("hide"),
    completed: false,
    display,
    collapse: { collapsed: false, toggle: () => calls.push("toggle"), toggleAll: () => calls.push("all") },
  });
  for (const entry of entries) entry.run!();
  expect(calls).toEqual(["toggle", "all", "hide"]);
  expect([...get().columnSelection]).toEqual(["G-1", "G-2"]);
});
