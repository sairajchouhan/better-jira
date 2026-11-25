import type { Page } from "@playwright/test";
import { expect, test } from "./app";

const openIssue = async (page: Page, key: string, title: string) => {
  await page
    .getByRole("grid", { name: "Todo" })
    .getByRole("row", { name: `${key} ${title}`, exact: true })
    .getByText(title, { exact: true })
    .click();
  await expect(page.getByRole("textbox", { name: "Issue title" })).toHaveValue(title);
};
/** The plain text of an ADF node. */
const text = (node: any): string => node?.text ?? (node?.content ?? []).map(text).join("");
/** The comments Jira holds on `key`, as plain text with their parent ids. */
const jiraComments = async (app: { jiraIssue(key: string): Promise<{ full: any }> }, key: string) =>
  ((await app.jiraIssue(key)).full.fields.comment.comments as any[]).map((c) => ({
    id: String(c.id),
    text: text(c.body),
    parentId: c.parentId === undefined ? undefined : String(c.parentId),
  }));
const commentBox = (page: Page) => page.getByRole("textbox", { name: "Leave a comment…" });
const saved = (page: Page) => expect(page.getByRole("status", { name: "Jira save status" })).toHaveText("Saved to Jira");
/** The Activity thread holding `content`. */
const thread = (page: Page, content: string) => page.getByRole("listitem").filter({ hasText: content });

const post = async (page: Page, body: string) => {
  await commentBox(page).fill(body);
  await page.getByRole("button", { name: "Submit comment" }).click();
  await expect(thread(page, body)).toBeVisible();
  await saved(page);
};
const openCommentMenu = async (page: Page, content: string) => {
  const comment = thread(page, content);
  await comment.hover();
  await comment.getByRole("button", { name: "Comment options" }).click();
};

test("38. a comment posted from the box reaches Jira and survives a reload", async ({ page, app }) => {
  await app.seed({ writable: true, jiraComments: true });
  await openIssue(page, "TEST-2", "Browser fixture 2");

  await commentBox(page).fill("Shipping this tomorrow");
  await page.getByRole("button", { name: "Submit comment" }).click();

  await expect(thread(page, "Shipping this tomorrow")).toBeVisible();
  await expect(commentBox(page)).toHaveText("");
  await expect(commentBox(page)).toBeFocused();
  await saved(page);
  expect((await jiraComments(app, "TEST-2")).filter((c) => c.text === "Shipping this tomorrow")).toHaveLength(1);

  await page.reload();
  await expect(page.getByText("Shipping this tomorrow")).toHaveCount(1);
});

test("39. editing my comment shows the new text and saves it to Jira", async ({ page, app }) => {
  await app.seed({ writable: true, jiraComments: true });
  await openIssue(page, "TEST-2", "Browser fixture 2");
  await post(page, "First take on the fix");

  await openCommentMenu(page, "First take on the fix");
  await page.getByRole("menuitem", { name: "Edit" }).click();
  const editor = page.getByRole("textbox", { name: "Edit comment" });
  await editor.fill("Second take on the fix");
  await page.getByRole("button", { name: "Save comment" }).click();

  await expect(editor).toHaveCount(0);
  await expect(thread(page, "Second take on the fix")).toBeVisible();
  await expect(page.getByText("First take on the fix")).toHaveCount(0);
  await expect
    .poll(async () => (await jiraComments(app, "TEST-2")).map((c) => c.text))
    .toEqual(["Second take on the fix"]);

  await page.reload();
  await expect(thread(page, "Second take on the fix")).toBeVisible();
  await expect(page.getByText("First take on the fix")).toHaveCount(0);
});

test("40. deleting my comment waits out the undo window: undo keeps it, letting it run out deletes it in Jira", async ({
  page,
  app,
}) => {
  await page.clock.install();
  await app.seed({ writable: true, jiraComments: true });
  await openIssue(page, "TEST-2", "Browser fixture 2");
  await post(page, "Maybe delete me");
  const inJira = async () => (await jiraComments(app, "TEST-2")).map((c) => c.text);
  const deletes = async () => (await app.jiraWrites()).flatMap((w) => w.ops).filter((op) => op.op === "comment.delete");
  const remove = async () => {
    await openCommentMenu(page, "Maybe delete me");
    await page.getByRole("menuitem", { name: "Delete" }).click();
    await page.getByRole("dialog").getByRole("button", { name: "Delete" }).click();
    await expect(page.getByText("Maybe delete me")).toHaveCount(0);
  };

  // Undo inside the window: the comment comes back and Jira never hears of the delete.
  await remove();
  await page.keyboard.press("ControlOrMeta+z");
  await expect(thread(page, "Maybe delete me")).toBeVisible();
  await page.clock.fastForward(10_000);
  await expect(thread(page, "Maybe delete me")).toBeVisible();
  expect(await deletes()).toEqual([]);
  expect(await inJira()).toEqual(["Maybe delete me"]);

  // No undo: Jira keeps the comment until the window runs out, then deletes it.
  await remove();
  await page.clock.fastForward(5_000);
  expect(await inJira()).toEqual(["Maybe delete me"]);
  await page.clock.fastForward(5_000);
  await expect.poll(inJira).toEqual([]);
  expect(await deletes()).toHaveLength(1);

  await page.reload();
  await expect(page.getByRole("heading", { name: "Activity" })).toBeVisible();
  await expect(page.getByText("Maybe delete me")).toHaveCount(0);
});

// The fixture keeps a posted reply's parentId as a number; the real mirror serves it as a string (threadParent), so once
// Jira answers, the reply here falls out of its thread as "Original comment removed".
test("41. a reply joins the thread it answers, in the app and in Jira", async ({ page, app }) => {
  await app.seed({ writable: true, jiraComments: true, threadedComments: true });
  await openIssue(page, "TEST-2", "Browser fixture 2");
  const root = thread(page, "Thread root from Jira");

  await root.getByRole("button", { name: "Reply to thread" }).click();
  await root.getByRole("textbox", { name: "Reply to thread" }).fill("Agreed, picking it up");
  await root.getByRole("button", { name: "Submit reply" }).click();

  await expect(root.getByText("Agreed, picking it up")).toBeVisible();
  await saved(page);
  expect(await jiraComments(app, "TEST-2")).toContainEqual(
    expect.objectContaining({ text: "Agreed, picking it up", parentId: "10100" }),
  );

  await page.reload();
  await expect(root.getByText("Agreed, picking it up")).toBeVisible();
  await expect(page.getByText("Agreed, picking it up")).toHaveCount(1);
});

test("42. a comment Jira refuses goes back into the box, so its text is not lost", async ({ page, app }) => {
  await app.seed({ writable: true, jiraComments: true });
  await openIssue(page, "TEST-2", "Browser fixture 2");
  await app.refuse(["comment"], "Comments are closed on this issue.");

  await commentBox(page).fill("A comment Jira will refuse");
  await page.getByRole("button", { name: "Submit comment" }).click();

  await expect(page.getByText("Comments are closed on this issue.", { exact: true })).toBeVisible();
  await expect(commentBox(page)).toHaveText("A comment Jira will refuse");
  await expect(page.getByRole("listitem").filter({ hasText: "A comment Jira will refuse" })).toHaveCount(0);
  expect(await jiraComments(app, "TEST-2")).toEqual([]);

  await page.reload();
  await expect(commentBox(page)).toHaveText("A comment Jira will refuse");
});

test("43. a comment draft survives a reload and clears once sent", async ({ page, app }) => {
  await app.seed({ writable: true, jiraComments: true });
  await openIssue(page, "TEST-2", "Browser fixture 2");

  await commentBox(page).fill("Half-written thought");
  await page.reload();
  await expect(commentBox(page)).toHaveText("Half-written thought");

  await page.getByRole("button", { name: "Submit comment" }).click();
  await expect(thread(page, "Half-written thought")).toBeVisible();
  await expect(commentBox(page)).toHaveText("");
  await saved(page);

  await page.reload();
  await expect(thread(page, "Half-written thought")).toBeVisible();
  await expect(commentBox(page)).toHaveText("");
});
