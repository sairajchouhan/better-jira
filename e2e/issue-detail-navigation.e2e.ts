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

test("29 Previous and Next, J and K, then browser Back and Forward walk the board's issues", async ({ page, app }) => {
  await app.seed();
  const detail = await openIssue(page, "TEST-2", "Browser fixture 2");
  const title = page.getByRole("textbox", { name: "Issue title" });
  const at = async (key: string, summary: string, position: string) => {
    await expect(title).toHaveValue(summary);
    await expect(detail.getByText(position, { exact: true })).toBeVisible();
    await expect(page).toHaveURL(new RegExp(`[?&]issue=${key}(&|$)`));
  };
  await at("TEST-2", "Browser fixture 2", "2 / 6");

  await detail.getByRole("button", { name: "Next" }).click();
  await at("TEST-4", "Browser fixture 4", "3 / 6");
  await title.hover();
  await page.keyboard.press("j");
  await at("TEST-5", "Browser fixture 5", "4 / 6");
  await page.keyboard.press("k");
  await at("TEST-4", "Browser fixture 4", "3 / 6");
  await detail.getByRole("button", { name: "Previous" }).click();
  await at("TEST-2", "Browser fixture 2", "2 / 6");

  await page.goBack();
  await at("TEST-4", "Browser fixture 4", "3 / 6");
  await page.goBack();
  await at("TEST-5", "Browser fixture 5", "4 / 6");
  await page.goForward();
  await at("TEST-4", "Browser fixture 4", "3 / 6");
  await page.goForward();
  await at("TEST-2", "Browser fixture 2", "2 / 6");
});

test("30 a link to an issue that doesn't exist shows Not found, and a real one opens", async ({ page, app, fixtureUrl }) => {
  await app.seed();

  await page.goto(`${fixtureUrl}/issue/NOPE-1`);
  await expect(page.getByRole("heading", { name: "Issue not found" })).toBeVisible();
  await expect(page.getByText("We could not find the page you were looking for")).toBeVisible();
  await expect(page).toHaveTitle(/Not found/);
  await expect(page.getByRole("textbox", { name: "Issue title" })).toHaveCount(0);

  await page.goto(`${fixtureUrl}/issue/TEST-4`);
  await expect(page.getByRole("textbox", { name: "Issue title" })).toHaveValue("Browser fixture 4");
  await expect(page.getByRole("heading", { name: "Issue not found" })).toHaveCount(0);
});
