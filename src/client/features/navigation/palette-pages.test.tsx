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
