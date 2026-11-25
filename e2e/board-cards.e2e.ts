import type { Locator, Page } from "@playwright/test";
import { expect, test } from "./app";

const column = (page: Page, name: string) => page.getByRole("grid", { name });
/** The issue keys a column shows, top to bottom. */
const order = async (page: Page, name: string) =>
  (await column(page, name).getByRole("row").allTextContents()).flatMap((text) => text.match(/TEST-\d+/) ?? []);
/** The issue keys Jira holds in `status`, in Jira's rank order. */
const jiraOrder = async (app: { jiraIssues(): Promise<any[]> }, status: string) =>
  (await app.jiraIssues())
    .filter((i) => i.status === status)
    .sort((a, b) => (a.rank < b.rank ? -1 : a.rank > b.rank ? 1 : 0))
    .map((i) => i.key);
/** What a card control's tooltip says: its icon's only words. */
const tooltip = async (page: Page, control: Locator, text: string) => {
  await control.hover();
  await expect(page.getByRole("tooltip")).toHaveText(text);
};
const saved = (page: Page) => expect(page.getByRole("status", { name: "Jira save status" })).toHaveText("Saved to Jira");

test("7. reordering a card within its column saves the new order to Jira and keeps it after a reload", async ({ page, app }) => {
  await app.seed({ writable: true });
  const todo = column(page, "Todo");
  await expect.poll(() => order(page, "Todo")).toEqual(["TEST-1", "TEST-2", "TEST-4", "TEST-5", "TEST-6"]);

  await todo
    .getByRole("row", { name: "TEST-6 Browser fixture 6", exact: true })
    .getByText("Browser fixture 6", { exact: true })
    .dragTo(todo.getByRole("row", { name: "TEST-2 Browser fixture 2", exact: true }));

  // A card dropped on another lands right after it, as in Linear.
  const moved = ["TEST-1", "TEST-2", "TEST-6", "TEST-4", "TEST-5"];
  await expect.poll(() => order(page, "Todo")).toEqual(moved);
  await expect
    .poll(app.jiraWrites)
    .toContainEqual({ key: "TEST-6", ops: [expect.objectContaining({ op: "rank" })] });
  await saved(page);
  expect(await jiraOrder(app, "todo")).toEqual(moved);

  await page.reload();
  await expect(todo.getByRole("row").first()).toBeVisible();
  await expect.poll(() => order(page, "Todo")).toEqual(moved);
});

test("8. a selected card moves between columns with ⌥←/→ and within its column with ⌥↑/↓", async ({ page, app }) => {
  await app.seed({ writable: true });
  const todo = column(page, "Todo");
  const doing = column(page, "Doing");
  const card = (grid = todo) => grid.getByRole("row", { name: "TEST-2 Browser fixture 2", exact: true });
  await expect(card()).toBeVisible();

  await page.keyboard.press("j");
  await page.keyboard.press("j");
  await expect(card()).toHaveAttribute("aria-selected", "true");

  await page.keyboard.press("Alt+ArrowRight");
  await expect(card(doing)).toBeVisible();
  await expect(card(todo)).toHaveCount(0);
  await expect.poll(app.jiraWrites).toContainEqual({ key: "TEST-2", ops: expect.arrayContaining([{ op: "status", status: "doing" }]) });
  await saved(page);

  // TEST-2 ranks above TEST-3 in Jira, so it lands first in Doing.
  await expect.poll(() => order(page, "Doing")).toEqual(["TEST-2", "TEST-3"]);
  await page.keyboard.press("Alt+ArrowDown");
  await expect.poll(() => order(page, "Doing")).toEqual(["TEST-3", "TEST-2"]);
  await expect.poll(app.jiraWrites).toContainEqual({ key: "TEST-2", ops: [{ op: "rank", after: "TEST-3" }] });
  await saved(page);
  expect(await jiraOrder(app, "doing")).toEqual(["TEST-3", "TEST-2"]);

  await page.keyboard.press("Alt+ArrowUp");
  await expect.poll(() => order(page, "Doing")).toEqual(["TEST-2", "TEST-3"]);
  await expect.poll(app.jiraWrites).toContainEqual({ key: "TEST-2", ops: [{ op: "rank", before: "TEST-3" }] });
  await saved(page);
  expect(await jiraOrder(app, "doing")).toEqual(["TEST-2", "TEST-3"]);

  await page.keyboard.press("Alt+ArrowDown");
  await expect.poll(() => order(page, "Doing")).toEqual(["TEST-3", "TEST-2"]);
  await saved(page);
  await page.keyboard.press("Alt+ArrowLeft");
  await expect(card(todo)).toBeVisible();
  await expect.poll(app.jiraWrites).toContainEqual({ key: "TEST-2", ops: expect.arrayContaining([{ op: "status", status: "todo" }]) });
  await saved(page);
  await page.keyboard.press("Alt+ArrowRight");
  await expect(card(doing)).toBeVisible();
  await saved(page);

  await page.reload();
  await expect(card(doing)).toBeVisible();
  await expect.poll(() => order(page, "Doing")).toEqual(await jiraOrder(app, "doing"));
  expect((await app.jiraIssue("TEST-2")).issue.status).toBe("doing");
});

test("9. a card's status, assignee and priority change straight from the card and are saved to Jira", async ({ page, app }) => {
  await app.seed({ writable: true, jiraEdits: true });
  const todo = column(page, "Todo");
  const review = column(page, "Review");

  // Status: TEST-4 to Review, a column the board hides while it is empty.
  await expect(review).toHaveCount(0);
  await page.getByRole("button", { name: "Status on TEST-4" }).click();
  await page.getByRole("dialog", { name: "Change status" }).getByRole("menuitem", { name: /^Review/ }).click();
  await expect(review.getByRole("row", { name: "TEST-4 Browser fixture 4", exact: true })).toBeVisible();
  await expect(todo.getByRole("row", { name: "TEST-4 Browser fixture 4", exact: true })).toHaveCount(0);
  await expect.poll(app.jiraWrites).toContainEqual({ key: "TEST-4", ops: expect.arrayContaining([{ op: "status", status: "review" }]) });

  // Assignee: TEST-5, unassigned, to Alex.
  const assignee = page.getByRole("button", { name: "Assignee on TEST-5" });
  await tooltip(page, assignee, "Unassigned");
  await assignee.click();
  await page.getByRole("dialog", { name: "Assign issue" }).getByRole("menuitem", { name: /^Alex/ }).click();
  await tooltip(page, assignee, "Alex");
  await expect.poll(async () => (await app.jiraIssue("TEST-5")).issue.assignee?.name).toBe("Alex");

  // Priority: TEST-6 from Low to Urgent.
  const priority = page.getByRole("button", { name: "Priority on TEST-6" });
  await tooltip(page, priority, "Low");
  await priority.click();
  await page.getByRole("dialog", { name: "Set priority" }).getByRole("menuitem", { name: /^Urgent/ }).click();
  await tooltip(page, priority, "Urgent");
  await expect.poll(async () => (await app.jiraIssue("TEST-6")).issue.priority).toBe("Urgent");
  await saved(page);

  await page.reload();
  await expect(review.getByRole("row", { name: "TEST-4 Browser fixture 4", exact: true })).toBeVisible();
  await tooltip(page, priority, "Urgent");
  await tooltip(page, assignee, "Alex");
});
