import type { Page } from "@playwright/test";
import { expect, test } from "./app";

const ISSUES = {
  "TEST-1": "Rich browser fixture",
  "TEST-2": "Browser fixture 2",
  "TEST-3": "Browser fixture 3",
  "TEST-4": "Browser fixture 4",
  "TEST-5": "Browser fixture 5",
  "TEST-6": "Browser fixture 6",
};
type Key = keyof typeof ISSUES;
const KEYS = Object.keys(ISSUES) as Key[];

const row = (page: Page, key: Key) =>
  page.getByRole("main").getByRole("row", { name: `${key} ${ISSUES[key]}`, exact: true });

/** The page lists exactly these of the six fixture issues. */
async function expectShown(page: Page, keys: Key[]) {
  for (const key of KEYS) {
    if (keys.includes(key)) await expect(row(page, key)).toBeVisible();
    else await expect(row(page, key)).toHaveCount(0);
  }
}

/** Picks values from a property in the open Filter menu, then closes it. */
async function pickFilter(page: Page, property: string, values: RegExp[]) {
  await page.getByRole("menuitem", { name: property, exact: true }).click();
  for (const value of values) await page.getByRole("menuitemcheckbox", { name: value }).click();
  await page.keyboard.press("Escape");
  await expect(page.getByRole("dialog")).toHaveCount(0);
}

const sidebar = (page: Page) => page.getByRole("navigation", { name: "Main navigation" });
const viewHeading = (page: Page, name: string) =>
  page.getByRole("list", { name: "Breadcrumbs" }).getByRole("heading", { name, exact: true });

/** Makes a view from the sidebar's New view with one filter; answers its link. */
async function createView(page: Page, name: string, property: string, value: RegExp) {
  await expect(row(page, "TEST-1")).toBeVisible();
  await sidebar(page).getByRole("button", { name: "New view", exact: true }).click();
  await page.getByRole("textbox", { name: "View name" }).fill(name);
  await page.getByRole("button", { name: "Add filter" }).click();
  await pickFilter(page, property, [value]);
  await page.getByRole("button", { name: "Create view" }).click();
  await expect(viewHeading(page, name)).toBeVisible();
  await expect(sidebar(page).getByRole("link", { name, exact: true })).toBeVisible();
  return page.url();
}

test("12. a filter can be added, edited and cleared, and survives a reload", async ({ page, app }) => {
  await app.seed();
  const filters = page.getByRole("group", { name: "Temporary filters" });
  const operator = filters.getByRole("button", { name: "priority operator" });
  const value = filters.getByRole("button", { name: "priority value" });
  await expectShown(page, KEYS);

  await page.getByRole("button", { name: "Add filter" }).click();
  await pickFilter(page, "Priority", [/^Urgent/]);
  await expect(value).toHaveText("Urgent");
  await expectShown(page, ["TEST-4"]);

  await value.click();
  await page.getByRole("menuitemcheckbox", { name: /^High/ }).click();
  await page.keyboard.press("Escape");
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expect(operator).toHaveText("is any of");
  await expect(value).toHaveText("2 priorities");
  await expectShown(page, ["TEST-3", "TEST-4"]);

  await operator.click();
  await page.getByRole("menuitem", { name: "is not", exact: true }).click();
  await expect(operator).toHaveText("is not");
  await expectShown(page, ["TEST-1", "TEST-2", "TEST-5", "TEST-6"]);

  await page.reload();
  await expect(operator).toHaveText("is not");
  await expect(value).toHaveText("2 priorities");
  await expectShown(page, ["TEST-1", "TEST-2", "TEST-5", "TEST-6"]);

  await filters.getByRole("button", { name: "Clear", exact: true }).click();
  await expect(filters).toHaveCount(0);
  await expectShown(page, KEYS);
  await page.reload();
  await expectShown(page, KEYS);
  await expect(filters).toHaveCount(0);
});

test("13. find in view (⌘F) narrows the board to matching issues, and closing it brings them back", async ({ page, app }) => {
  await app.seed();
  const find = page.getByRole("searchbox", { name: "Find in view…" });
  await expectShown(page, KEYS);

  await page.keyboard.press("ControlOrMeta+f");
  await expect(find).toBeFocused();
  await page.keyboard.type("fixture 4");
  await expectShown(page, ["TEST-4"]);

  await find.fill("TEST-6");
  await expectShown(page, ["TEST-6"]);

  await page.keyboard.press("Escape");
  await expect(find).toHaveCount(0);
  await expectShown(page, KEYS);
});

test("14. a saved view is made with its filter, and its link reopens it after a reload", async ({ page, app, browser }) => {
  await app.seed();
  const link = await createView(page, "Urgent work", "Priority", /^Urgent/);
  expect(new URL(link).pathname).toMatch(/^\/view\/urgent-work-/);
  await expectShown(page, ["TEST-4"]);

  await page.reload();
  await expect(viewHeading(page, "Urgent work")).toBeVisible();
  await expectShown(page, ["TEST-4"]);

  await sidebar(page).getByRole("link", { name: "Browser audit", exact: true }).click();
  await expectShown(page, KEYS);
  await sidebar(page).getByRole("link", { name: "Urgent work", exact: true }).click();
  await expect(viewHeading(page, "Urgent work")).toBeVisible();
  await expectShown(page, ["TEST-4"]);

  // The link opens the view in a browser that never saw it: the view lives on the server, not in this tab.
  const other = await browser.newContext();
  const fresh = await other.newPage();
  await fresh.goto(link);
  await expect(viewHeading(fresh, "Urgent work")).toBeVisible();
  await expectShown(fresh, ["TEST-4"]);
  await other.close();
});

test("15. a filter added to a saved view is saved into it, for this browser and others", async ({ page, app, browser }) => {
  await app.seed();
  const link = await createView(page, "Test work", "Labels", /^test/);
  const temporary = page.getByRole("group", { name: "Temporary filters" });
  await expectShown(page, ["TEST-2", "TEST-3", "TEST-4", "TEST-5", "TEST-6"]);

  await page.getByRole("button", { name: "Add filter" }).click();
  await pickFilter(page, "Priority", [/^Urgent/]);
  await expect(temporary).toBeVisible();
  await expectShown(page, ["TEST-4"]);

  await temporary.getByRole("button", { name: "Save", exact: true }).click();
  await page.getByRole("menuitem", { name: "Save to this view" }).click();
  await expect(temporary).toHaveCount(0);
  await expectShown(page, ["TEST-4"]);

  await page.reload();
  await expect(viewHeading(page, "Test work")).toBeVisible();
  await expect(temporary).toHaveCount(0);
  await expectShown(page, ["TEST-4"]);

  const other = await browser.newContext();
  const fresh = await other.newPage();
  await fresh.goto(link);
  await expect(viewHeading(fresh, "Test work")).toBeVisible();
  await expectShown(fresh, ["TEST-4"]);
  await other.close();
});

/** The ways a user can ask to delete the open saved view "Doomed view"; each leads to the same confirmation.
 *  BUG (`broken`): Delete in these menus closes the menu and never asks or deletes; the command menu works. */
const deleteFrom: Record<string, { broken?: true; open(page: Page): Promise<void> }> = {
  "its options menu": {
    broken: true,
    async open(page) {
      await page.getByRole("button", { name: "Issue view options" }).click();
      await page.getByRole("menuitem", { name: "Delete", exact: true }).click();
    },
  },
  "View details ⋯": {
    broken: true,
    async open(page) {
      await page.getByRole("complementary", { name: "View details" }).getByRole("button", { name: "View details options" }).click();
      await page.getByRole("menuitem", { name: "Delete", exact: true }).click();
    },
  },
  "its sidebar right-click menu": {
    broken: true,
    async open(page) {
      await sidebar(page).getByRole("link", { name: "Doomed view", exact: true }).click({ button: "right" });
      await page.getByRole("menuitem", { name: "Delete", exact: true }).click();
    },
  },
  "the command menu": {
    async open(page) {
      await page.keyboard.press("ControlOrMeta+k");
      await page.keyboard.type("Delete view");
      await page.keyboard.press("Enter");
    },
  },
};
for (const [entry, { broken, open }] of Object.entries(deleteFrom))
  test(`15. a saved view is deleted from ${entry} after asking, and stays gone after a reload`, async ({ page, app }) => {
    if (broken) test.fail();
    await app.seed();
    await createView(page, "Doomed view", "Priority", /^Urgent/);
    const link = sidebar(page).getByRole("link", { name: "Doomed view", exact: true });

    await open(page);
    const confirm = page.getByRole("dialog", { name: 'Delete the view "Doomed view"?' });
    await expect(confirm).toBeVisible();
    await confirm.getByRole("button", { name: "Delete", exact: true }).click();

    await expect(confirm).toHaveCount(0);
    await expect(link).toHaveCount(0);
    await page.reload();
    await expect(sidebar(page).getByRole("link", { name: "Browser audit", exact: true })).toBeVisible();
    await expect(link).toHaveCount(0);
  });
