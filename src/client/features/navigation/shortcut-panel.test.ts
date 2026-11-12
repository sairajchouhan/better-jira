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
