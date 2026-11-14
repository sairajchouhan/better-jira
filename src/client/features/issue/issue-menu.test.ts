import { type Board, type Issue } from "@/shared/issue-model";
import { describe, expect, test } from "bun:test";
import { defaultPreferences, type Preferences } from "@/shared/view-model";
import type { ActionEntry } from "@/client/components/action-menu";
import { get, set } from "@/client/state/store";
import { navigate, ui } from "@/client/features/navigation/app-navigation";
import { handle } from "@/client/features/navigation/commands";

import { issueMenuEntries } from "./issue-menu";

const issue: Issue = {
  key: "TEST-2",
  board: 1,
  summary: "Menu issue",
  status: "todo",
  assignee: null,
  labels: [],
  updated: "",
  resolved: null,
  comments: 0,
};
const find = (entries: ActionEntry[], path: string[]): ActionEntry => {
  const [name, ...rest] = path;
  const entry = entries.find((e) => e.name === name)!;
  return rest.length ? find(entry.children!, rest) : entry;
};

test("a copy entry never closes again after the copy finishes", async () => {
  let closes = 0;
  const entries = issueMenuEntries(issue, { openDialog: () => {}, close: () => closes++ });
  find(entries, ["Copy", "Copy ID"]).run!();
  await Bun.sleep(0);
  expect(closes).toBe(0);
});

test("Create related › Sub-issue… runs on the menu's issue, not the selection", async () => {
  const selected = { ...issue, key: "TEST-1" };
  set({ issues: new Map([[selected.key, selected], [issue.key, issue]]) });
  ui.send({ type: "overlay.close" });
  navigate({ selected: selected.key, document: null, inbox: false, mine: false });
  expect(get().selected).toBe(selected.key);
  const parents: string[] = [];
  const stop = handle("create-sub-issue", (key) => (parents.push(key), true));
  globalThis.requestAnimationFrame ??= (run) => setTimeout(run, 0) as unknown as number;
  try {
    const entries = issueMenuEntries(issue, { openDialog: () => {}, close: () => {} });
    find(entries, ["Create related", "Sub-issue…"]).run!();
    await Bun.sleep(50);
  } finally {
    stop();
  }
  expect(parents).toEqual(["TEST-2"]);
});

test("a menu's shortcut runs on its own issue even while a sub-issue row is hovered", async () => {
  const { runShortcut } = await import("@/client/features/navigation/shortcuts");
  const hovered = { ...issue, key: "TEST-3" };
  set({ issues: new Map([[hovered.key, hovered], [issue.key, issue]]) });
  const keys: string[] = [];
  const stopHover = handle("hovered-sub-issue", () => hovered.key);
  const stopTitle = handle("focus-title", (key) => (keys.push(key), true));
  try {
    runShortcut("rename", issue.key);
  } finally {
    stopHover();
    stopTitle();
  }
  expect(keys).toEqual([issue.key]);
});

test("Change subscribers on a hovered sub-issue row opens that issue's subscribers, not the open parent's", async () => {
  const { runShortcut } = await import("@/client/features/navigation/shortcuts");
  const parent = { ...issue, key: "TEST-1" }, child = { ...issue, key: "TEST-3" };
  set({ issues: new Map([[parent.key, parent], [child.key, child]]) });
  ui.send({ type: "overlay.close" });
  navigate({ selected: parent.key, panel: true, document: null, inbox: false, mine: false });
  const keys: string[] = [];
  const stopHover = handle("hovered-sub-issue", () => child.key);
  const stopSubs = handle("change-subscribers", (key) => (keys.push(key), true));
  try {
    runShortcut("subscribers");
  } finally {
    stopHover();
    stopSubs();
  }
  expect([keys, get().selected]).toEqual([[child.key], child.key]);
});

describe("Move (R3-board-D1, D2)", () => {
  const board: Board = {
    id: 1,
    name: "Board",
    columns: ["Todo", "In Progress", "In Review", "Done"].map((name) => ({
      name,
      statuses: [{ id: name.toLowerCase(), name, category: name === "Done" ? "done" : "indeterminate" }],
    })),
  };
  const card = (key: string, status: string, rank: string): Issue => ({ ...issue, key, status, rank });
  const setup = (patch: (p: Preferences) => void = () => {}) => {
    const prefs = defaultPreferences();
    prefs.hidden = { status: ["In Review"] };
    patch(prefs);
    set({
      boards: [board],
      preferences: { 1: prefs },
      effectiveViewPreferences: null,
      issues: new Map(
        [card("M-1", "todo", "a"), card("M-2", "todo", "b"), card("M-3", "in progress", "a"), card("M-4", "done", "a")].map(
          (i) => [i.key, i],
        ),
      ),
    });
    ui.send({ type: "overlay.close" });
    navigate({ board: 1, selected: null, panel: false, document: null, inbox: false, mine: false });
  };
  const moves = (key: string) =>
    find(issueMenuEntries(get().issues.get(key)!, { openDialog: () => {}, close: () => {}, presentation: "row" }), ["Move…"])
      .children!.map((e) => [e.name, e.disabledReason ?? ""]);

  test("Move right/left skip a hidden column, from the menu and from ⌥→", async () => {
    const { runShortcut } = await import("@/client/features/navigation/shortcuts");
    setup();
    expect(moves("M-3")).toEqual([
      ["Move right", ""],
      ["Move left", ""],
    ]);
    find(issueMenuEntries(get().issues.get("M-3")!, { openDialog: () => {}, close: () => {}, presentation: "row" }), [
      "Move…",
      "Move right",
    ]).run!();
    expect(get().issues.get("M-3")!.status).toBe("done");
    navigate({ selected: "M-3" });
    runShortcut("column-left");
    // In Progress emptied when M-3 left it, and an empty group is hidden on the board too (Linear's `Gvr`): it lands in Todo.
    expect(get().issues.get("M-3")!.status).toBe("todo");
    // Nothing visible to the right of Done: no Move right, and ⌥→ does nothing.
    expect(moves("M-4").map(([name]) => name)).toEqual(["Move left"]);
  });

  test("R3 G13: the board row menu has one Move… in the Copy group after Make a copy…, no divider, as Linear's issue menu (aAr)", () => {
    setup();
    const entries = issueMenuEntries(get().issues.get("M-1")!, { openDialog: () => {}, close: () => {}, presentation: "row" });
    const names = entries.map((e) => e.name);
    expect(names.filter((n) => n.startsWith("Move"))).toEqual(["Move…"]);
    expect(names.slice(names.indexOf("Copy"), names.indexOf("Copy") + 3)).toEqual(["Copy", "Make a copy…", "Move…"]);
    expect(entries.find((e) => e.name === "Move…")).toMatchObject({ icon: "move", search: "hidden" });
    expect(entries.find((e) => e.name === "Move…")!.divider).toBeUndefined();
  });

  test("Linear's names and order; up/down/top/bottom disabled with its reason when the group isn't ordered manually", () => {
    setup();
    expect(moves("M-1")).toEqual([
      ["Move right", ""],
      ["Move down", ""],
      ["Move to bottom", ""],
    ]);
    expect(moves("M-2").map(([name]) => name)).toEqual(["Move to top", "Move up", "Move right"]);
    setup((p) => (p.display.ordering = "priority"));
    expect(moves("M-1")).toEqual([
      ["Move right", ""],
      ["Move down", "This group is not ordered manually"],
      ["Move to bottom", "This group is not ordered manually"],
    ]);
  });

  test("R3-palette-shortcuts-D1: board moves never run off the board, so ⌥→/⌥↑ on the issue page or in the Inbox write nothing", async () => {
    const { runShortcut, shortcutApplies, shortcuts } = await import("@/client/features/navigation/shortcuts");
    const listOnly = ["reorder-up", "reorder-down", "reorder-top", "reorder-bottom", "column-left", "column-right", "peek", "open", "left", "right"];
    const offBoard = [
      { selected: "M-1", panel: true, view: "page" as const },
      { selected: "M-1", inbox: true },
    ];
    for (const at of offBoard) {
      setup((p) => (p.display.ordering = "manual"));
      navigate(at);
      // No Move… submenu at all: every move is inapplicable.
      expect(issueMenuEntries(get().issues.get("M-1")!, { openDialog: () => {}, close: () => {}, presentation: "row" }).some((e) => e.name === "Move")).toBe(false);
      for (const id of ["column-right", "reorder-down", "reorder-bottom"]) runShortcut(id);
      expect([get().issues.get("M-1")!.status, get().issues.get("M-1")!.rank]).toEqual(["todo", "a"]);
      // ⌘K lists only what applies, so none of the board's moves show either.
      const listed = shortcuts.filter((e) => listOnly.includes(e.id) && shortcutApplies(e)).map((e) => e.id);
      expect(listed).toEqual(at.inbox ? ["peek", "open"] : []);
    }
  });
});

test("R3-issue-fields-D1: a writable site's Priority submenu has no No priority row, as Jira can't clear it", () => {
  const names = () =>
    find(issueMenuEntries(issue, { openDialog: () => {}, close: () => {}, presentation: "row" }), [
      "Priority",
    ]).children!.map((row) => [row.name, row.number]);
  const { writable, options } = get();
  try {
    set({ writable: true, options: { ...options, priorities: [{ id: "2", name: "High" }] } });
    expect(names()).not.toContainEqual(["No priority", 0]);
    expect(names()[0]?.[1]).toBe(1);
    set({ writable: false });
    expect(names()[0]).toEqual(["No priority", 0]);
  } finally {
    set({ writable, options });
  }
});
