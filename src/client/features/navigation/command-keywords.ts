/**
 * The words ⌘K also finds a command by: Linear's `keywords` on the same action (startup-root.CnUSfl4j.js and
 * startup-entry.Dt5YDWdY.js), keyed by our registry id. They feed the secondary string of `actionScore`, so "revert" finds Undo,
 * "hide sidebar" the sidebar toggle and "goto" Open document. Commands Linear gives no keywords (git branch, status, priority,
 * assign, comment, assign to me, pull requests) have none here either.
 */
export const COMMAND_KEYWORDS: Readonly<Record<string, string>> = {
  // `Undo` / `Redo` (General).
  undo: "wtf revert redo fuck shit ffs",
  redo: "wtf again undo",
  // Help's "Keyboard shortcuts".
  shortcuts: "help documentation docs guide",
  // "Collapse/Expand navigation sidebar".
  sidebar: "hide show sidebar",
  "customize-sidebar": "customize sidebar navigation",
  // "Preferences" (Go, G then S).
  preferences: "go preferences account user personal",
  // Navigation: Open issue / document / user, the Go to scopes, Open favorite.
  "open-issue": "recent search",
  "open-document": "goto",
  "open-user": "goto member",
  "favorite-open": "goto",
  // Linear's Team is called Space here (user's call, 2026-11-14): "team" and "board" still find Open space, Add space and Go to space N.
  "team-open": "team board",
  "board-add": "team board",
  ...Object.fromEntries(Array.from({ length: 9 }, (_, i) => [`team-${i + 1}`, "team board"])),
  active: "open",
  backlog: "open",
  all: "open",
  inbox: "open",
  mine: "open my issues",
  // Views and display.
  "view-create": "new custom",
  "view-save": "add",
  display: "view preferences display options",
  // useGroupingMenu `d` ("grouping") and useOrderingMenu `_` (its values' "order ordering").
  grouping: "grouping",
  ordering: "order ordering",
  "copy-page": "url link",
  "toast-open": "go to recently created last latest open recent notification",
  // Notifications.
  "inbox-snooze": "snooze reminder sleep",
  "inbox-delete-read": "clear",
  // Issues.
  new: "new ticket task make",
  due: "deadline due",
  remind: "snooze reminder",
  project: "project move add to epic",
  rename: "title",
  delete: "trash archive remove",
  subscribe: "notify notification",
  labels: "add change tag",
  blocked: "blocks block relation related reference mark",
  blocking: "blocks block relation related reference mark",
  related: "relation related reference relate ref mark",
  "parent-set": "child add convert sub-issue subissue change set parent make mark",
  "sub-issue": "child create subissue",
  link: "attach url",
  // The issue Copy actions (zmt, sM, uM, lM, wX).
  "copy-id": "identifier url linkified markdown md html",
  "copy-url": "share link url",
  "copy-title": "name",
  "copy-link": "url linkified markdown md html",
  "copy-issue-markdown": "md llm",
  "copy-prompt": "prompt",
};
/** The open view's ⌘K rows (JD and Views in startup-root), keyed by their name. */
export const VIEW_COMMAND_KEYWORDS: Readonly<Record<string, string>> = {
  "Create view…": "new custom",
  "Edit view…": "modify custom",
  "Delete view": "remove",
  "Make a copy as new view…": "duplicate custom",
};
