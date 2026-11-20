import { expect, test } from "./app";

const todoCard = (page: import("@playwright/test").Page) =>
  page.getByRole("grid", { name: "Todo" }).getByRole("row", { name: "TEST-2 Browser fixture 2", exact: true });

test("2. when Jira data fails to load, an error screen explains it and Try again opens the app", async ({ page, app }) => {
  // Four failed loads: the first and the automatic retries 1, 2 and 4 s later. The next automatic retry is 8 s away, so a
  // board that shows well before then came from Try again.
  await app.seed({ clientFailures: 4 });
  const error = page.getByRole("alert").filter({ has: page.getByRole("heading", { name: "Couldn't load your Jira data" }) });
  await expect(error).toBeVisible();
  await expect(error).toContainText("Retrying automatically…");
  await expect
    .poll(async () => (await app.requests()).filter((r) => r.path === "/api/client" && r.status === 503).length, {
      timeout: 15_000,
    })
    .toBe(4);
  await expect(todoCard(page)).toHaveCount(0);

  await error.getByRole("button", { name: "Try again" }).click();

  await expect(todoCard(page)).toBeVisible({ timeout: 5_000 });
  await expect(error).toHaveCount(0);
});

test("3. a first sync shows Syncing your Jira boards with its progress, then the app opens by itself", async ({ page, app }) => {
  await app.seed({ syncingReads: 2 });
  const waiting = page.getByRole("status").filter({ has: page.getByRole("heading", { name: "Syncing your Jira boards" }) });
  await expect(waiting).toBeVisible();
  await expect(waiting).toContainText("Board 1: 300 of 900 issues");
  await expect(todoCard(page)).toHaveCount(0);

  await expect(todoCard(page)).toBeVisible({ timeout: 10_000 });
  await expect(waiting).toHaveCount(0);
});

test("4. the footer says when Jira or the better-jira server can't be reached", async ({ page, app }) => {
  const footerAlert = page.getByRole("contentinfo").getByRole("alert", { name: "Jira sync status" });

  await app.seed({ syncErrors: ["Jira rejected the API token."] });
  await expect(todoCard(page)).toBeVisible();
  await expect(footerAlert).toHaveText("Not syncing with Jira: Jira rejected the API token.");

  await app.seed();
  await expect(todoCard(page)).toBeVisible();
  await expect(footerAlert).toHaveCount(0);
  // The server goes away for the property poll only; the event stream stays up to make the poll run at once.
  await page.route("**/api/properties*", (route) => route.abort());
  await app.changeInJira({ key: "TEST-2", summary: "Changed while the server is down" });
  await expect(footerAlert).toHaveText("Can't reach the better-jira server. Check that bun start is still running.");

  await page.unroute("**/api/properties*");
  await expect(footerAlert).toHaveCount(0, { timeout: 15_000 });
  await expect(
    page.getByRole("grid", { name: "Todo" }).getByRole("row", { name: "TEST-2 Changed while the server is down", exact: true }),
  ).toBeVisible();
});

test.fail("5. a screen whose code can't load while offline shows a network error, not an out-of-date tab", async ({ page, app }) => {
  // The inbox's code is held until the browser is offline, then fails as a dropped connection does, as Linear's chunks fail
  // offline (startup-root `Rv`: "> Network error", with Reload).
  const INBOX_CHUNK = /\/inbox-[^/]*\.js$/;
  let dropped!: () => void;
  const offline = new Promise<void>((resolve) => (dropped = resolve));
  await page.route(INBOX_CHUNK, async (route) => (await offline, route.abort("internetdisconnected")));
  await app.seed();
  await expect(todoCard(page)).toBeVisible();
  await page.context().setOffline(true);
  dropped();

  await page.getByRole("navigation", { name: "Main navigation" }).getByRole("link", { name: /^Inbox/ }).click();

  const error = page.getByRole("alert").filter({ has: page.getByRole("heading", { name: "Network error" }) });
  await expect(error).toBeVisible();
  await expect(error).toContainText("Something might be wrong with your internet connection.");
  await expect(page.getByText("This tab is out of date")).toHaveCount(0);

  await page.context().setOffline(false);
  await page.unroute(INBOX_CHUNK);
  await error.getByRole("button", { name: "Reload" }).click();
  await expect(page.getByRole("region", { name: "Inbox" })).toBeVisible();
});
