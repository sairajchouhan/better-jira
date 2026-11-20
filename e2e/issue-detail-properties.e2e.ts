import { expect, test, type JiraWrite } from "./app";
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
const fieldsSent = (writes: JiraWrite[], key: string) =>
  writes.filter((w) => w.key === key).flatMap((w) => w.ops.flatMap((op: any) => (op.op === "fields" ? [op.fields] : [])));
const statusesSent = (writes: JiraWrite[], key: string) =>
  writes.filter((w) => w.key === key).flatMap((w) => w.ops.flatMap((op: any) => (op.op === "status" ? [op.status] : [])));
/** A local date as Jira's due field holds it. */
const isoDay = (date: Date) =>
  `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;

test("24 status: changing it from its pill and with S transitions the issue in Jira", async ({ page, app }) => {
  await app.seed({ writable: true, jiraEdits: true });
  const detail = await openIssue(page, "TEST-4", "Browser fixture 4");
  const status = async () => (await app.jiraIssue("TEST-4")).issue.status;

  await detail.getByRole("button", { name: "Todo", exact: true }).click();
  await page.getByRole("dialog", { name: "Change status" }).getByRole("menuitem", { name: /^Doing/ }).click();
  await expect(detail.getByRole("button", { name: "Doing", exact: true })).toBeVisible();
  await expect.poll(status).toBe("doing");

  await page.keyboard.press("s");
  await expect(page.getByRole("dialog", { name: "Change status" })).toBeVisible();
  await page.keyboard.type("Review");
  await page.keyboard.press("Enter");
  await expect(detail.getByRole("button", { name: "Review", exact: true })).toBeVisible();
  await expect.poll(status).toBe("review");
  expect(statusesSent(await app.jiraWrites(), "TEST-4")).toEqual(["doing", "review"]);

  await page.reload();
  await expect(page.getByRole("grid", { name: "Review" }).getByRole("row", { name: "TEST-4 Browser fixture 4", exact: true })).toBeVisible();
});

test("24 assignee: assigning from the pill, with A, and un-assigning with I reaches Jira", async ({ page, app }) => {
  await app.seed({ writable: true, jiraEdits: true });
  const detail = await openIssue(page, "TEST-4", "Browser fixture 4");
  const assignee = async () => (await app.jiraIssue("TEST-4")).issue.assignee?.id ?? null;

  await detail.getByRole("button", { name: /^Unassigned/ }).click();
  await page.getByRole("dialog", { name: "Assign issue" }).getByRole("menuitem", { name: "Alex" }).click();
  await expect(detail.getByRole("button", { name: "Alex", exact: true })).toBeVisible();
  await expect.poll(assignee).toBe("alex");

  await page.keyboard.press("a");
  await expect(page.getByRole("dialog", { name: "Assign issue" })).toBeVisible();
  await page.keyboard.type("Audit");
  await page.keyboard.press("Enter");
  await expect(detail.getByRole("button", { name: /Audit user$/ })).toBeVisible();
  await expect.poll(assignee).toBe("audit-me");
  await page.reload();
  await expect(detail.getByRole("button", { name: /Audit user$/ })).toBeVisible();

  // I un-assigns the issue from me.
  await page.getByRole("textbox", { name: "Issue title" }).hover();
  await page.keyboard.press("i");
  await expect(detail.getByRole("button", { name: /^Unassigned/ })).toBeVisible();
  await expect.poll(assignee).toBeNull();
});

test("24 priority: changing it from its pill and with P reaches Jira", async ({ page, app }) => {
  await app.seed({ writable: true, jiraEdits: true });
  const detail = await openIssue(page, "TEST-4", "Browser fixture 4");
  const priority = async () => (await app.jiraIssue("TEST-4")).issue.priority;

  await detail.getByRole("button", { name: "Urgent", exact: true }).click();
  await page.getByRole("dialog", { name: "Set priority" }).getByRole("menuitem", { name: /^Low/ }).click();
  await expect(detail.getByRole("button", { name: "Low", exact: true })).toBeVisible();
  await expect.poll(priority).toBe("Low");

  await page.keyboard.press("p");
  await expect(page.getByRole("dialog", { name: "Set priority" })).toBeVisible();
  await page.keyboard.type("High");
  await page.keyboard.press("Enter");
  await expect(detail.getByRole("button", { name: "High", exact: true })).toBeVisible();
  await expect.poll(priority).toBe("High");

  await page.reload();
  await expect(detail.getByRole("button", { name: "High", exact: true })).toBeVisible();
});

test("24 labels: adding one from the pill and removing one with L reaches Jira", async ({ page, app }) => {
  await app.seed({ writable: true, jiraEdits: true });
  const detail = await openIssue(page, "TEST-4", "Browser fixture 4");
  const labels = async () => (await app.jiraIssue("TEST-4")).issue.labels;

  await detail.getByRole("button", { name: "Add label" }).click();
  await page.getByRole("dialog", { name: "Change labels" }).getByRole("menuitemcheckbox", { name: /^Add label ui/ }).click();
  await expect(detail.getByRole("button", { name: "ui", exact: true })).toBeVisible();
  await expect.poll(labels).toEqual(["test", "ui"]);

  await page.keyboard.press("l");
  await expect(page.getByRole("dialog", { name: "Change labels" })).toBeVisible();
  await page.keyboard.type("test");
  await page.keyboard.press("Enter");
  await expect(detail.getByRole("button", { name: "test", exact: true })).toHaveCount(0);
  await expect.poll(labels).toEqual(["ui"]);

  await page.reload();
  await expect(detail.getByRole("button", { name: "ui", exact: true })).toBeVisible();
  await expect(detail.getByRole("button", { name: "test", exact: true })).toHaveCount(0);
});

test("24 due date: setting it from Issue options and with ⇧D, then removing it with ⌘⇧D, reaches Jira", async ({ page, app }) => {
  await app.seed({ writable: true, jiraEdits: true });
  const detail = await openIssue(page, "TEST-4", "Browser fixture 4");
  const due = async () => (await app.jiraIssue("TEST-4")).issue.due ?? null;
  const tomorrow = new Date();
  tomorrow.setDate(tomorrow.getDate() + 1);
  const inAWeek = new Date();
  inAWeek.setDate(inAWeek.getDate() + 7);
  const tomorrowPill = detail.getByRole("button", { name: "Tomorrow", exact: true });
  const weekPill = detail.getByRole("button", {
    name: inAWeek.toLocaleDateString("en-US", { month: "short", day: "numeric" }),
    exact: true,
  });

  await detail.getByRole("button", { name: "Issue options" }).click();
  await page.getByRole("dialog", { name: "Issue options" }).getByRole("menuitem", { name: "Due date" }).click();
  await page.getByRole("menuitem", { name: /^Tomorrow/ }).click();
  await expect(tomorrowPill).toBeVisible();
  await expect.poll(due).toBe(isoDay(tomorrow));

  await page.keyboard.press("Shift+d");
  await expect(page.getByRole("dialog", { name: "Due date" })).toBeVisible();
  await page.keyboard.type("In one week");
  await page.keyboard.press("Enter");
  await expect(weekPill).toBeVisible();
  await expect(tomorrowPill).toHaveCount(0);
  await expect.poll(due).toBe(isoDay(inAWeek));
  await page.reload();
  await expect(weekPill).toBeVisible();

  await page.getByRole("textbox", { name: "Issue title" }).hover();
  await page.keyboard.press("ControlOrMeta+Shift+d");
  await expect(weekPill).toHaveCount(0);
  await expect.poll(due).toBeNull();
  expect(fieldsSent(await app.jiraWrites(), "TEST-4").map((f) => f.due)).toEqual([isoDay(tomorrow), isoDay(inAWeek), null]);
});

test("24 type: changing it from its pill and with ⇧T reaches Jira", async ({ page, app }) => {
  await app.seed({ writable: true, jiraEdits: true });
  const detail = await openIssue(page, "TEST-4", "Browser fixture 4");
  const type = async () => (await app.jiraIssue("TEST-4")).issue.type;

  await detail.getByRole("button", { name: /^Task/ }).click();
  await page.getByRole("dialog", { name: "Change issue type" }).getByRole("menuitem", { name: "Story" }).click();
  await expect(detail.getByRole("button", { name: /^Story/ })).toBeVisible();
  await expect.poll(type).toBe("Story");
  await page.reload();
  await expect(detail.getByRole("button", { name: /^Story/ })).toBeVisible();

  await page.getByRole("textbox", { name: "Issue title" }).hover();
  await page.keyboard.press("Shift+t");
  await expect(page.getByRole("dialog", { name: "Change issue type" })).toBeVisible();
  await page.keyboard.type("Task");
  await page.keyboard.press("Enter");
  await expect(detail.getByRole("button", { name: /^Task/ })).toBeVisible();
  await expect.poll(type).toBe("Task");
  expect(fieldsSent(await app.jiraWrites(), "TEST-4").map((f) => f.type)).toEqual(["Story", "Task"]);
});

test("24 type: Issue options › Issue type opens the type picker, and the type picked reaches Jira", async ({ page, app }) => {
  await app.seed({ writable: true, jiraEdits: true });
  const detail = await openIssue(page, "TEST-4", "Browser fixture 4");

  await detail.getByRole("button", { name: "Issue options" }).click();
  await page.getByRole("dialog", { name: "Issue options" }).getByRole("menuitem", { name: "Issue type" }).click();
  await page.getByRole("dialog", { name: "Change issue type" }).getByRole("menuitem", { name: "Story" }).click();

  await expect(detail.getByRole("button", { name: /^Story/ })).toBeVisible();
  await expect.poll(async () => (await app.jiraIssue("TEST-4")).issue.type).toBe("Story");
});

test("24 epic: adding the issue to an epic from its pill and taking it out with ⇧P reaches Jira", async ({ page, app }) => {
  await app.seed({ writable: true, jiraEdits: true, epics: true });
  const detail = await openIssue(page, "TEST-4", "Browser fixture 4");
  const parent = async () => (await app.jiraIssue("TEST-4")).issue.parent ?? null;

  await detail.getByRole("button", { name: "Epic", exact: true }).click();
  await page.getByRole("dialog", { name: "Change epic" }).getByRole("menuitem", { name: "Fixture epic" }).click();
  await expect(detail.getByRole("link", { name: "TEST-7 Fixture epic" })).toBeVisible();
  await expect.poll(parent).toBe("TEST-7");
  await page.reload();
  await expect(detail.getByRole("link", { name: "TEST-7 Fixture epic" })).toBeVisible();

  await page.getByRole("textbox", { name: "Issue title" }).hover();
  await page.keyboard.press("Shift+p");
  await expect(page.getByRole("dialog", { name: "Change epic" })).toBeVisible();
  await page.keyboard.type("No epic");
  await page.keyboard.press("Enter");
  await expect(detail.getByRole("button", { name: "Epic", exact: true })).toBeVisible();
  await expect.poll(parent).toBeNull();
  expect(fieldsSent(await app.jiraWrites(), "TEST-4").map((f) => f.parent)).toEqual(["TEST-7", null]);
});

test("25 a fast run of status changes reaches Jira as the first change at once, then one transition to the last", async ({ page, app }) => {
  test.fail();
  await app.seed({ writable: true, jiraEdits: true });
  const detail = await openIssue(page, "TEST-4", "Browser fixture 4");

  // S then the status's number in the menu (Doing 3, Review 4, Done 5), as fast as the keys go.
  for (const number of ["3", "4", "5"]) {
    await page.keyboard.press("s");
    await page.keyboard.press(number);
  }
  await expect(detail.getByRole("button", { name: "Done", exact: true })).toBeVisible();

  await expect.poll(async () => (await app.jiraIssue("TEST-4")).issue.status).toBe("done");
  expect(statusesSent(await app.jiraWrites(), "TEST-4")).toEqual(["doing", "done"]);
  await page.reload();
  await expect(page.getByRole("grid", { name: "Done" }).getByRole("row", { name: "TEST-4 Browser fixture 4", exact: true })).toBeVisible();
});
