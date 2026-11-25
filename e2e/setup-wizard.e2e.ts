import { expect, test } from "./app";

test("unconfigured server opens Setup Wizard, validates Jira credentials, picks spaces, and launches straight into the board", async ({
  page,
  app,
}) => {
  await app.seed({ needsSetup: true });

  await expect(page.getByRole("heading", { name: "better-jira" })).toBeVisible();
  await expect(page.getByText("Connect your Jira Cloud account to get started.")).toBeVisible();

  const siteInput = page.getByLabel("Jira site");
  const emailInput = page.getByLabel("Atlassian email");
  const tokenInput = page.getByLabel("Jira API token");

  // Wrong token surfaces an inline error and stays on Step 1.
  await siteInput.fill("example.atlassian.net");
  await emailInput.fill("dev@example.com");
  await tokenInput.fill("bad-token");
  await page.getByRole("button", { name: "Continue" }).click();
  await expect(page.getByRole("alert")).toContainText("rejected your email and API token (401)");

  // Valid token connects and advances to Step 2 with searchable Jira spaces.
  await tokenInput.fill("good-token");
  await page.getByRole("button", { name: "Continue" }).click();
  await expect(page.getByText("Connected to example.atlassian.net")).toBeVisible();

  const list = page.getByRole("listbox", { name: "Jira spaces" });
  await expect(list.getByRole("option", { name: /Browser audit/i })).toBeVisible();
  await expect(list.getByRole("option", { name: /Second board/i })).toBeVisible();

  // Filter and select both boards.
  await page.getByRole("textbox", { name: "Search spaces or paste a Jira board link or ID" }).fill("TEST2");
  await expect(list.getByRole("option")).toHaveCount(1);
  await list.getByRole("option", { name: /Second board/i }).click();
  await expect(page.getByText("1 space selected")).toBeVisible();

  // Launch transitions straight into the live board with no page reload.
  await page.getByRole("button", { name: "Launch better-jira" }).click();
  await expect(page.getByRole("grid", { name: "Todo" }).getByRole("row").first()).toBeVisible();
  await expect(
    page.getByRole("navigation", { name: "Main navigation" }).getByRole("link", { name: "Second board" }),
  ).toBeVisible();
  await expect(page.getByRole("contentinfo")).toContainText("Edits write to Jira");
});
