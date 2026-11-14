import { expect, test } from "bun:test";
import { shortcutSections } from "./shortcut-panel";

test("the shortcuts panel puts General first and follows Linear's section order", () => {
  const rows = [
    { id: "document-rename", group: "Documents" },
    { id: "undo", group: "General" },
    { id: "shortcuts", group: "General" },
    { id: "editor-bold", group: "Editor" },
    { id: "comment", group: "Comments" },
    { id: "search", group: "General" },
    { id: "back", group: "General" },
    { id: "commands", group: "General" },
    { id: "inbox", group: "Navigation" },
    { id: "help", group: "General" },
    { id: "new", group: "Issues" },
    { id: "peek", group: "List / Board" },
    { id: "filter", group: "Filters" },
    { id: "inbox-read", group: "Inbox" },
  ];
  const sections = shortcutSections(rows);
  expect(sections.map((s) => s.group)).toEqual([
    "General",
    "Navigation",
    "Issues",
    "List / Board",
    "Comments",
    "Inbox",
    "Filters",
    "Editor",
    "Documents",
  ]);
  expect(sections[0]!.rows.map((r) => r.id)).toEqual(["commands", "back", "search", "help", "shortcuts", "undo"]);
});

test("R3-palette-shortcuts-D5: searching the caps a row draws finds it, so \"ctrl\" finds ⌃M as \"control\" and \"⌃\" do", async () => {
  const { shortcutMatches } = await import("./shortcut-panel");
  const row = { name: "Open comment", group: "Issues", hotkey: "Control+M" };
  for (const query of ["ctrl", "Ctrl M", "control", "⌃"]) expect(shortcutMatches(row, query, true)).toBe(true);
  // Off a Mac ⌘ is drawn as Ctrl too.
  expect(shortcutMatches({ name: "Open command menu", group: "General", hotkey: "Mod+K" }, "ctrl k", false)).toBe(true);
  expect(shortcutMatches({ name: "Change status", group: "Issues", hotkey: "S" }, "ctrl", true)).toBe(false);
  // A single letter stays a whole key name.
  expect(shortcutMatches({ name: "Set due date", group: "Issues", hotkey: "Shift+D" }, "shift d", true)).toBe(true);
  expect(shortcutMatches({ name: "Change priority", group: "Issues", hotkey: "P" }, "shift d", true)).toBe(false);
});
