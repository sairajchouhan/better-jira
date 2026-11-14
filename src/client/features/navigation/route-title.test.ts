import { expect, test } from "bun:test";
import { announcement, inboxTitle, titleOf, type TitleData } from "./route-title";

const data = (over: Partial<TitleData> = {}): TitleData => ({
  boards: [
    { id: 1, name: "Platform" },
    { id: 2, name: "Mobile" },
  ],
  savedViews: [
    { id: "v1", name: "Bugs", kind: "custom", board: 1 },
    { id: "t1", name: "Ready", kind: "tab", board: 2 },
  ],
  issues: new Map([
    ["PLAT-7", { key: "PLAT-7", summary: "Fix login", resources: [{ id: "d1", kind: "document", title: "Spec", updated: "" }, { id: "d2", kind: "document", title: "", updated: "" }] }],
    ["PLAT-NEW1", { key: "PLAT-NEW1", summary: "Draft idea" }],
  ]) as TitleData["issues"],
  editorDraft: null,
  personName: (id) => ({ u1: "Ada Lovelace" })[id] ?? id,
  persisted: (key) => !key.includes("NEW"),
  unread: 0,
  ...over,
});

test("a board's tab is `${team.name} › page` (RouteInfoResolvers team all/active/backlog, L1)", () => {
  expect(titleOf({ to: "board", board: 1, scope: "all" }, data())).toBe("Platform › All issues");
  expect(titleOf({ to: "board", board: 1, scope: "active" }, data())).toBe("Platform › Active issues");
  expect(titleOf({ to: "board", board: 2, scope: "backlog" }, data())).toBe("Mobile › Backlog");
  // An issue open beside the list keeps the list's title: Linear's peek doesn't navigate.
  expect(titleOf({ to: "board", board: 1, scope: "all", issue: "PLAT-7" }, data())).toBe("Platform › All issues");
  expect(titleOf({ to: "board", board: 9, scope: "all" }, data())).toBe("Not found");
});

test("a workspace view is its name; a board tab view is `${team.name} › ${view.name}`", () => {
  expect(titleOf({ to: "view", id: "v1" }, data())).toBe("Bugs");
  expect(titleOf({ to: "view", id: "t1", issue: "PLAT-7" }, data())).toBe("Mobile › Ready");
  expect(titleOf({ to: "view", id: "gone" }, data())).toBe("Not found");
});

test("the view editor: `${name} > Edit` and `New view` for workspace views, team views led by the team", () => {
  expect(titleOf({ to: "editor", id: "v1" }, data())).toBe("Bugs > Edit");
  expect(titleOf({ to: "editor", id: "t1" }, data())).toBe("Mobile › Edit Ready");
  expect(titleOf({ to: "editor" }, data())).toBe("New view");
  expect(titleOf({ to: "editor" }, data({ editorDraft: { kind: "custom", board: 1 } }))).toBe("New view");
  expect(titleOf({ to: "editor" }, data({ editorDraft: { kind: "tab", board: 1 } }))).toBe("Platform › New view");
});

test("My issues and a profile name their tab (Hbe; profiles `${user.name} › ${tab}`)", () => {
  expect(titleOf({ to: "person", person: null, tab: "assigned" }, data())).toBe("My issues › Assigned");
  expect(titleOf({ to: "person", person: null, tab: "subscribed" }, data())).toBe("My issues › Subscribed");
  expect(titleOf({ to: "person", person: "u1", tab: "created" }, data())).toBe("Ada Lovelace › Created");
});

test("the Inbox shows its unread count, capped at 99+, and nothing when all is read (DocumentTitleUpdater)", () => {
  expect(inboxTitle(0)).toBe("Inbox");
  expect(inboxTitle(3)).toBe("Inbox (3)");
  expect(inboxTitle(99)).toBe("Inbox (99)");
  expect(inboxTitle(100)).toBe("Inbox (99+)");
  expect(titleOf({ to: "inbox" }, data({ unread: 4 }))).toBe("Inbox (4)");
  // A row's issue open beside it keeps the inbox title.
  expect(titleOf({ to: "inbox", issue: "PLAT-7" }, data({ unread: 4 }))).toBe("Inbox (4)");
});

test("an issue page is `KEY Title`, led by the list it opened over (Ke + titlePrefix)", () => {
  expect(titleOf({ to: "issue", key: "PLAT-7" }, data())).toBe("PLAT-7 Fix login");
  expect(titleOf({ to: "issue", key: "PLAT-7", over: { to: "board", board: 1, scope: "all" } }, data())).toBe("All issues › PLAT-7 Fix login");
  expect(titleOf({ to: "issue", key: "PLAT-7", over: { to: "board", board: 1, scope: "active" } }, data())).toBe("Active › PLAT-7 Fix login");
  expect(titleOf({ to: "issue", key: "PLAT-7", over: { to: "board", board: 1, scope: "backlog" } }, data())).toBe("Backlog › PLAT-7 Fix login");
  expect(titleOf({ to: "issue", key: "PLAT-7", over: { to: "view", id: "v1" } }, data())).toBe("Bugs › PLAT-7 Fix login");
  expect(titleOf({ to: "issue", key: "PLAT-7", over: { to: "person", person: null, tab: "created" } }, data())).toBe("Created › PLAT-7 Fix login");
  expect(titleOf({ to: "issue", key: "PLAT-7", over: { to: "inbox" } }, data())).toBe("Inbox › PLAT-7 Fix login");
  // A profile and the view editor set no origin.
  expect(titleOf({ to: "issue", key: "PLAT-7", over: { to: "person", person: "u1", tab: "assigned" } }, data())).toBe("PLAT-7 Fix login");
  expect(titleOf({ to: "issue", key: "PLAT-7", over: { to: "editor" } }, data())).toBe("PLAT-7 Fix login");
});

test("an issue's tab follows its title, and a new issue Jira hasn't keyed shows its title alone (persistedOnBackend)", () => {
  const renamed = data({ issues: new Map([["PLAT-7", { key: "PLAT-7", summary: "Fix logout" }]]) });
  expect(titleOf({ to: "issue", key: "PLAT-7" }, renamed)).toBe("PLAT-7 Fix logout");
  expect(titleOf({ to: "issue", key: "PLAT-NEW1" }, data())).toBe("Draft idea");
  expect(titleOf({ to: "issue", key: "NOPE-1" }, data())).toBe("Not found");
});

test("a document is its own title, `New document` when untitled, with no origin", () => {
  expect(titleOf({ to: "issue", key: "PLAT-7", document: "d1", over: { to: "board", board: 1, scope: "all" } }, data())).toBe("Spec");
  expect(titleOf({ to: "issue", key: "PLAT-7", document: "d2" }, data())).toBe("New document");
  expect(titleOf({ to: "issue", key: "PLAT-7", document: "gone" }, data())).toBe("Not found");
});

test("navigation announcements: none for the first page, one per entry, a no-break space when repeated (rbi)", () => {
  let said = announcement({ message: "" }, "a", "Platform › All issues");
  expect(said).toEqual({ key: "a", message: "" });
  said = announcement(said, "b", "Inbox");
  expect(said.message).toBe("Navigated to Inbox");
  // The same entry again (a title edit, the count moving) says nothing new.
  expect(announcement(said, "b", "Inbox (2)")).toBe(said);
  said = announcement(said, "c", "Inbox");
  expect(said.message).toBe("Navigated to Inbox ");
});
