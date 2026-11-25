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
/** Picks `item` in Issue options › `submenu`. */
async function issueOption(page: Page, submenu: string, item: string | RegExp) {
  await page.getByRole("button", { name: "Issue options" }).click();
  await page.getByRole("dialog", { name: "Issue options" }).getByRole("menuitem", { name: submenu }).hover();
  await page.getByRole("dialog", { name: submenu }).getByRole("menuitem", { name: item }).click();
}

test("26 a sub-issue's parent can be changed, and Jira takes the new parent", async ({ page, app }) => {
  await app.seed({ writable: true, subtask: true });
  const detail = await openIssue(page, "TEST-6", "Browser fixture 6");
  await expect(detail.getByRole("link", { name: "TEST-5 Browser fixture 5" })).toBeVisible();

  await page.keyboard.press("ControlOrMeta+Shift+p");
  await expect(page.getByRole("dialog", { name: "Issue relations" })).toBeVisible();
  await page.keyboard.type("TEST-4");
  await page.keyboard.press("Enter");

  await expect(detail.getByRole("link", { name: "TEST-4 Browser fixture 4" })).toBeVisible();
  await expect(detail.getByRole("link", { name: "TEST-5 Browser fixture 5" })).toHaveCount(0);
  await expect.poll(async () => (await app.jiraIssue("TEST-6")).issue.parent).toBe("TEST-4");
  await page.reload();
  await expect(detail.getByRole("link", { name: "TEST-4 Browser fixture 4" })).toBeVisible();
});

test("26 on a local site an issue's parent can be set and removed, and both survive a reload", async ({ page, app }) => {
  await app.seed();
  const detail = await openIssue(page, "TEST-4", "Browser fixture 4");
  const parent = detail.getByRole("link", { name: "TEST-2 Browser fixture 2" });

  await page.keyboard.press("ControlOrMeta+Shift+p");
  await expect(page.getByRole("dialog", { name: "Issue relations" })).toBeVisible();
  await page.keyboard.type("TEST-2");
  await page.keyboard.press("Enter");
  await expect(detail.getByText("Sub-issue of")).toBeVisible();
  await expect(parent).toBeVisible();
  await page.reload();
  await expect(parent).toBeVisible();

  await issueOption(page, "Remove", /^Parent issue TEST-2/);
  await expect(parent).toHaveCount(0);
  await expect(detail.getByText("Sub-issue of")).toHaveCount(0);
  await page.reload();
  await expect(page.getByRole("textbox", { name: "Issue title" })).toHaveValue("Browser fixture 4");
  await expect(parent).toHaveCount(0);
});

const relations = async (app: { jiraIssue(key: string): Promise<{ issue: any }> }, key: string) =>
  (await app.jiraIssue(key)).issue.relations ?? [];

for (const { kind, keys, inverse, removeName } of [
  { kind: "blocked by", keys: "b", inverse: "blocking", removeName: /^Blocking issue TEST-5/ },
  { kind: "blocking", keys: "x", inverse: "blocked", removeName: /^Blocked issue TEST-5/ },
  { kind: "related to", keys: "r", inverse: "related", removeName: /^Related issue TEST-5/ },
] as const)
  test(`27 marking an issue as ${kind} another links both in Jira, and removing it unlinks both`, async ({ page, app }) => {
    await app.seed({ writable: true });
    const detail = await openIssue(page, "TEST-4", "Browser fixture 4");
    const other = detail.getByRole("link", { name: "Browser fixture 5", exact: true });

    await page.keyboard.press("m");
    await page.keyboard.press(keys);
    await expect(page.getByRole("dialog", { name: "Issue relations" })).toBeVisible();
    await page.keyboard.type("TEST-5");
    await page.keyboard.press("Enter");

    await expect(other).toBeVisible();
    const kindHere = { blocking: "blocked", blocked: "blocking", related: "related" }[inverse];
    await expect.poll(() => relations(app, "TEST-4")).toEqual([{ key: "TEST-5", kind: kindHere }]);
    expect(await relations(app, "TEST-5")).toEqual([{ key: "TEST-4", kind: inverse }]);
    await page.reload();
    await expect(other).toBeVisible();

    await issueOption(page, "Remove", removeName);
    await expect(other).toHaveCount(0);
    await expect.poll(() => relations(app, "TEST-4")).toEqual([]);
    expect(await relations(app, "TEST-5")).toEqual([]);
    await page.reload();
    await expect(page.getByRole("textbox", { name: "Issue title" })).toHaveValue("Browser fixture 4");
    await expect(other).toHaveCount(0);
  });

test("27 a relation's own Remove button unlinks it in Jira", async ({ page, app }) => {
  await app.seed({ writable: true });
  const detail = await openIssue(page, "TEST-4", "Browser fixture 4");
  const other = detail.getByRole("link", { name: "Browser fixture 5", exact: true });
  await page.keyboard.press("m");
  await page.keyboard.press("r");
  await expect(page.getByRole("dialog", { name: "Issue relations" })).toBeVisible();
  await page.keyboard.type("TEST-5");
  await page.keyboard.press("Enter");
  await expect.poll(() => relations(app, "TEST-4")).toEqual([{ key: "TEST-5", kind: "related" }]);

  await other.hover();
  await detail.getByRole("button", { name: "Remove relation" }).click();

  await expect(other).toHaveCount(0);
  await expect.poll(() => relations(app, "TEST-4")).toEqual([]);
  expect(await relations(app, "TEST-5")).toEqual([]);
});

test("28 subscribing with ⇧S and unsubscribing from the button changes Jira's watchers", async ({ page, app }) => {
  await app.seed({ writable: true });
  const detail = await openIssue(page, "TEST-4", "Browser fixture 4");
  const watchers = async () => ((await app.jiraIssue("TEST-4")).issue.watchers ?? []).map((w: { id: string }) => w.id);

  await page.keyboard.press("Shift+s");
  await expect(detail.getByRole("button", { name: "Unsubscribe from issue" })).toBeVisible();
  await expect.poll(watchers).toContain("audit-me");

  await detail.getByRole("button", { name: "Unsubscribe from issue" }).click();
  await expect(detail.getByRole("button", { name: "Subscribe to issue" })).toBeVisible();
  await expect.poll(watchers).not.toContain("audit-me");
  expect((await app.jiraIssue("TEST-4")).issue.watching).toBe(false);

  await page.reload();
  await expect(detail.getByRole("button", { name: "Subscribe to issue" })).toBeVisible();
});
