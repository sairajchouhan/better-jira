import { expect, test } from "./app";

test("Add space lists Jira boards, filters live, and adds a space on click without leaving the app", async ({
  page,
  app,
}) => {
  await app.seed();
  await expect(page.getByRole("grid", { name: "Todo" }).getByRole("row").first()).toBeVisible();

  await page.getByRole("button", { name: "Add space" }).click();
  const dialog = page.getByRole("dialog", { name: "Add space" });
  await expect(dialog).toBeVisible();

  // Both fixture spaces load; board 1 is already marked Added and board 2 is ready to add.
  const list = dialog.getByRole("listbox", { name: "Jira spaces" });
  await expect(list.getByRole("option", { name: /Browser audit/i })).toContainText("Added");
  await expect(list.getByRole("option", { name: /Second board/i })).toBeVisible();

  // Filtering by project key narrows immediately to board 2.
  const input = dialog.getByRole("textbox", { name: "Search spaces or paste a Jira board link or ID" });
  await input.fill("TEST2");
  await expect(list.getByRole("option")).toHaveCount(1);
  await expect(list.getByRole("option", { name: /Second board/i })).toBeVisible();

  // Clicking Second board adds it immediately, closes the dialog, navigates to it, and records zero Jira trips.
  await list.getByRole("option", { name: /Second board/i }).click();
  await expect(dialog).toHaveCount(0);
  await expect(page.getByRole("navigation", { name: "Main navigation" }).getByRole("link", { name: "Second board" })).toBeVisible();
  await expect(page.getByText("Added Second board.")).toBeVisible();
  expect(await app.trips()).toEqual([]);

  // Reopening Add space now shows Second board as Added; Remove takes it back off the sidebar cleanly.
  await page.getByRole("button", { name: "Add space" }).click();
  await expect(dialog.getByRole("option", { name: /Second board/i })).toContainText("Added");
  await dialog.getByRole("button", { name: "Remove Second board" }).click();
  await expect(page.getByText("Removed Second board")).toBeVisible();
  await expect(page.getByRole("navigation", { name: "Main navigation" }).getByRole("link", { name: "Second board" })).toHaveCount(0);
  await expect(dialog.getByRole("option", { name: /Second board/i })).not.toContainText("Added");

  // Add it back, then remove it via the sidebar right-click menu.
  await dialog.getByRole("option", { name: /Second board/i }).click();
  await expect(dialog).toHaveCount(0);
  const secondLink = page.getByRole("navigation", { name: "Main navigation" }).getByRole("link", { name: "Second board" });
  await expect(secondLink).toBeVisible();
  await secondLink.click({ button: "right" });
  await page.getByRole("menuitem", { name: "Remove from sidebar" }).click();
  await expect(secondLink).toHaveCount(0);
  await expect(page.getByRole("navigation", { name: "Breadcrumb" }).getByRole("link", { name: "Browser audit" })).toBeVisible();
});

test("Add space still accepts a pasted Jira board link when board listing fails", async ({ page, app }) => {
  await app.seed({ availableBoardsFailure: true });
  await expect(page.getByRole("grid", { name: "Todo" }).getByRole("row").first()).toBeVisible();

  await page.getByRole("button", { name: "Add space" }).click();
  const dialog = page.getByRole("dialog", { name: "Add space" });
  await expect(dialog.getByText(/Jira couldn't list boards/)).toBeVisible();

  const input = dialog.getByRole("textbox", { name: "Search spaces or paste a Jira board link or ID" });
  await input.fill("https://example.atlassian.net/jira/software/projects/TEST2/boards/2");
  await dialog.getByRole("button", { name: "Add space" }).click();

  await expect(dialog).toHaveCount(0);
  await expect(page.getByRole("navigation", { name: "Main navigation" }).getByRole("link", { name: "Second board" })).toBeVisible();
});

test("Add space shows shimmer skeletons and GridLoader while loading, and BoardHeader shows hourglass syncing pill while background history streams", async ({
  page,
  app,
}) => {
  await app.seed({ streaming: 2 });
  await expect(page.getByRole("grid", { name: "Todo" }).getByRole("row").first()).toBeVisible();

  // While a space's background history is streaming, the BoardHeader shows Linear's hourglass syncing pill.
  const syncingPill = page.getByRole("status", { name: "Syncing space issues" });
  await expect(syncingPill).toBeVisible();
  await expect(syncingPill).toContainText("Syncing 100 / 900");
  await expect(syncingPill.locator('[data-loader-variant="hourglass"]')).toBeVisible();

  // Hold /api/boards/available so the shimmer skeletons + scope GridLoader are visibly rendered before resolving.
  let release!: () => void;
  const gate = new Promise<void>((resolve) => (release = resolve));
  await page.route(
    "**/api/boards/available*",
    async (route) => {
      await gate;
      await route.continue();
    },
    { times: 1 },
  );

  await page.getByRole("button", { name: "Add space" }).click();
  const dialog = page.getByRole("dialog", { name: "Add space" });
  await expect(dialog.locator('[data-loader-variant="scope"]')).toBeVisible();
  await expect(dialog.locator(".ui-skeleton").first()).toBeVisible();

  release();
  await expect(dialog.getByRole("option", { name: /Second board/i })).toBeVisible();
  await expect(dialog.locator(".ui-skeleton")).toHaveCount(0);
});
