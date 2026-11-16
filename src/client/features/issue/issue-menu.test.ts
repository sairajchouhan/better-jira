import { type Board, type Issue } from "@/shared/issue-model";
import { describe, expect, test } from "bun:test";
import { defaultPreferences, type Preferences } from "@/shared/view-model";
import type { ActionEntry } from "@/client/components/action-menu";
import { get, ME, set } from "@/client/state/store";
import { navigate, ui } from "@/client/features/navigation/app-navigation";
import { handle } from "@/client/features/navigation/commands";

import { issueBreadcrumbEntries, issueMenuEntries, issuePropertyEntries } from "./issue-menu";

const issue: Issue = {
  key: "TEST-2",
  boards: [1],
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

test("the issue breadcrumb's right-click menu is Linear's Api: the Copy submenu's rows, then ┄ Rename… ⇧R", () => {
  const crumb = issueBreadcrumbEntries(issue);
  const copy = find(issueMenuEntries(issue, { openDialog: () => {}, close: () => {} }), ["Copy"]).children!;
  expect(crumb.slice(0, -1).map((e) => [e.name, e.shortcut])).toEqual(copy.map((e) => [e.name, e.shortcut]));
  expect(crumb.slice(0, -1).some((e) => e.divider)).toBe(false);
  const rename = crumb.at(-1)!;
  expect([rename.name, rename.shortcut, rename.divider]).toEqual(["Rename…", "Shift+R", true]);
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
      // B9: Peek into item is the view peek over the issue list or board, so the Inbox (its own split list) has none.
      expect(listed).toEqual(at.inbox ? ["open"] : []);
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

test("A3: the property values ⌘K hoists carry Linear's command-menu breadcrumbs and search words", () => {
  const command = issuePropertyEntries(issue, { close: () => {}, menu: "command" }),
    contextual = issuePropertyEntries(issue, { close: () => {}, menu: "contextual" });
  // Linear's RCn and Xun: "Change status…" and "Assign to…" in ⌘K, "Status" and "Assignee" in a right-click menu.
  expect([command.status.name, command.assignee.name]).toEqual(["Change status…", "Assign to…"]);
  expect([contextual.status.name, contextual.assignee.name]).toEqual(["Status", "Assignee"]);
  // Odn and eK name their values' breadcrumb themselves; assignee and labels hoist from 3 characters, status and priority from 2.
  expect(command.priority.nameAsParent).toBe("Set priority to");
  expect([command.status.hoistFrom, command.priority.hoistFrom, command.assignee.hoistFrom, command.labels.hoistFrom]).toEqual([
    undefined,
    undefined,
    3,
    3,
  ]);
  // "unassigned" finds No assignee; "me" is an exact keyword on your own row only.
  const users = command.assignee.children!;
  expect(users.find((u) => u.name === "No assignee")?.keywords).toEqual(["unassigned"]);
  expect(users.find((u) => u.name === ME.name)?.exact).toEqual(["me"]);
  expect(users.filter((u) => u.exact).length).toBe(1);
});

test("C3: Issue options › Status and Epic search as the S and ⇧P pickers: workflow order, and Linear's No project keywords (as No epic)", async () => {
  const { searchActions } = await import("@/client/components/action-menu");
  const board: Board = {
    id: 1,
    name: "Board",
    columns: ["Backlog", "Todo", "Doing", "Review", "Done"].map((name) => ({
      name,
      statuses: [{ id: name.toLowerCase(), name, category: name === "Done" ? "done" : "indeterminate" }],
    })),
  };
  set({ boards: [board], issues: new Map([[issue.key, issue]]) });
  const entries = issuePropertyEntries(issue, { close: () => {}, menu: "contextual" });
  expect(searchActions(entries.status.children!, "do").slice(0, 2).map((e) => e.name)).toEqual(["Doing", "Done"]);
  expect(entries.project.name).toBe("Epic");
  // Typing Linear's word still finds the No epic row.
  expect(searchActions(entries.project.children ?? [], "project").map((e) => e.name)).toContain("No epic");
});

describe("BJ-247: an epic parent is the issue's Project, never its Parent", () => {
  const board: Board = {
    id: 1,
    name: "Board",
    columns: [{ name: "Todo", statuses: [{ id: "todo", name: "Todo", category: "new" }] }],
  };
  const epic: Issue = { ...issue, key: "E-1", type: "Epic", summary: "Billing" };
  const task: Issue = { ...issue, key: "E-2", type: "Task", parent: "E-1" };
  const other: Issue = { ...issue, key: "E-4", type: "Task" };
  const sub: Issue = { ...issue, key: "E-3", type: "Sub-task", parent: "E-2" };
  const setup = () =>
    set({ writable: false, boards: [board], issues: new Map([epic, task, sub, other].map((i) => [i.key, i])) });
  const menu = (key: string) => issueMenuEntries(get().issues.get(key)!, { openDialog: () => {}, close: () => {} });
  const names = (entries: ActionEntry[], name: string) => entries.find((e) => e.name === name)?.children?.map((e) => e.name) ?? [];

  test("Remove never lists the epic as a parent issue; a sub-issue's parent issue it does", () => {
    setup();
    expect(names(menu("E-2"), "Remove").some((n) => n.includes("E-1"))).toBe(false);
    expect(names(menu("E-3"), "Remove")).toContain(`Parent issue E-2 ${task.summary}`);
  });

  test("an epic has no Parent of…, Sub-issue of… or Parent issue…; its Sub-issue… creates an issue in it (BJ-280)", () => {
    setup();
    const entries = menu("E-1");
    expect(names(entries, "Mark as")).not.toContain("Parent of…");
    expect(names(entries, "Mark as")).not.toContain("Sub-issue of…");
    expect(names(entries, "Create related")).not.toContain("Parent issue…");
    expect(names(entries, "Create related")).toContain("Sub-issue…");
    expect(names(menu("E-2"), "Mark as")).toContain("Sub-issue of…");
  });

  test("dropping an issue in an epic on No parent keeps its epic; an epic never drops into a parent group", async () => {
    const { actions } = await import("@/client/state/issue-actions");
    setup();
    actions.drop("E-2", 1, [{ by: "parent", id: "$none" }]);
    expect(get().issues.get("E-2")?.parent).toBe("E-1");
    actions.drop("E-1", 1, [{ by: "parent", id: "E-4" }]);
    expect(get().issues.get("E-1")?.parent).toBeUndefined();
    // A sub-issue does leave its parent issue.
    actions.drop("E-3", 1, [{ by: "parent", id: "$none" }]);
    expect(get().issues.get("E-3")?.parent).toBeUndefined();
  });

  test("⌘K and keys: Open parent issue (⌘⇧↑), Open sub-issue and ⌘⇧→ reach an epic's issues too; an epic has no Set parent issue", async () => {
    const { canRunShortcut } = await import("@/client/features/navigation/shortcuts");
    setup();
    ui.send({ type: "overlay.close" });
    const on = (key: string) => {
      navigate({ board: 1, selected: key, panel: true, document: null, inbox: false, mine: false });
      return ["parent-open", "sub-issues-of-parent", "child-open", "parent-set"].filter(canRunShortcut);
    };
    // BJ-280: the epic's Sub-issues section lists E-2, so Open sub-issue reaches it.
    expect(on("E-1")).toEqual(["child-open"]);
    // BJ-289: E-2's title line names its epic (In epic), so ⌘⇧↑ opens the epic and ⌘⇧→ its issues.
    expect(on("E-2")).toEqual(["parent-open", "sub-issues-of-parent", "child-open", "parent-set"]);
    expect(on("E-3")).toEqual(["parent-open", "sub-issues-of-parent", "parent-set"]);
    // An issue in no epic and under no Task has nothing to open.
    expect(on("E-4")).toEqual(["parent-set"]);
  });

  test("BJ-289: Open parent issue (⌘⇧↑) opens the Task above a Subtask, else the epic; an epic and an orphan have none", async () => {
    const { shortcuts } = await import("@/client/features/navigation/shortcuts");
    const open = shortcuts.find((s) => s.id === "parent-open")!;
    setup();
    ui.send({ type: "overlay.close" });
    const up = (key: string) => {
      navigate({ board: 1, selected: key, panel: true, document: null, inbox: false, mine: false });
      if (!open.when!(get(), get().issues.get(key))) return null;
      open.run();
      return get().selected;
    };
    expect(up("E-2")).toBe("E-1");
    expect(up("E-3")).toBe("E-2");
    expect(up("E-1")).toBeNull();
    expect(up("E-4")).toBeNull();
  });

  test("BJ-354: Open parent issue (⌘⇧↑) opens a parent no board holds here, keeping it first, never only when held", async () => {
    const { shortcuts } = await import("@/client/features/navigation/shortcuts");
    const open = shortcuts.find((s) => s.id === "parent-open")!;
    setup();
    ui.send({ type: "overlay.close" });
    const orphan: Issue = { ...issue, key: "E-6", type: "Task", parent: "OFF-1" };
    set({ issues: new Map([...get().issues, [orphan.key, orphan]]) });
    navigate({ board: 1, selected: "E-6", panel: true, document: null, inbox: false, mine: false });
    const asked: string[] = [],
      realFetch = globalThis.fetch;
    globalThis.fetch = (async (input: RequestInfo | URL) => {
      asked.push(String(input));
      return new Response("{}", { status: 404 });
    }) as typeof fetch;
    try {
      expect(open.when!(get(), get().issues.get("E-6"))).toBe(true);
      open.run();
      await Bun.sleep(20);
      expect(asked).toContain("/api/issues/OFF-1");
    } finally {
      globalThis.fetch = realFetch;
    }
  });

  test("a sub-issue can't be moved to a project group: that would take its parent issue away", async () => {
    const { actions } = await import("@/client/state/issue-actions");
    const child: Issue = { ...issue, key: "E-5", type: "Task", parent: "E-4" };
    setup();
    set({ issues: new Map([...get().issues, [child.key, child]]) });
    actions.drop("E-5", 1, [{ by: "project", id: "E-1" }]);
    expect(get().issues.get("E-5")?.parent).toBe("E-4");
  });
});

test("BJ-379/380: the issue menu's and breadcrumb's Copy rows carry Linear's ⌥ names, keeping their own as identity", () => {
  const rows = issueBreadcrumbEntries(issue);
  expect(rows.filter((e) => e.altName).map((e) => [e.name, e.altName])).toEqual([
    ["Copy ID", "Copy ID as link"],
    ["Copy title", "Copy title without ID"],
    ["Copy title as link", "Copy title without ID as link"],
  ]);
});
