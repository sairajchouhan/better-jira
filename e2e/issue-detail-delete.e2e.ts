import { expect, test } from "./app";
import type { Page } from "@playwright/test";

/** Opens an issue from its Todo card, then rests the pointer on the title so shortcuts act on the open issue, not a card. */
async function openIssue(page: Page, key: string, title: string) {
  await page
    .getByRole("grid", { name: "Todo" })
    .getByRole("row", { name: `${key} ${title}`, exact: true })
    .getByText(title, { exact: true })
    .click();
  const titleBox = page.getByRole("textbox", { name: "Issue title" });
  await expect(titleBox).toHaveValue(title);
  await titleBox.hover();
  return page.getByRole("complementary").filter({ has: titleBox });
}

test("31 deleting an issue asks first: Cancel keeps it, Delete removes it from Jira", async ({ page, app }) => {
  await app.seed({ writable: true });
  const row = (key: string, title: string) =>
    page.getByRole("grid", { name: "Todo" }).getByRole("row", { name: `${key} ${title}`, exact: true });
  const detail = await openIssue(page, "TEST-4", "Browser fixture 4");
  const confirm = page.getByRole("dialog", { name: /^Delete "TEST-4 . Browser fixture 4"\?$/ });
  const deletes = async () => (await app.jiraWrites()).flatMap((w) => w.ops.filter((op) => op.op === "delete"));

  await page.keyboard.press("ControlOrMeta+Backspace");
  await expect(confirm).toContainText("Jira can't restore deleted issues, so this can't be undone.");
  await confirm.getByRole("button", { name: "Cancel" }).click();
  await expect(confirm).toHaveCount(0);
  await expect(page.getByRole("textbox", { name: "Issue title" })).toHaveValue("Browser fixture 4");
  await expect(row("TEST-4", "Browser fixture 4")).toBeVisible();
  expect(await deletes()).toEqual([]);
  expect((await app.jiraIssue("TEST-4")).issue).not.toBeNull();

  await detail.getByRole("button", { name: "Issue options" }).click();
  await page.getByRole("dialog", { name: "Issue options" }).getByRole("menuitem", { name: "Delete" }).click();
  await confirm.getByRole("button", { name: "Delete", exact: true }).click();

  await expect(row("TEST-4", "Browser fixture 4")).toHaveCount(0);
  await expect(page.getByRole("textbox", { name: "Issue title" })).toHaveCount(0);
  await expect.poll(async () => (await app.jiraIssue("TEST-4")).issue).toBeNull();
  expect(await app.jiraWrites()).toEqual([{ key: "TEST-4", ops: [{ op: "delete" }] }]);
  await page.reload();
  await expect(row("TEST-2", "Browser fixture 2")).toBeVisible();
  await expect(row("TEST-4", "Browser fixture 4")).toHaveCount(0);
});

test("31 deleting an issue with a sub-issue says so, and both leave Jira and the board", async ({ page, app }) => {
  // BUG: the sub-issue Jira deleted with its parent stays on the board until the next 30 s poll or a reload.
  test.fail();
  await app.seed({ writable: true, subtask: true });
  const row = (key: string, title: string) =>
    page.getByRole("grid", { name: "Todo" }).getByRole("row", { name: `${key} ${title}`, exact: true });
  await openIssue(page, "TEST-5", "Browser fixture 5");
  const confirm = page.getByRole("dialog", { name: /^Delete "TEST-5 . Browser fixture 5"\?$/ });

  await page.keyboard.press("ControlOrMeta+Backspace");
  await expect(confirm).toContainText("This also deletes its 1 sub-issue (TEST-6).");
  await confirm.getByRole("button", { name: "Delete 2 issues" }).click();

  await expect(row("TEST-5", "Browser fixture 5")).toHaveCount(0);
  await expect.poll(async () => (await app.jiraIssue("TEST-5")).issue).toBeNull();
  expect((await app.jiraIssue("TEST-6")).issue).toBeNull();
  await expect(row("TEST-6", "Browser fixture 6")).toHaveCount(0);
});
