import type { Page } from "@playwright/test";
import { expect, test } from "./app";

const palette = (page: Page) => page.getByRole("dialog", { name: "Search issues and commands" });
const title = (page: Page) => page.getByRole("textbox", { name: "Issue title" });
const column = (page: Page, name: string, key: string, summary: string) =>
  page.getByRole("grid", { name }).getByRole("row", { name: `${key} ${summary}`, exact: true });

/** Opens ⌘K once the board has loaded (a key pressed before then goes to the page). */
async function openPalette(page: Page) {
  await expect(column(page, "Todo", "TEST-1", "Rich browser fixture")).toBeVisible();
  await page.keyboard.press("ControlOrMeta+k");
  await expect(palette(page)).toBeVisible();
  return palette(page).getByRole("textbox", { name: "Search issues and commands" });
}

test("49. changing the open issue's status from ⌘K moves it and writes the status to Jira", async ({ page, app }) => {
  await app.seed({ writable: true });
  await column(page, "Todo", "TEST-2", "Browser fixture 2").getByText("Browser fixture 2", { exact: true }).click();
  await expect(title(page)).toHaveValue("Browser fixture 2");
  await openPalette(page);

  await palette(page).getByRole("menuitem", { name: "Change status…", exact: true }).click();
  await palette(page).getByRole("menuitem", { name: /^Doing\b/ }).click();

  await expect(palette(page)).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Doing", exact: true })).toBeVisible();
  await expect(column(page, "Doing", "TEST-2", "Browser fixture 2")).toBeVisible();
  await expect(column(page, "Todo", "TEST-2", "Browser fixture 2")).toHaveCount(0);
  await expect.poll(app.jiraWrites).toEqual([{ key: "TEST-2", ops: [{ op: "status", status: "doing" }] }]);
  expect((await app.jiraIssue("TEST-2")).issue.status).toBe("doing");

  await page.reload();
  await expect(title(page)).toHaveValue("Browser fixture 2");
  await expect(page.getByRole("button", { name: "Doing", exact: true })).toBeVisible();
  await expect(column(page, "Doing", "TEST-2", "Browser fixture 2")).toBeVisible();
  await expect(column(page, "Todo", "TEST-2", "Browser fixture 2")).toHaveCount(0);
});

test("50. ⌘K finds an issue by words from its title or by its key, and opens it", async ({ page, app }) => {
  await app.seed();
  const search = await openPalette(page);

  await search.fill("fixture 5");
  const results = palette(page).getByRole("menuitem");
  await expect(results).toHaveCount(1);
  await expect(results).toHaveText(/^TEST-5\s*Browser fixture 5/);
  await results.click();
  await expect(palette(page)).toHaveCount(0);
  await expect(title(page)).toHaveValue("Browser fixture 5");

  await page.keyboard.press("Escape");
  await expect(title(page)).toHaveCount(0);
  await openPalette(page);
  await search.fill("TEST-6");
  await expect(results.first()).toHaveText(/^TEST-6\s*Browser fixture 6/);
  await search.press("Enter");
  await expect(palette(page)).toHaveCount(0);
  await expect(title(page)).toHaveValue("Browser fixture 6");
});

test("51. a Jira issue link pasted into ⌘K puts that issue first, and Enter opens it", async ({ page, app }) => {
  await app.seed();
  const search = await openPalette(page);
  const results = palette(page).getByRole("menuitem");

  // Another Jira site's link names no issue here, even when the key matches one.
  await search.fill("https://partner.atlassian.net/browse/TEST-5");
  await expect(results).toHaveText(["No issues found for this link"]);

  await search.fill("https://example.atlassian.net/browse/TEST-5");
  await expect(results.first()).toHaveText(/^TEST-5\s*Browser fixture 5/);
  await search.press("Enter");
  await expect(palette(page)).toHaveCount(0);
  await expect(title(page)).toHaveValue("Browser fixture 5");
  expect(new URL(page.url()).searchParams.get("issue")).toBe("TEST-5");
});
