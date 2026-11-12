import { type Issue } from "@/shared/issue-model";
import { expect, test } from "bun:test";
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
