import { expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { CommandMenu, CommandMenuPage } from "@/client/components/command-menu";
import { HOISTED, isFieldCommand } from "./palette";
import type { Issue } from "@/shared/issue-model";

const issue = { key: "TEST-7", summary: "Fix the login flow" } as Issue;

test("BJ-343: a command menu inside a ⌘K page draws in ⌘K's frame (no second surface), under the issue's chip", () => {
  const html = renderToStaticMarkup(
    <CommandMenuPage back={() => {}}>
      <CommandMenu label="Change status" issue={issue} close={() => {}}>
        <p>rows</p>
      </CommandMenu>
    </CommandMenuPage>,
  );
  expect(html).toMatch(/^<div class="command-menu"><div class="command-menu-title">/);
  expect(html).toContain("TEST-7");
  expect(html).toContain("<p>rows</p>");
  expect(html).not.toContain("data-surface");
});

test("BJ-343: every field command of the targeted issue opens as a ⌘K page; other issue commands still run", () => {
  for (const id of ["assign", "status", "priority", "type", "labels", "due", "remind", "project", "milestone"])
    expect(isFieldCommand(id)).toBe(true);
  for (const id of ["assign-me", "rename", "remove-due", "delete"]) expect(isFieldCommand(id)).toBe(false);
});

test("BJ-250: ⌘K lists the targeted issue's epics (Linear's \"Move to project › X\") from the Epic command", () => {
  expect(HOISTED).toContainEqual(["project", "project"]);
});

import { leavePage, openPage, PAGE_COMMANDS } from "./palette";

test("BJ-360: ⌘K's Open … rows open their page inside ⌘K, and Backspace returns to the root with its search and row", () => {
  expect(PAGE_COMMANDS).toMatchObject({
    "open-issue": "issues",
    "open-document": "documents",
    "open-user": "users",
    "favorite-open": "favorites",
    "team-open": "boards",
    "view-open": "views",
    grouping: "grouping",
    ordering: "ordering",
  });
  const root = { q: "open sp", page: null };
  const opened = openPage(root, { kind: "open", page: "boards" }, "cmd:Open space");
  expect(opened).toEqual({ q: "open sp", page: { kind: "open", page: "boards" }, returnTo: "cmd:Open space" });
  expect(leavePage(opened)).toEqual({ q: "open sp", page: null, returnTo: "cmd:Open space" });
});

test("BJ-360: a page entered by its keyword (\"t \") comes back to an empty root search, as Linear's stack keeps none", () => {
  const opened = openPage({ q: "t ", page: null }, { kind: "open", page: "boards" });
  expect(leavePage(opened)).toEqual({ q: "", page: null, returnTo: undefined });
});

import { commandWording, paletteEntries } from "./palette";
import { shortcuts } from "./shortcuts";

test("BJ-244: ⌘K leaves out Dismiss all toasts (Linear's hideInCommandMenu) and lists the other commands that apply", () => {
  const app = paletteEntries(shortcuts, () => true, "app").map((s) => s.id);
  expect(app).not.toContain("dismiss-toast");
  expect(app).toContain("shortcuts");
  expect(app.every((id) => !shortcuts.find((s) => s.id === id)?.issue)).toBe(true);
  const onIssue = paletteEntries(shortcuts, () => true, "issue").map((s) => s.id);
  expect(onIssue).toContain("copy-id");
  expect(onIssue).not.toContain("shortcuts");
  expect(paletteEntries(shortcuts, (s) => s.id !== "copy-id", "issue").map((s) => s.id)).not.toContain("copy-id");
});

test("BJ-379: ⌘K's Copy rows carry Linear's ⌥ names, read from the command each row is built from", () => {
  const wording = (id: string) => commandWording(shortcuts.find((s) => s.id === id)!, issue, () => undefined);
  expect(wording("copy-id")).toEqual({ name: "Copy issue ID", altName: "Copy issue ID as link" });
  expect(wording("copy-link")).toEqual({ name: "Copy title as link", altName: "Copy title without ID as link" });
  expect(wording("copy-title").altName).toBe("Copy issue title without ID");
  expect(wording("rename")).toEqual({ name: "Rename issue…", altName: undefined });
});

import { notificationChip, targetedGroups } from "./palette";
import { hotkeyOf, markReadName } from "./shortcuts";
import { CommandMenuTitle } from "@/client/components/command-menu";
import { orderGroups } from "./palette-groups";
import { commandWording as wordingOf } from "./palette";
import type { InboxItem } from "@/shared/inbox-model";

const notification = (over: Partial<InboxItem> = {}): InboxItem => ({
  id: "n1",
  head: "h1",
  key: "RAJ-47",
  title: "implement hard push",
  url: "",
  actor: null,
  kind: "comment",
  message: "Ana commented on a task",
  preview: "",
  time: "2026-11-10T00:00:00Z",
  status: "",
  unread: false,
  category: "direct",
  count: 1,
  link: "",
  commentId: "",
  issueType: "",
  others: [],
  ...over,
});

test("inbox ⌘K: the selected notification's own group holds Mark as read, Snooze and Delete ⌫; E is kept out", () => {
  const own = paletteEntries(shortcuts, () => true, "notification").map((s) => s.id);
  expect(own).toEqual(["inbox-read", "inbox-snooze", "inbox-backspace"]);
  expect(hotkeyOf("inbox-backspace")).toBe("Backspace");
  // E still runs Delete notification (Inbox.Dwc57oAi.js `It`, hideInCommandMenu).
  expect(shortcuts.find((s) => s.id === "inbox-delete")?.hotkey).toBe("E");
  expect(paletteEntries(shortcuts, () => true, "notification").map((s) => s.id)).not.toContain("inbox-delete");
});

test("inbox ⌘K: the Notifications group has Linear's bulk deletes in its order, Delete all and completed included", () => {
  const ids = paletteEntries(shortcuts, () => true, "app")
    .map((s) => s.id)
    .filter((id) => /^inbox-(read-all|delete)/.test(id));
  expect(ids).toEqual(["inbox-read-all", "inbox-delete-read", "inbox-delete-all", "inbox-delete-completed"]);
  const name = (id: string) => wordingOf(shortcuts.find((s) => s.id === id)!, undefined, () => undefined).name;
  expect(name("inbox-delete-all")).toBe("Delete all notifications");
  expect(name("inbox-delete-completed")).toBe("Delete read notifications for completed issues");
  // Mark all as read only while it would act: its `when` is what ⌘K's applicable reads.
  expect(paletteEntries(shortcuts, (s) => s.id !== "inbox-read-all", "app").map((s) => s.id)).not.toContain("inbox-read-all");
});

test("U's ⌘K name follows the notification's state, as Linear's dEn", () => {
  expect(markReadName({ unread: true })).toBe("Mark as read");
  expect(markReadName({ unread: false })).toBe("Mark as unread");
  expect(markReadName(undefined)).toBe("Mark as read");
});

test("inbox ⌘K: a selected notification is the title; its issue's group follows Notifications under the issue's name", () => {
  expect(notificationChip(notification())).toEqual({ prefix: "Notification", title: "New comment: RAJ-47 implement hard push" });
  const html = renderToStaticMarkup(<CommandMenuTitle prefix="Notification" title="Due: RAJ-47 implement hard push" />);
  expect(html).toContain('<span class="command-menu-prefix">Notification ⋅</span> Due: RAJ-47 implement hard push');

  const [own, target] = targetedGroups({ row: notification(), issue, notificationRows: ["read"], issueRows: ["assign"] });
  expect(own).toMatchObject({ heading: undefined, priority: 0, rows: ["read"] });
  // One inline run, so the group header's flex row keeps the space after "KEY ⋅".
  expect(renderToStaticMarkup(<>{target!.heading}</>)).toBe(
    `<span class="truncate"><span class="command-menu-prefix">${issue.key} ⋅</span> ${issue.summary}</span>`,
  );
  const notifications = { key: "Notifications", heading: "Notifications", priority: 0, rows: ["delete-all"] };
  const order = orderGroups([own!, target!, notifications].map((g) => ({ ...g, rank: 0 })), false).map((g) => g.key);
  expect(order).toEqual(["notification", "Notifications", "target"]);

  // No notification: the issue's group is headless again and the notification's is empty.
  const [none, alone] = targetedGroups({ row: undefined, issue, notificationRows: ["read"], issueRows: ["assign"] });
  expect(none!.rows).toEqual([]);
  expect(alone!.heading).toBeUndefined();
});
