import type { Page } from "@playwright/test";
import { expect, test, type App } from "./app";

/** The groups Jira's bell holds unread now, as the fixture's feed lists them. */
const jiraUnread = async (fixtureUrl: string) => {
  const feed = (await (await fetch(`${fixtureUrl}/api/inbox`)).json()) as { unread: { id: string }[] };
  return feed.unread.map((u) => u.id).sort();
};
const group = (n: number) => `ari:cloud:jira:fixture:issue/${n}`;
/** Every inbox write Jira received from the app since the seed, in order. */
const inboxWrites = async (app: App) =>
  (await app.requests())
    .filter((r) => r.method === "POST" && r.path === "/api/inbox")
    .map((r) => r.body as { action: string; groups?: string[] });
const inboxLink = (page: Page) => page.getByRole("navigation", { name: "Main navigation" }).getByRole("link", { name: /^Inbox/ });
const row = (page: Page, state: "Read" | "Unread", key: string) =>
  page.getByRole("region", { name: "Inbox" }).getByRole("link", { name: new RegExp(`^${state} ${key} `) });

test("52. the inbox lists notifications, and opening one marks it read in Jira", async ({ page, app, fixtureUrl }) => {
  await app.seed({ writable: true });
  await inboxLink(page).click();

  for (const key of ["TEST-2", "TEST-1", "TEST-3", "TEST-6", "OUT-9"]) await expect(row(page, "Unread", key)).toBeVisible();
  for (const key of ["TEST-4", "TEST-5"]) await expect(row(page, "Read", key)).toBeVisible();
  await expect(page.getByRole("heading", { name: "5 unread notifications" })).toBeVisible();
  await expect(inboxLink(page)).toHaveAccessibleName("Inbox 5");

  await row(page, "Unread", "TEST-1").click();

  await expect(page.getByRole("textbox", { name: "Issue title" })).toHaveValue("Rich browser fixture");
  await expect(row(page, "Read", "TEST-1")).toBeVisible();
  await expect(inboxLink(page)).toHaveAccessibleName("Inbox 4");
  await expect.poll(() => jiraUnread(fixtureUrl)).toEqual([2, 3, 6, 9].map(group).sort());
  expect(await inboxWrites(app)).toContainEqual({ action: "read", groups: [group(1)] });

  await page.reload();
  await expect(row(page, "Read", "TEST-1")).toBeVisible();
  await expect(page.getByRole("textbox", { name: "Issue title" })).toHaveValue("Rich browser fixture");
  await expect(inboxLink(page)).toHaveAccessibleName("Inbox 4");
});

test.fail("52. a notification marked unread offline stays unread, and Jira gets it once the browser is back online", async ({ page, app, fixtureUrl }) => {
  await app.seed({ writable: true });
  await inboxLink(page).click();
  await row(page, "Read", "TEST-4").click();
  await expect(page.getByRole("textbox", { name: "Issue title" })).toBeVisible();
  const unreadWrites = async () => (await inboxWrites(app)).filter((w) => w.action === "unread");

  await page.context().setOffline(true);
  await page.keyboard.press("u");

  // Linear keeps the mark and queues the write (startup-entry `CF.markAllAsUnread`: `markAsUnread()` then a plain `save()`).
  await expect(row(page, "Unread", "TEST-4")).toBeVisible();
  await page.waitForTimeout(1500);
  await expect(row(page, "Unread", "TEST-4")).toBeVisible();
  await expect(page.getByText("Update failed")).toHaveCount(0);
  expect(await unreadWrites()).toEqual([]);

  await page.context().setOffline(false);
  await expect.poll(unreadWrites).toEqual([{ action: "unread", groups: [group(4)] }]);
  await expect.poll(() => jiraUnread(fixtureUrl)).toContain(group(4));

  await page.reload();
  await expect(row(page, "Unread", "TEST-4")).toBeVisible();
  expect(await unreadWrites()).toEqual([{ action: "unread", groups: [group(4)] }]);
});

test("53. mark all as read, then undo, and Jira receives both", async ({ page, app, fixtureUrl }) => {
  await app.seed({ writable: true });
  const before = [1, 2, 3, 6, 9].map(group).sort();
  await inboxLink(page).click();
  await expect(row(page, "Unread", "TEST-1")).toBeVisible();
  expect(await jiraUnread(fixtureUrl)).toEqual(before);

  await page.getByRole("button", { name: "Notification actions" }).click();
  await page.getByRole("menuitem", { name: /Mark all as read/ }).click();

  for (const key of ["TEST-2", "TEST-1", "TEST-3", "TEST-6", "OUT-9"]) await expect(row(page, "Read", key)).toBeVisible();
  await expect(inboxLink(page)).toHaveAccessibleName("Inbox");
  await expect.poll(() => jiraUnread(fixtureUrl)).toEqual([]);
  expect(await inboxWrites(app)).toContainEqual({ action: "read-all" });

  await page.keyboard.press("z");

  for (const key of ["TEST-2", "TEST-1", "TEST-3", "TEST-6", "OUT-9"]) await expect(row(page, "Unread", key)).toBeVisible();
  await expect(inboxLink(page)).toHaveAccessibleName("Inbox 5");
  await expect.poll(() => jiraUnread(fixtureUrl)).toEqual(before);
  expect((await inboxWrites(app)).filter((s) => s.action === "unread").flatMap((s) => s.groups!).sort()).toEqual(before);

  await page.reload();
  for (const key of ["TEST-2", "TEST-1", "TEST-3", "TEST-6", "OUT-9"]) await expect(row(page, "Unread", key)).toBeVisible();
  await expect(page.getByRole("heading", { name: "5 unread notifications" })).toBeVisible();
  await expect(inboxLink(page)).toHaveAccessibleName("Inbox 5");
});

test("54. a new notification arrives live and the badge updates", async ({ page, app }) => {
  await app.seed({ writable: true });
  await expect(page.getByRole("grid", { name: "Todo" }).getByRole("row").first()).toBeVisible();
  await expect(inboxLink(page)).toHaveAccessibleName("Inbox 5");

  // Group 7 holds no notification yet, so this one adds an unread group rather than replacing one.
  await app.pushInbox({ n: 7, key: "TEST-7", title: "Arrived live", message: "Priya assigned a task to you" });

  await expect(inboxLink(page)).toHaveAccessibleName("Inbox 6");
  await inboxLink(page).click();
  await expect(row(page, "Unread", "TEST-7")).toBeVisible();
  await expect(row(page, "Unread", "TEST-7")).toContainText("Priya assigned the task to you");
  await expect(page.getByRole("heading", { name: "6 unread notifications" })).toBeVisible();
});

test("55. a comment notification opens the issue at that comment", async ({ page, app }) => {
  await app.seed({ writable: true, threadedComments: true });
  // A long description puts the comments below the fold, so only the jump to the comment brings it into view.
  await app.changeInJira({
    key: "TEST-4",
    description: Array.from({ length: 40 }, (_, i) => `Made-up paragraph ${i + 1} that pushes the activity down.`).join("\n\n"),
  });
  await inboxLink(page).click();

  await row(page, "Read", "TEST-4").click();

  await expect(page.getByRole("textbox", { name: "Issue title" })).toHaveValue("Browser fixture 4");
  await expect(page.getByText("Made-up paragraph 40 that pushes the activity down.", { exact: true })).toBeAttached();
  await expect(page.getByText("Reply made in Jira")).toBeInViewport();
  await expect(page.getByText("Made-up paragraph 1 that pushes the activity down.", { exact: true })).not.toBeInViewport();
  expect(new URL(page.url()).hash).toBe("#comment-10101");
});
