import type { Page } from "@playwright/test";
import { expect, test } from "./app";

const row = (page: Page, column: string, name: string) =>
  page.getByRole("grid", { name: column }).getByRole("row", { name, exact: true });

/** Opens Display options and checks which layout it says is on, then closes it. */
const layoutIs = async (page: Page, layout: "List" | "Board") => {
  await page.getByRole("button", { name: "Display options" }).click();
  const display = page.getByRole("dialog", { name: "Display options" });
  await expect(display.getByRole("tablist", { name: "Layout" }).getByRole("tab", { name: layout })).toHaveAttribute(
    "aria-selected",
    "true",
  );
  await page.keyboard.press("Escape");
  await expect(display).toHaveCount(0);
};

test("10. ⌘B switches between board and list, and display settings survive a reload", async ({ page, app }) => {
  await app.seed();
  const labels = page.getByRole("button", { name: "Labels on TEST-2" });
  // A board column is headed by its name; a list group by a button that collapses it.
  const boardColumn = page.getByRole("heading", { name: /^Todo 5/ });
  const listGroup = page.getByRole("button", { name: "Collapse Todo" });
  await expect(boardColumn).toBeVisible();
  await expect(listGroup).toHaveCount(0);
  await layoutIs(page, "Board");

  await page.keyboard.press("ControlOrMeta+b");
  await expect(listGroup).toBeVisible();
  await expect(boardColumn).toHaveCount(0);
  await expect(row(page, "Todo", "TEST-2 Browser fixture 2")).toBeVisible();
  await layoutIs(page, "List");

  // Hide the Labels property from the rows.
  await expect(labels).toHaveText("test");
  await page.getByRole("button", { name: "Display options" }).click();
  const display = page.getByRole("dialog", { name: "Display options" });
  await display.getByRole("button", { name: "Labels", exact: true }).click();
  await expect(display.getByRole("button", { name: "Labels", exact: true })).toHaveAttribute("aria-pressed", "false");
  await page.keyboard.press("Escape");
  await expect(labels).toHaveCount(0);

  await page.reload();
  await expect(listGroup).toBeVisible();
  await expect(row(page, "Todo", "TEST-2 Browser fixture 2")).toBeVisible();
  await expect(labels).toHaveCount(0);
  await layoutIs(page, "List");

  await page.keyboard.press("ControlOrMeta+b");
  await expect(boardColumn).toBeVisible();
  await expect(listGroup).toHaveCount(0);
  await page.reload();
  await expect(boardColumn).toBeVisible();
  await expect(row(page, "Todo", "TEST-2 Browser fixture 2")).toBeVisible();
  await expect(labels).toHaveCount(0);
  await layoutIs(page, "Board");
});

test("11. the sidebar switches spaces, and the Active, Backlog and All issues tabs switch which issues show", async ({ page, app }) => {
  await app.seed({ sharedBoards: true });
  const spaces = page.getByRole("navigation", { name: "Main navigation" });
  const breadcrumb = page.getByRole("navigation", { name: "Breadcrumb" });
  const squadOnly = row(page, "Todo", "SQUAD-1 Squad only issue");
  const auditOnly = row(page, "Todo", "TEST-1 Rich browser fixture");
  // On both boards.
  const shared = row(page, "Todo", "TEST-2 Browser fixture 2");

  await expect(auditOnly).toBeVisible();
  await expect(squadOnly).toHaveCount(0);
  await expect(breadcrumb.getByRole("link", { name: "Browser audit" })).toBeVisible();

  await spaces.getByRole("link", { name: "Squad board" }).click();
  await expect(breadcrumb.getByRole("link", { name: "Squad board" })).toBeVisible();
  await expect(squadOnly).toBeVisible();
  await expect(shared).toBeVisible();
  await expect(auditOnly).toHaveCount(0);

  await spaces.getByRole("link", { name: "Browser audit" }).click();
  await expect(breadcrumb.getByRole("link", { name: "Browser audit" })).toBeVisible();
  await expect(auditOnly).toBeVisible();
  await expect(squadOnly).toHaveCount(0);

  // TEST-6 goes to the backlog in Jira.
  const backlogged = row(page, "Backlog", "TEST-6 Browser fixture 6");
  await app.changeInJira({ key: "TEST-6", status: "backlog" });
  await expect(backlogged).toBeVisible();
  const tab = (name: string) => page.getByRole("main").getByRole("button", { name, exact: true });
  await expect(tab("All issues")).toHaveAttribute("aria-pressed", "true");

  await tab("Active").click();
  await expect(tab("Active")).toHaveAttribute("aria-pressed", "true");
  await expect(auditOnly).toBeVisible();
  await expect(row(page, "Doing", "TEST-3 Browser fixture 3")).toBeVisible();
  await expect(page.getByRole("grid", { name: "Backlog" })).toHaveCount(0);
  await expect(page.getByRole("row", { name: "TEST-6 Browser fixture 6", exact: true })).toHaveCount(0);

  await tab("Backlog").click();
  await expect(tab("Backlog")).toHaveAttribute("aria-pressed", "true");
  await expect(backlogged).toBeVisible();
  await expect(auditOnly).toHaveCount(0);
  await expect(page.getByRole("row", { name: "TEST-3 Browser fixture 3", exact: true })).toHaveCount(0);

  await tab("All issues").click();
  await expect(tab("All issues")).toHaveAttribute("aria-pressed", "true");
  await expect(backlogged).toBeVisible();
  await expect(auditOnly).toBeVisible();
  await expect(row(page, "Doing", "TEST-3 Browser fixture 3")).toBeVisible();
});
