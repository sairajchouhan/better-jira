import { expect, test } from "./app";

const openIssue = async (page: import("@playwright/test").Page, key: string, title: string) => {
  await page
    .getByRole("grid", { name: "Todo" })
    .getByRole("row", { name: `${key} ${title}`, exact: true })
    .getByText(title, { exact: true })
    .click();
  await expect(page.getByRole("textbox", { name: "Issue title" })).toHaveValue(title);
};
const image = "scripts/fixtures/media-image.png";

test("an image uploaded into a description on a writable site is in Jira and shows after reload", async ({ page, app }) => {
  await app.seed({ writable: true });
  await openIssue(page, "TEST-2", "Browser fixture 2");

  const chooser = page.waitForEvent("filechooser");
  await page.getByRole("button", { name: "Attach images, files, or videos" }).first().click();
  await (await chooser).setFiles(image);

  await expect.poll(app.uploads).toEqual([expect.objectContaining({ key: "TEST-2", name: "media-image.png" })]);
  // The upload lands before the description write that shows it is queued, so wait for Jira's description to hold it.
  const [upload] = await app.uploads();
  await expect
    .poll(async () => JSON.stringify((await app.jiraIssue("TEST-2")).full.fields.description))
    .toContain(`"id":"${upload!.mediaId}"`);
  await expect(page.getByRole("status", { name: "Jira save status" })).toHaveText("Saved to Jira");
  await page.reload();
  await expect(
    page.getByRole("textbox", { name: "Issue description" }).getByRole("img", { name: "media-image.png", exact: true }),
  ).toBeVisible();
});

test("a title and a comment changed in Jira show in the open issue without a reload", async ({ page, app }) => {
  await app.seed({ writable: true });
  await openIssue(page, "TEST-2", "Browser fixture 2");

  await app.changeInJira({ key: "TEST-2", summary: "Renamed in Jira", comment: { body: "Posted in Jira" } });

  await expect(page.getByRole("textbox", { name: "Issue title" })).toHaveValue("Renamed in Jira");
  await expect(page.getByText("Posted in Jira")).toBeVisible();
});

test("a comment deleted in Jira leaves the open issue without a reload", async ({ page, app }) => {
  await app.seed({ writable: true });
  await openIssue(page, "TEST-2", "Browser fixture 2");
  const { commentId } = await app.changeInJira({ key: "TEST-2", comment: { body: "Short-lived comment" } });
  await expect(page.getByText("Short-lived comment")).toBeVisible();

  await app.changeInJira({ key: "TEST-2", deleteComment: commentId });

  await expect(page.getByText("Short-lived comment")).toHaveCount(0);
});

test("a status changed in Jira moves the issue to its new column without a reload", async ({ page, app }) => {
  await app.seed({ writable: true });
  const row = (grid: string) =>
    page.getByRole("grid", { name: grid }).getByRole("row", { name: "TEST-2 Browser fixture 2", exact: true });
  await expect(row("Todo")).toBeVisible();

  await app.changeInJira({ key: "TEST-2", status: "done" });

  await expect(row("Done")).toBeVisible();
  await expect(row("Todo")).toHaveCount(0);
});

test("an issue made in Jira shows on the board without a reload", async ({ page, app }) => {
  await app.seed({ writable: true });
  await expect(page.getByRole("grid", { name: "Todo" }).getByRole("row").first()).toBeVisible();

  await app.changeInJira({ key: "TEST-50", summary: "Made in Jira" });

  await expect(page.getByRole("grid", { name: "Todo" }).getByRole("row", { name: "TEST-50 Made in Jira", exact: true })).toBeVisible();
});

test("a comment whose answer Jira lost is sent again and lands once", async ({ page, app }) => {
  await app.seed({ writable: true, jiraComments: true });
  await openIssue(page, "TEST-2", "Browser fixture 2");
  await app.unanswered(1, { applied: true });

  await page.getByRole("textbox", { name: "Leave a comment…" }).fill("Sent once");
  await page.getByRole("button", { name: "Submit comment" }).click();

  await expect(page.getByRole("status", { name: "Jira save status" })).toHaveText("Saved to Jira", { timeout: 15_000 });
  const comments = async () =>
    (await app.jiraIssue("TEST-2")).full.fields.comment.comments.filter((c: any) => JSON.stringify(c.body).includes("Sent once"));
  expect(await comments()).toHaveLength(1);
  expect((await app.requests()).filter((r) => r.path === "/api/issues/TEST-2/ops").map((r) => r.status)).toEqual([503, 200]);
  await page.reload();
  await expect(page.getByText("Sent once")).toHaveCount(1);
});

test("a description edit made from a copy Jira has since changed is refused, and the editor asks which to keep", async ({ page, app }) => {
  await app.seed({ writable: true });
  await openIssue(page, "TEST-2", "Browser fixture 2");
  await app.changeInJira({ key: "TEST-2", description: "Changed in Jira", unseen: true });

  await page.getByRole("textbox", { name: "Issue description" }).getByText("A list item").click();
  await page.keyboard.type(" and mine");

  await expect(page.getByRole("button", { name: "Use Jira's version" })).toBeVisible({ timeout: 10_000 });
  await expect(page.getByRole("button", { name: "Keep mine" })).toBeVisible();
});

test("subscribing writes a watcher Jira keeps, so it survives a reload", async ({ page, app }) => {
  await app.seed({ writable: true });
  await openIssue(page, "TEST-2", "Browser fixture 2");

  await page.getByRole("button", { name: "Subscribe to issue" }).click();
  await expect(page.getByRole("button", { name: "Unsubscribe from issue" })).toBeVisible();
  await expect(page.getByRole("status", { name: "Jira save status" })).toHaveText("Saved to Jira");
  expect((await app.jiraIssue("TEST-2")).issue.watching).toBe(true);
  await page.reload();
  await expect(page.getByRole("button", { name: "Unsubscribe from issue" })).toBeVisible();
});

test("a relation the app adds is kept in Jira on both issues and survives a reload", async ({ page, app }) => {
  await app.seed({ writable: true });
  await openIssue(page, "TEST-2", "Browser fixture 2");

  await page.keyboard.press("m");
  await page.keyboard.press("r");
  await page.getByRole("menuitem", { name: /TEST-4/ }).click();
  await expect(page.getByRole("status", { name: "Jira save status" })).toHaveText("Saved to Jira");
  expect((await app.jiraIssue("TEST-4")).issue.relations).toEqual([{ key: "TEST-2", kind: "related" }]);
  await page.reload();
  await expect(page.getByRole("link", { name: "Browser fixture 4", exact: true })).toBeVisible();
});

test("a link resource the app adds is a remote link Jira keeps, so it survives a reload", async ({ page, app }) => {
  await app.seed({ writable: true });
  await openIssue(page, "TEST-2", "Browser fixture 2");

  await page.keyboard.press("Control+l");
  await page.keyboard.type("https://example.com/handbook");
  await page.keyboard.press("Enter");
  await expect(page.getByRole("status", { name: "Jira save status" })).toHaveText("Saved to Jira");
  expect((await app.jiraIssue("TEST-2")).full.remotelinks).toEqual([
    expect.objectContaining({ url: "https://example.com/handbook" }),
  ]);
  await page.reload();
  await expect(page.getByRole("region", { name: "Resources" }).getByRole("link", { name: "Example Domain" })).toBeVisible();
});

test("an issue deleted from the app is gone from Jira and stays gone after a reload", async ({ page, app }) => {
  await app.seed({ writable: true });
  await openIssue(page, "TEST-2", "Browser fixture 2");
  const row = page.getByRole("grid", { name: "Todo" }).getByRole("row", { name: "TEST-2 Browser fixture 2", exact: true });

  await page.keyboard.press("ControlOrMeta+Backspace");
  await page.getByRole("dialog").getByRole("button", { name: "Delete" }).click();
  await expect(row).toHaveCount(0);
  await expect.poll(async () => (await app.jiraIssue("TEST-2")).issue).toBeNull();
  await page.reload();
  await expect(page.getByRole("grid", { name: "Todo" }).getByRole("row", { name: "TEST-4 Browser fixture 4", exact: true })).toBeVisible();
  await expect(row).toHaveCount(0);
});

test("an issue deleted in Jira leaves the board and its open view says so", async ({ page, app }) => {
  await app.seed({ writable: true });
  await openIssue(page, "TEST-2", "Browser fixture 2");

  await app.changeInJira({ key: "TEST-2", delete: true });

  await expect(page.getByText("no longer on your boards", { exact: false })).toBeVisible();
  await expect(page.getByRole("grid", { name: "Todo" }).getByRole("row", { name: "TEST-2 Browser fixture 2", exact: true })).toHaveCount(0);
});

test("a milestone from Jira's fix versions can be set and survives a reload", async ({ page, app }) => {
  await app.seed({ writable: true, jiraEdits: true, catalog: { versions: ["Fixture 1.0"] } });
  await openIssue(page, "TEST-2", "Browser fixture 2");

  await page.keyboard.press("Shift+m");
  await page.getByRole("menuitem", { name: /Fixture 1\.0/ }).click();
  await expect(page.getByRole("status", { name: "Jira save status" })).toHaveText("Saved to Jira");
  expect((await app.jiraIssue("TEST-2")).issue.milestones).toEqual([{ id: "10000", name: "Fixture 1.0" }]);
  await page.reload();
  await expect(page.getByRole("button", { name: /Fixture 1\.0/ })).toBeVisible();
});

test("a new issue reads back from Jira with only the fields the composer set", async ({ page, app }) => {
  await app.seed({ writable: true, createSuccess: true });

  await page.keyboard.press("c");
  await page.getByRole("textbox", { name: "Issue title" }).fill("Composed fixture issue");
  await page.getByRole("button", { name: "Create issue" }).click();

  await expect.poll(async () => (await app.jiraIssues()).find((i) => i.summary === "Composed fixture issue")).toMatchObject({
    key: "TEST-90",
    assignee: null,
    labels: [],
  });
  await page.reload();
  await expect(page.getByRole("row", { name: "TEST-90 Composed fixture issue", exact: true })).toBeVisible();
});

test("a notification pushed to Jira's bell shows in the open inbox", async ({ page, app }) => {
  await app.seed();
  await page.getByRole("link", { name: "Inbox" }).click();

  await app.pushInbox({ n: 8, key: "TEST-5", title: "Browser fixture 5", message: "Priya mentioned you in a comment" });

  await expect(page.getByText("Priya mentioned you in a comment")).toBeVisible();
});

test("a view saved in one tab shows in another tab's sidebar without a reload", async ({ page, app }) => {
  await app.seed();
  const other = await page.context().newPage();
  await other.goto(page.url());
  await expect(other.getByRole("navigation", { name: "Main navigation" }).getByRole("link", { name: "Browser audit" })).toBeVisible();

  await page.getByRole("navigation", { name: "Main navigation" }).getByRole("button", { name: "New view" }).click();
  await page.getByRole("textbox", { name: "View name" }).fill("Pushed view");
  await page.getByRole("button", { name: "Create view" }).click();

  await expect(other.getByRole("navigation", { name: "Main navigation" }).getByRole("link", { name: "Pushed view" })).toBeVisible();
});

test("an upload Jira refuses leaves the description with Linear's toast, and goes in once Jira accepts it", async ({ page, app }) => {
  await app.seed({ writable: true });
  await openIssue(page, "TEST-2", "Browser fixture 2");
  await app.refuse(["upload"], "Jira refused the file.");
  const attach = async () => {
    const chooser = page.waitForEvent("filechooser");
    await page.getByRole("button", { name: "Attach images, files, or videos" }).first().click();
    await (await chooser).setFiles(image);
  };
  const description = page.getByRole("textbox", { name: "Issue description" });

  // Linear's upload catch removes the file (`Cje`) and says why (`showAlert("File failed to upload", message, true)`).
  await attach();
  await expect(page.getByRole("alertdialog", { name: /File failed to upload/ })).toContainText("Jira refused the file.");
  await expect(description.getByRole("img", { name: "media-image.png" })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Retry" })).toHaveCount(0);
  expect(await app.uploads()).toEqual([]);

  await app.refuse([]);
  await attach();
  await expect(description.getByRole("img", { name: "media-image.png" })).toBeVisible();
  await expect.poll(app.uploads).toEqual([expect.objectContaining({ key: "TEST-2", name: "media-image.png" })]);
});

test("a file whose upload answer was lost is found by its id on a later load and removed from Jira", async ({ page, app }) => {
  await app.seed({ writable: true });
  await openIssue(page, "TEST-2", "Browser fixture 2");
  // Jira keeps the file, but the answer never reaches the app.
  await page.route("**/api/issues/TEST-2/attachments", async (route) => {
    await route.fetch();
    await route.abort();
  });

  const chooser = page.waitForEvent("filechooser");
  await page.getByRole("button", { name: "Attach images, files, or videos" }).last().click();
  await (await chooser).setFiles(image);
  await expect.poll(app.uploads).toHaveLength(1);
  await page.unrouteAll();

  // The user comes back after the upload has settled.
  await page.clock.install({ time: Date.now() + 3 * 60_000 });
  await page.reload();

  const files = async () => (await app.jiraIssue("TEST-2")).full.fields.attachment.map((a: any) => a.filename);
  await expect.poll(files).not.toContain("media-image.png");
  const asked = (await app.requests()).filter((r) => r.path.startsWith("/api/uploads/"));
  expect(asked.map((r) => r.status)).toEqual([200]);
});
