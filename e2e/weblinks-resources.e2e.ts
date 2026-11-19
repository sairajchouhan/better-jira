import { expect, test } from "./app";

test("48. a web link added to an issue is a remote link in Jira, and removing it removes it there", async ({ page, app }) => {
  await app.seed({ writable: true });
  await page
    .getByRole("grid", { name: "Todo" })
    .getByRole("row", { name: "TEST-2 Browser fixture 2", exact: true })
    .getByText("Browser fixture 2", { exact: true })
    .click();
  await expect(page.getByRole("textbox", { name: "Issue title" })).toHaveValue("Browser fixture 2");
  const remoteLinks = async () => (await app.jiraIssue("TEST-2")).full.remotelinks;
  const resources = page.getByRole("region", { name: "Resources" });
  const link = resources.getByRole("link", { name: "Example Domain" });

  await page.keyboard.press("Control+l");
  const form = page.getByRole("dialog", { name: "Add link" });
  await form.getByRole("textbox", { name: "URL", exact: true }).fill("https://example.com/handbook");
  await form.getByRole("button", { name: "Add link" }).click();

  await expect(link).toHaveAttribute("href", "https://example.com/handbook");
  await expect.poll(remoteLinks).toEqual([expect.objectContaining({ url: "https://example.com/handbook" })]);
  await page.reload();
  await expect(link).toBeVisible();

  await link.hover();
  await resources.getByRole("button", { name: "Options for https://example.com/handbook" }).click();
  await page.getByRole("menuitem", { name: "Remove…" }).click();
  await page.getByRole("dialog", { name: "Remove this link from the issue?" }).getByRole("button", { name: "Remove" }).click();

  await expect(link).toHaveCount(0);
  await expect.poll(remoteLinks).toEqual([]);
  await page.reload();
  await expect(page.getByRole("textbox", { name: "Issue title" })).toHaveValue("Browser fixture 2");
  await expect(link).toHaveCount(0);
});

test("48. Issue options › Add link… opens the link form, and the link it adds lands in Jira", async ({ page, app }) => {
  // BUG: the menu closes and no Add link form opens (Ctrl+L opens it).
  test.fail();
  await app.seed({ writable: true });
  await page
    .getByRole("grid", { name: "Todo" })
    .getByRole("row", { name: "TEST-2 Browser fixture 2", exact: true })
    .getByText("Browser fixture 2", { exact: true })
    .click();
  await expect(page.getByRole("textbox", { name: "Issue title" })).toHaveValue("Browser fixture 2");

  await page.getByRole("button", { name: "Issue options" }).click();
  await page.getByRole("menuitem", { name: "Add link…" }).click();
  const form = page.getByRole("dialog", { name: "Add link" });
  await expect(form).toBeVisible();
  await form.getByRole("textbox", { name: "URL", exact: true }).fill("https://example.com/from-menu");
  await form.getByRole("button", { name: "Add link" }).click();

  await expect(page.getByRole("region", { name: "Resources" }).getByRole("link", { name: "Example Domain" })).toBeVisible();
  await expect
    .poll(async () => (await app.jiraIssue("TEST-2")).full.remotelinks)
    .toEqual([expect.objectContaining({ url: "https://example.com/from-menu" })]);
});
