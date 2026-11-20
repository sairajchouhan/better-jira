import type { Page } from "@playwright/test";
import { expect, test, type JiraWrite } from "./app";

const composer = (page: Page) => page.getByRole("dialog", { name: "Create issue" });
const saveStatus = (page: Page) => page.getByRole("status", { name: "Jira save status" });
const column = (page: Page, name: string) => page.getByRole("grid", { name });
/** The create ops the app sent, whatever temporary key it sent them under. */
const creates = async (writes: Promise<JiraWrite[]>) =>
  (await writes).flatMap((w) => w.ops.filter((op) => op.op === "create"));
/** Waits for the board, then opens the composer with C. */
const pressC = async (page: Page) => {
  await expect(column(page, "Todo").getByRole("row").first()).toBeVisible();
  await page.keyboard.press("c");
  await expect(composer(page)).toBeVisible();
};
const pick = async (page: Page, pill: string, item: RegExp) => {
  await composer(page).getByRole("button", { name: new RegExp(`^${pill}:`) }).click();
  await page.getByRole("menuitem", { name: item }).click();
};

test("16 an issue created with C, with a title, description and status, lands in its column and in Jira", async ({ page, app }) => {
  await app.seed({ writable: true, createSuccess: true });
  await pressC(page);
  await composer(page).getByRole("textbox", { name: "Issue title", exact: true }).fill("Composer smoke issue");
  await composer(page).getByRole("textbox", { name: "Issue description" }).click();
  await page.keyboard.type("Steps to reproduce the smoke");
  await pick(page, "Status", /^Doing/);
  await expect(composer(page).getByRole("button", { name: "Status: Doing" })).toBeVisible();
  await composer(page).getByRole("button", { name: "Create issue" }).click();

  await expect(composer(page)).toHaveCount(0);
  const row = column(page, "Doing").getByRole("row", { name: "TEST-90 Composer smoke issue", exact: true });
  await expect(row).toBeVisible();
  await expect(page.getByText("Issue created")).toBeVisible();
  await expect(saveStatus(page)).toHaveText("Saved to Jira");
  expect(await creates(app.jiraWrites())).toEqual([
    expect.objectContaining({ fields: expect.objectContaining({ summary: "Composer smoke issue", status: "doing" }) }),
  ]);
  const jira = await app.jiraIssue("TEST-90");
  expect(jira.issue).toMatchObject({ summary: "Composer smoke issue", status: "doing" });
  expect(JSON.stringify(jira.full.fields.description)).toContain("Steps to reproduce the smoke");

  await page.reload();
  await expect(row).toBeVisible();
  await row.getByText("Composer smoke issue", { exact: true }).click();
  await expect(page.getByRole("textbox", { name: "Issue title" })).toHaveValue("Composer smoke issue");
  await expect(page.getByRole("textbox", { name: "Issue description" })).toContainText("Steps to reproduce the smoke");
});

test("17 creating from a column's + starts in that column's status and lands there", async ({ page, app }) => {
  await app.seed({ writable: true, createSuccess: true });
  await expect(column(page, "Doing").getByRole("row").first()).toBeVisible();

  await page.getByRole("button", { name: "New issue in Doing" }).click();
  await expect(composer(page).getByRole("button", { name: "Status: Doing" })).toBeVisible();
  await composer(page).getByRole("textbox", { name: "Issue title", exact: true }).fill("Started from the Doing column");
  await composer(page).getByRole("button", { name: "Create issue" }).click();

  const row = column(page, "Doing").getByRole("row", { name: "TEST-90 Started from the Doing column", exact: true });
  await expect(row).toBeVisible();
  await expect(saveStatus(page)).toHaveText("Saved to Jira");
  expect(await creates(app.jiraWrites())).toEqual([
    expect.objectContaining({ fields: expect.objectContaining({ summary: "Started from the Doing column", status: "doing" }) }),
  ]);
  expect((await app.jiraIssue("TEST-90")).issue.status).toBe("doing");
  await page.reload();
  await expect(row).toBeVisible();
});

test("18 an issue created with priority, assignee, labels and epic sends each one to Jira", async ({ page, app }) => {
  await app.seed({ writable: true, createSuccess: true, epics: true });
  await pressC(page);
  await composer(page).getByRole("textbox", { name: "Issue title", exact: true }).fill("Fully described issue");
  await pick(page, "Status", /^Todo/);
  await pick(page, "Priority", /^High/);
  await pick(page, "Assignee", /^Alex/);
  await composer(page).getByRole("button", { name: /^Labels:/ }).click();
  await page.getByRole("menuitemcheckbox", { name: /^Add label ui/ }).click();
  await pick(page, "Epic", /^Fixture epic/);
  for (const pill of ["Priority: High", "Assignee: Alex", "Labels: ui", "Epic: Fixture epic"])
    await expect(composer(page).getByRole("button", { name: pill })).toBeVisible();
  await composer(page).getByRole("button", { name: "Create issue" }).click();

  const row = column(page, "Todo").getByRole("row", { name: "TEST-90 Fully described issue", exact: true });
  await expect(row).toBeVisible();
  await expect(saveStatus(page)).toHaveText("Saved to Jira");
  const [create] = await creates(app.jiraWrites());
  expect(create).toMatchObject({
    fields: { summary: "Fully described issue", priority: "High", assignee: "alex", labels: ["ui"], parent: "TEST-7" },
  });
  expect((await app.jiraIssue("TEST-90")).issue).toMatchObject({
    priority: "High",
    assignee: { name: "Alex" },
    labels: ["ui"],
    parent: "TEST-7",
  });

  await page.reload();
  await row.getByText("Fully described issue", { exact: true }).click();
  const detail = page.getByRole("complementary");
  await expect(detail.getByRole("textbox", { name: "Issue title" })).toHaveValue("Fully described issue");
  for (const value of ["High", "Alex", "ui", "Fixture epic"])
    await expect(detail.getByRole("button", { name: value, exact: true })).toBeVisible();
});

test("19 double-clicking Create issue makes one issue", async ({ page, app }) => {
  await app.seed({ writable: true, createSuccess: true });
  await expect(column(page, "Doing").getByRole("row").first()).toBeVisible();
  await page.getByRole("button", { name: "New issue in Doing" }).click();
  await composer(page).getByRole("textbox", { name: "Issue title", exact: true }).fill("Clicked twice");

  // Both clicks land before React re-renders and closes the composer, as a fast double click can.
  await composer(page).getByRole("button", { name: "Create issue" }).evaluate((button: HTMLElement) => {
    button.click();
    button.click();
  });

  await expect(column(page, "Doing").getByRole("row", { name: "TEST-90 Clicked twice", exact: true })).toBeVisible();
  await expect(saveStatus(page)).toHaveText("Saved to Jira");
  expect(await creates(app.jiraWrites())).toHaveLength(1);
  expect((await app.jiraIssues()).filter((i) => i.summary === "Clicked twice")).toHaveLength(1);
  await expect(page.getByRole("row", { name: /Clicked twice/ })).toHaveCount(1);
  await page.reload();
  await expect(column(page, "Doing").getByRole("row", { name: "TEST-90 Clicked twice", exact: true })).toBeVisible();
  await expect(page.getByRole("row", { name: /Clicked twice/ })).toHaveCount(1);
});

test("20 a create Jira refuses leaves no ghost issue and brings the composer back with the draft", async ({ page, app }) => {
  await app.seed({ writable: true, createSuccess: true });
  await app.refuse(["create"], "Jira refused: the summary has a banned word.");
  await expect(column(page, "Doing").getByRole("row").first()).toBeVisible();
  await page.getByRole("button", { name: "New issue in Doing" }).click();
  await composer(page).getByRole("textbox", { name: "Issue title", exact: true }).fill("Refused by Jira");
  await composer(page).getByRole("textbox", { name: "Issue description" }).click();
  await page.keyboard.type("Words worth keeping");
  await composer(page).getByRole("button", { name: "Create issue" }).click();

  await expect(saveStatus(page)).toContainText("Not saved to Jira");
  await expect(saveStatus(page)).toContainText("Jira refused: the summary has a banned word.");
  await expect(page.getByRole("row", { name: /Refused by Jira/ })).toHaveCount(0);
  await expect(composer(page).getByRole("textbox", { name: "Issue title", exact: true })).toHaveValue("Refused by Jira");
  await expect(composer(page).getByRole("textbox", { name: "Issue description" })).toContainText("Words worth keeping");
  await expect(composer(page).getByRole("button", { name: "Status: Doing" })).toBeVisible();
  expect(await creates(app.jiraWrites())).toEqual([
    expect.objectContaining({ fields: expect.objectContaining({ summary: "Refused by Jira" }) }),
  ]);
  expect((await app.jiraIssues()).filter((i) => i.summary === "Refused by Jira")).toEqual([]);

  // The ghost stays gone and the draft stays kept after a reload.
  await page.reload();
  await expect(column(page, "Doing").getByRole("row").first()).toBeVisible();
  await expect(page.getByRole("row", { name: /Refused by Jira/ })).toHaveCount(0);
  await expect(composer(page)).toHaveCount(0);
  await pressC(page);
  await expect(composer(page).getByRole("textbox", { name: "Issue title", exact: true })).toHaveValue("Refused by Jira");
  await expect(composer(page).getByRole("textbox", { name: "Issue description" })).toContainText("Words worth keeping");
  expect(await creates(app.jiraWrites())).toHaveLength(1);
});

test("21 closing a filled composer offers Save to drafts, and the saved draft comes back after a reload", async ({ page, app }) => {
  await app.seed({ writable: true, createSuccess: true });
  await pressC(page);
  await composer(page).getByRole("textbox", { name: "Issue title", exact: true }).fill("Half-written idea");
  await composer(page).getByRole("textbox", { name: "Issue description" }).click();
  await page.keyboard.type("Finish this tomorrow");

  await composer(page).getByRole("button", { name: "Close", exact: true }).click();
  const ask = page.getByRole("dialog", { name: "Save to drafts?" });
  await expect(ask).toBeVisible();
  await expect(ask.getByRole("button", { name: "Discard" })).toBeVisible();
  await ask.getByRole("button", { name: "Save", exact: true }).click();
  await expect(ask).toHaveCount(0);
  await expect(composer(page)).toHaveCount(0);
  expect(await creates(app.jiraWrites())).toEqual([]);

  await page.reload();
  await pressC(page);
  await composer(page).getByRole("button", { name: "Saved drafts (1)" }).click();
  await page.getByRole("dialog", { name: "Saved drafts" }).getByRole("button", { name: "Finish Half-written idea" }).click();
  await expect(composer(page).getByRole("textbox", { name: "Issue title", exact: true })).toHaveValue("Half-written idea");
  await expect(composer(page).getByRole("textbox", { name: "Issue description" })).toContainText("Finish this tomorrow");

  await composer(page).getByRole("button", { name: "Create issue" }).click();
  await expect(saveStatus(page)).toHaveText("Saved to Jira");
  expect(await creates(app.jiraWrites())).toEqual([
    expect.objectContaining({ fields: expect.objectContaining({ summary: "Half-written idea" }) }),
  ]);
});

test("22 a sub-issue created under an issue shows in its Sub-issues and is its child in Jira", async ({ page, app }) => {
  await app.seed({ writable: true, createSuccess: true });
  await column(page, "Todo")
    .getByRole("row", { name: "TEST-2 Browser fixture 2", exact: true })
    .getByText("Browser fixture 2", { exact: true })
    .click();
  const subIssues = page.getByRole("region", { name: "Sub-issues" });
  await subIssues.getByRole("button", { name: "Add sub-issues" }).click();
  await subIssues.getByRole("textbox", { name: "Sub-issue title" }).fill("Child of fixture 2");
  await subIssues.getByRole("button", { name: "Create", exact: true }).click();

  await expect(subIssues.getByText("Child of fixture 2", { exact: true })).toBeVisible();
  await expect(saveStatus(page)).toHaveText("Saved to Jira");
  expect(await creates(app.jiraWrites())).toEqual([
    expect.objectContaining({ fields: expect.objectContaining({ summary: "Child of fixture 2", parent: "TEST-2" }) }),
  ]);
  expect((await app.jiraIssue("TEST-90")).issue).toMatchObject({ summary: "Child of fixture 2", parent: "TEST-2" });

  await page.reload();
  await expect(page.getByRole("textbox", { name: "Issue title", exact: true })).toHaveValue("Browser fixture 2");
  await expect(subIssues.getByText("Child of fixture 2", { exact: true })).toBeVisible();
});

test.fail("a create Jira refuses while ⌘K is open brings the composer back with the draft once ⌘K closes", async ({ page, app }) => {
  await app.seed({ writable: true, createSuccess: true });
  await app.refuse(["create"], "Jira refused: the summary has a banned word.");
  // The first send gets no answer, so Jira's refusal lands on the retry, after ⌘K has opened over the board.
  await app.unanswered(1);
  await pressC(page);
  await composer(page).getByRole("textbox", { name: "Issue title", exact: true }).fill("Refused under the palette");
  await composer(page).getByRole("textbox", { name: "Issue description" }).click();
  await page.keyboard.type("Typed before the palette opened");
  await composer(page).getByRole("button", { name: "Create issue" }).click();
  await expect(composer(page)).toHaveCount(0);
  const palette = page.getByRole("dialog", { name: "Search issues and commands" });
  await page.keyboard.press("ControlOrMeta+k");
  await expect(palette).toBeVisible();

  await expect(saveStatus(page)).toContainText("Jira refused: the summary has a banned word.", { timeout: 15_000 });
  await expect(page.getByRole("row", { name: /Refused under the palette/ })).toHaveCount(0);
  await page.keyboard.press("Escape");
  await expect(palette).toHaveCount(0);
  await expect(composer(page).getByRole("textbox", { name: "Issue title", exact: true })).toHaveValue("Refused under the palette");
  await expect(composer(page).getByRole("textbox", { name: "Issue description" })).toContainText("Typed before the palette opened");
});

test.fail("the sub-issue composer's due date chip reads the day, as the New issue composer's does", async ({ page, app }) => {
  await app.seed({ writable: true, createSuccess: true });
  await column(page, "Todo")
    .getByRole("row", { name: "TEST-2 Browser fixture 2", exact: true })
    .getByText("Browser fixture 2", { exact: true })
    .click();
  const subIssues = page.getByRole("region", { name: "Sub-issues" });
  await subIssues.getByRole("button", { name: "Add sub-issues" }).click();
  await subIssues.getByRole("textbox", { name: "Sub-issue title" }).fill("Due tomorrow");
  await subIssues.getByRole("button", { name: "Sub-issue due date. No due date" }).click();
  await page.getByRole("menuitem", { name: /^Tomorrow/ }).click();

  const chip = subIssues.getByRole("button", { name: "Sub-issue due date. Tomorrow" });
  await expect(chip).toHaveText("Tomorrow");
  await subIssues.getByRole("button", { name: "Create", exact: true }).click();
  const tomorrow = new Date();
  tomorrow.setDate(tomorrow.getDate() + 1);
  const day = `${tomorrow.getFullYear()}-${String(tomorrow.getMonth() + 1).padStart(2, "0")}-${String(tomorrow.getDate()).padStart(2, "0")}`;
  await expect(saveStatus(page)).toHaveText("Saved to Jira");
  expect(await creates(app.jiraWrites())).toEqual([
    expect.objectContaining({ fields: expect.objectContaining({ summary: "Due tomorrow", due: day }) }),
  ]);
});
