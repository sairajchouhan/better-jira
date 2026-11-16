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
