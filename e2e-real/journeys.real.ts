import type { Page } from "@playwright/test";
import { card, COMMENT_TAG, expect, issueTitle, openBoard, openIssue, retitle, runId, saveStatus, test } from "./jira";

/** The app resends a write 5 s after a failure (src/client/state/outbox.ts), and a comment delete waits out a 10 s undo. */
const RESEND = { timeout: 20_000 };
const JIRA = { timeout: 30_000 };

test("a title and a priority set in the issue view reach Jira and survive a reload", async ({ page, jira }) => {
  const was = jira.before("SAM1-8");
  // Jira can't clear a saved issue's priority, so an issue without one could never be put back.
  if (!was.priority) throw new Error("SAM1-8 has no priority: give it one in Jira first");
  const title = `${was.summary} (${runId()})`;
  const priority = was.priority.name === "Low" ? "Medium" : "Low";
  await openIssue(page, "SAM1-8", was);

  await retitle(page, title);
  await page.getByRole("button", { name: was.priority.name, exact: true }).click();
  await page.getByRole("dialog", { name: "Set priority" }).getByRole("menuitem", { name: new RegExp(`^${priority}( |$)`) }).click();

  await expect(page.getByRole("button", { name: priority, exact: true })).toBeVisible();
  await expect(saveStatus(page)).toHaveText("Saved to Jira", RESEND);
  await expect
    .poll(async () => {
      const now = await jira.now("SAM1-8");
      return { summary: now.summary, priority: now.priority?.name };
    }, JIRA)
    .toEqual({ summary: title, priority });

  await page.reload();
  await expect(issueTitle(page)).toHaveValue(title);
  await expect(page.getByRole("button", { name: priority, exact: true })).toBeVisible();
  await expect(card(page, "SAM1-8", title, was.status.name)).toBeVisible();
});

test("dragging a card to another column transitions the issue in Jira", async ({ page, jira }) => {
  const was = jira.before("SAM1-6");
  const to = was.status.name === "In Progress" ? "To Do" : "In Progress";
  const from = await openBoard(page, "SAM1-6", was);
  const target = page.getByRole("grid", { name: to });

  await from.getByText(was.summary, { exact: true }).dragTo(target.getByRole("row").first());

  await expect(card(page, "SAM1-6", was.summary, to)).toBeVisible();
  await expect(from).toHaveCount(0);
  await expect(saveStatus(page)).toHaveText("Saved to Jira", RESEND);
  await expect.poll(async () => (await jira.now("SAM1-6")).status.name, JIRA).toBe(to);
  expect(await jira.changes("SAM1-6")).toContainEqual({ field: "status", from: was.status.name, to });

  await page.reload();
  await expect(card(page, "SAM1-6", was.summary, to)).toBeVisible();
  await expect(from).toHaveCount(0);
});

/** The Activity thread holding `text`. */
const thread = (page: Page, text: string) => page.getByRole("listitem").filter({ hasText: text });

test("a comment added, edited and deleted in the app is added, edited and deleted in Jira", async ({ page, jira }) => {
  const id = runId();
  const added = `${COMMENT_TAG} ${id} added`;
  const edited = `${COMMENT_TAG} ${id} edited`;
  const ours = async () => (await jira.comments("SAM1-8")).filter((comment) => comment.text.includes(id));
  await openIssue(page, "SAM1-8", jira.before("SAM1-8"));

  await page.getByRole("textbox", { name: "Leave a comment…" }).fill(added);
  await page.getByRole("button", { name: "Submit comment" }).click();
  await expect(thread(page, added)).toBeVisible();
  await expect(saveStatus(page)).toHaveText("Saved to Jira", RESEND);
  await expect.poll(async () => (await ours()).map((comment) => comment.text), JIRA).toEqual([added]);
  const commentId = (await ours())[0]!.id;

  await thread(page, added).hover();
  await thread(page, added).getByRole("button", { name: "Comment options" }).click();
  await page.getByRole("menuitem", { name: "Edit" }).click();
  await page.getByRole("textbox", { name: "Edit comment" }).fill(edited);
  await page.getByRole("button", { name: "Save comment" }).click();
  await expect(thread(page, edited)).toBeVisible();
  await expect(page.getByText(added)).toHaveCount(0);
  await expect.poll(ours, JIRA).toEqual([{ id: commentId, text: edited }]);

  await thread(page, edited).hover();
  await thread(page, edited).getByRole("button", { name: "Comment options" }).click();
  await page.getByRole("menuitem", { name: "Delete" }).click();
  await page.getByRole("dialog").getByRole("button", { name: "Delete" }).click();
  await expect(page.getByText(edited)).toHaveCount(0);
  await expect.poll(ours, JIRA).toEqual([]);

  await page.reload();
  await expect(page.getByRole("heading", { name: "Activity" })).toBeVisible();
  await expect(page.getByText(id)).toHaveCount(0);
});

test("a title changed offline reaches Jira once the browser is back online, exactly once", async ({ page, jira }) => {
  const was = jira.before("SAM1-6");
  const title = `${was.summary} (offline ${runId()})`;
  await openIssue(page, "SAM1-6", was);

  await page.context().setOffline(true);
  await retitle(page, title);
  await expect(saveStatus(page)).toContainText("Can't reach the better-jira server. Retrying…");
  await expect(card(page, "SAM1-6", title, was.status.name)).toBeVisible();
  expect((await jira.now("SAM1-6")).summary).toBe(was.summary);

  await page.context().setOffline(false);
  await expect(saveStatus(page)).toHaveText("Saved to Jira", RESEND);
  await expect.poll(async () => (await jira.now("SAM1-6")).summary, JIRA).toBe(title);

  // Jira records nothing for a write that sets the value it already holds, so a resend of the offline edit only shows once
  // the title has moved on: a teammate renames the issue in Jira, and any later resend would rename it back. A reload
  // replays whatever the app still holds as unsent, and putting the title back is the last write.
  const renamed = `${title} (renamed in Jira)`;
  await jira.renameInJira("SAM1-6", renamed);
  await expect(issueTitle(page)).toHaveValue(renamed, JIRA);
  await page.reload();
  await expect(issueTitle(page)).toHaveValue(renamed);
  await retitle(page, was.summary);
  await expect(saveStatus(page)).toHaveText("Saved to Jira", RESEND);
  await expect.poll(async () => (await jira.now("SAM1-6")).summary, JIRA).toBe(was.summary);
  expect((await jira.changes("SAM1-6")).filter((change) => change.field === "summary")).toEqual([
    { field: "summary", from: was.summary, to: title },
    { field: "summary", from: title, to: renamed },
    { field: "summary", from: renamed, to: was.summary },
  ]);
});
