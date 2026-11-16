import { expect, test } from "bun:test";
import type { Issue } from "@/shared/issue-model";
import { markChanged, mergeProperties } from "./local-edits";
import { set } from "./store";

const issue = (boards: number[]) =>
  ({ key: "TEAM-1", boards, summary: "Shared", status: "1", assignee: null, labels: [], comments: 0, updated: "2026-11-01T10:00:00Z", resolved: null }) as Issue;

test("a poll that only changes which boards hold an issue reaches the tab, though Jira's updated is the same", () => {
  set({ issues: new Map([["TEAM-1", issue([1])]]) });
  const joined = mergeProperties({ "TEAM-1": issue([1, 2]) }).issues;
  expect(joined?.get("TEAM-1")?.boards).toEqual([1, 2]);
  set({ issues: joined! });
  expect(mergeProperties({ "TEAM-1": issue([2]) }).issues?.get("TEAM-1")?.boards).toEqual([2]);
});

test("BJ-338: a tab that keeps edits local still takes the issues Jira adds, but never one deleted here", () => {
  set({ writable: false, issues: new Map([["TEAM-1", issue([1])]]) });
  // TEAM-2 was deleted in this tab: a local change marks it.
  markChanged("TEAM-2");
  const merged = mergeProperties({
    "TEAM-1": issue([1]),
    "TEAM-2": { ...issue([1]), key: "TEAM-2" },
    "TEAM-3": { ...issue([1]), key: "TEAM-3" },
  }).issues;
  expect([...merged!.keys()].sort()).toEqual(["TEAM-1", "TEAM-3"]);
});

test("a pull request number the mirror stops sending leaves the issue, so the badge never shows an old pull request's number", () => {
  set({ writable: false, issues: new Map([["TEAM-1", { ...issue([1]), prCount: 1, prStatus: "open", prNumber: "#2965" } as Issue]]) });
  // A second pull request linked: Jira's state moved and no number for two.
  const two = mergeProperties({ "TEAM-1": { ...issue([1]), prCount: 2 } }).issues!.get("TEAM-1")!;
  expect([two.prCount, two.prStatus, two.prNumber]).toEqual([2, undefined, undefined]);
});

test("BJ-394: a mirrored field the server stops sending is cleared, but a local edit, enrichment and this browser's own fields stay", async () => {
  const { patchIssue } = await import("./local-edits");
  const ann = { id: "ann", name: "Ann" };
  const before = {
    ...issue([1]),
    parent: "TEAM-0",
    priority: "High",
    estimate: 3,
    commentText: "old words",
    statusSince: "2026-10-01T00:00:00Z",
    watchers: [ann],
    reminder: { at: "2026-12-01T09:00:00Z" },
    resources: [{ id: "r1", kind: "link", url: "https://example.com", title: "Example", created: "", updated: "" }],
  } as Issue;
  set({ writable: true, issues: new Map([["TEAM-1", before]]), full: new Map() });
  // Jira cleared the parent, priority, estimate and comments; enrichment is rerunning, so its fields are absent too.
  const cleared = mergeProperties({ "TEAM-1": { ...issue([1]), updated: "2026-11-02T10:00:00Z" } }).issues!.get("TEAM-1")!;
  expect([cleared.parent, cleared.priority, cleared.estimate, cleared.commentText]).toEqual([undefined, undefined, undefined, undefined]);
  expect(cleared.statusSince).toBe("2026-10-01T00:00:00Z");
  expect(cleared.watchers).toEqual([ann]);
  expect(cleared.reminder).toEqual(before.reminder);
  expect(cleared.resources).toEqual(before.resources);

  // A priority picked here and not yet Jira's survives a row without one.
  set({ issues: new Map([["TEAM-2", { ...before, key: "TEAM-2" }]]) });
  patchIssue("TEAM-2", { priority: "Urgent" });
  const kept = mergeProperties({ "TEAM-2": { ...issue([1]), key: "TEAM-2", updated: "2026-11-03T10:00:00Z" } }).issues!.get("TEAM-2")!;
  expect(kept.priority).toBe("Urgent");
  expect(kept.parent).toBeUndefined();
});

test("BJ-394: a read-only tab keeps its local attachments though the row's list is Jira's", () => {
  const file = { id: "a1", name: "shot.png", url: "", type: "image/png", size: 1 };
  set({ writable: false, issues: new Map([["TEAM-1", { ...issue([1]), attachments: [file] } as Issue]]) });
  const merged = mergeProperties({ "TEAM-1": { ...issue([1]), summary: "Renamed", attachments: [] } }).issues!.get("TEAM-1")!;
  expect([merged.summary, merged.attachments]).toEqual(["Renamed", [file]]);
});
