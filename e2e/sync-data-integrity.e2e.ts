import type { Page } from "@playwright/test";
import { expect, test, type App, type JiraWrite } from "./app";

/** A write is resent after a 5 s backoff (src/client/state/outbox.ts RETRY_WAIT, UNREACHABLE_WAIT). */
const RESEND = { timeout: 15_000 };
const rename = (summary: string): JiraWrite["ops"] => [{ op: "fields", fields: { summary } }];
const prioritize = (priority: string): JiraWrite["ops"] => [{ op: "fields", fields: { priority } }];

const row = (page: Page, key: string, title: string, column = "Todo") =>
  page.getByRole("grid", { name: column }).getByRole("row", { name: `${key} ${title}`, exact: true });
const issueTitle = (page: Page) => page.getByRole("textbox", { name: "Issue title" });
const saveStatus = (page: Page) => page.getByRole("status", { name: "Jira save status" });
const priorityButton = (page: Page, priority: string) => page.getByRole("button", { name: priority, exact: true });

async function openIssue(page: Page, key: string, title: string) {
  await row(page, key, title).getByText(title, { exact: true }).click();
  await expect(issueTitle(page)).toHaveValue(title);
}
/** Types a new title in the open issue and leaves the field, which saves it. */
async function retitle(page: Page, title: string) {
  await issueTitle(page).fill(title);
  await issueTitle(page).press("Tab");
}
/** Picks a priority in the open issue's properties. */
async function setPriority(page: Page, from: string, to: string) {
  await priorityButton(page, from).click();
  await page.getByRole("menuitem", { name: to }).click();
  await expect(priorityButton(page, to)).toBeVisible();
}
/** The statuses Jira answered the app's writes with, in order. */
const opsAnswers = async (app: { requests(): Promise<{ path: string; status: number }[]> }) =>
  (await app.requests()).filter((r) => r.path.endsWith("/ops")).map((r) => r.status);
/** The last edit a test makes, on TEST-4. The outbox sends one write at a time, in order: once Jira has this one, any write
 *  an earlier step sent, or wrongly sent again, is in the log too. */
const SENTINEL: JiraWrite = { key: "TEST-4", ops: prioritize("High") };
async function sendSentinel(page: Page, app: { jiraWrites(): Promise<JiraWrite[]> }) {
  await openIssue(page, "TEST-4", "Browser fixture 4");
  await setPriority(page, "Urgent", "High");
  await expect.poll(async () => (await app.jiraWrites()).at(-1), RESEND).toEqual(SENTINEL);
}

test("56 a write Jira refuses rolls back and says why, and later writes still land", async ({ page, app }) => {
  await app.seed({ writable: true, jiraEdits: true });
  await openIssue(page, "TEST-2", "Browser fixture 2");
  await app.refuse(["summary"], "Summary is locked by a Jira workflow rule.");

  await retitle(page, "Refused title");

  await expect(page.getByRole("alertdialog", { name: "Jira did not save the change to TEST-2" })).toContainText(
    "Summary is locked by a Jira workflow rule.",
  );
  await expect(saveStatus(page)).toHaveText("Not saved to Jira: TEST-2: Summary is locked by a Jira workflow rule.");
  await expect(issueTitle(page)).toHaveValue("Browser fixture 2");
  await expect(row(page, "TEST-2", "Browser fixture 2")).toBeVisible();
  await expect(row(page, "TEST-2", "Refused title")).toHaveCount(0);
  expect((await app.jiraIssue("TEST-2")).issue.summary).toBe("Browser fixture 2");

  await page.getByRole("button", { name: "Dismiss Jira save error" }).click();
  await expect(saveStatus(page)).toHaveText("Saved to Jira");

  // Jira still refuses titles, but takes a priority change.
  await setPriority(page, "Low", "High");
  await expect(saveStatus(page)).toHaveText("Saved to Jira");
  expect((await app.jiraIssue("TEST-2")).issue).toMatchObject({ summary: "Browser fixture 2", priority: "High" });

  // Once Jira accepts titles again, the next rename lands.
  await app.refuse([]);
  await retitle(page, "Accepted title");
  await expect.poll(async () => (await app.jiraIssue("TEST-2")).issue.summary).toBe("Accepted title");
  await expect(saveStatus(page)).toHaveText("Saved to Jira");

  await page.reload();
  await expect(issueTitle(page)).toHaveValue("Accepted title");
  await expect(priorityButton(page, "High")).toBeVisible();
  await expect(row(page, "TEST-2", "Accepted title")).toBeVisible();
});

/** The saved local data's chunk (src/client/state/local-database.ts). The app's entry holds its code, so no Jira write may
 *  wait to fetch it. */
const STORE_CHUNK = /\/local-database-[^/]*\.js$/;

test("57 edits made offline are sent once the browser is back online, exactly once", async ({ page, app }) => {
  await app.seed({ writable: true, jiraEdits: true });
  await openIssue(page, "TEST-2", "Browser fixture 2");

  await page.context().setOffline(true);
  await retitle(page, "Renamed offline");
  await setPriority(page, "Low", "High");

  await expect(saveStatus(page)).toContainText("Can't reach the better-jira server. Retrying…");
  await expect(row(page, "TEST-2", "Renamed offline")).toBeVisible();
  expect(await app.jiraWrites()).toEqual([]);

  await page.context().setOffline(false);

  await expect(saveStatus(page)).toHaveText("Saved to Jira", RESEND);
  expect(await app.jiraWrites()).toEqual([
    { key: "TEST-2", ops: rename("Renamed offline") },
    { key: "TEST-2", ops: prioritize("High") },
  ]);
  expect((await app.jiraIssue("TEST-2")).issue).toMatchObject({ summary: "Renamed offline", priority: "High" });

  // A reload replays anything still unsent: nothing goes twice.
  await page.reload();
  await expect(issueTitle(page)).toHaveValue("Renamed offline");
  await expect(priorityButton(page, "High")).toBeVisible();
  await sendSentinel(page, app);
  expect(await app.jiraWrites()).toEqual([
    { key: "TEST-2", ops: rename("Renamed offline") },
    { key: "TEST-2", ops: prioritize("High") },
    SENTINEL,
  ]);
});

test("57 an edit made offline before the app finished loading is still sent once back online", async ({ page, app }) => {
  // The connection drops while the app is still loading; that chunk, if anything asks for it, never arrives.
  let dropped!: () => void;
  const offline = new Promise<void>((resolve) => (dropped = resolve));
  await page.route(STORE_CHUNK, async (route) => (await offline, route.abort("internetdisconnected")), { times: 1 });
  await app.seed({ writable: true, jiraEdits: true });
  await openIssue(page, "TEST-2", "Browser fixture 2");
  await page.context().setOffline(true);
  dropped();

  await retitle(page, "Renamed offline");

  await expect(saveStatus(page)).toContainText("Can't reach the better-jira server. Retrying…");
  await page.context().setOffline(false);
  await expect.poll(app.jiraWrites, RESEND).toEqual([{ key: "TEST-2", ops: rename("Renamed offline") }]);
  await expect(saveStatus(page)).toHaveText("Saved to Jira");
  await page.reload();
  await expect(issueTitle(page)).toHaveValue("Renamed offline");
});

const description = (page: Page) => page.getByRole("textbox", { name: "Issue description" });
const descriptionImage = (page: Page) => description(page).getByRole("img", { name: "media-image.png" });
/** The text of an ADF document, its blocks one per line. */
const plain = (node: any): string =>
  node?.type === "text" ? node.text : (node?.content ?? []).map(plain).join(node?.type === "doc" ? "\n" : "");
/** Every media id an ADF document shows. */
const mediaIds = (node: any): string[] => [
  ...(node?.type === "media" && node.attrs?.id ? [String(node.attrs.id)] : []),
  ...(node?.content ?? []).flatMap(mediaIds),
];

/** Picks the test image through the paperclip `which` (the description's comes first, the comment box's last). */
async function attachImage(page: Page, which: "first" | "last") {
  const chooser = page.waitForEvent("filechooser");
  await page.getByRole("button", { name: "Attach images, files, or videos" })[which]().click();
  await (await chooser).setFiles("scripts/fixtures/media-image.png");
}
/** Linear's toast for a file it couldn't upload (`showAlert("File failed to upload", …)`). */
const uploadFailed = (page: Page) => page.getByRole("alertdialog", { name: /File failed to upload/ });
/** What Jira's description of `key` reads and shows. */
const jiraDescription = async (app: { jiraIssue(key: string): Promise<{ full: any }> }, key: string) => {
  const doc = (await app.jiraIssue(key)).full.fields.description;
  return { text: plain(doc), media: mediaIds(doc) };
};

test("57 a file put into a description offline is refused as Linear refuses it, and the text typed with it reaches Jira once", async ({ page, app }) => {
  await app.seed({ writable: true, jiraEdits: true });
  await app.changeInJira({ key: "TEST-2", description: "Steps to reproduce" });
  await openIssue(page, "TEST-2", "Browser fixture 2");
  await expect(description(page)).toHaveText("Steps to reproduce");
  await expect(description(page)).not.toHaveAttribute("aria-busy", "true");

  // Linear can't upload offline: the file leaves the editor at once and a toast says why. Nothing waits to go later.
  await page.context().setOffline(true);
  await attachImage(page, "first");
  await expect(uploadFailed(page)).toContainText("Cannot upload files while being offline.");
  await expect(descriptionImage(page)).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Retry" })).toHaveCount(0);
  await description(page).getByText("Steps to reproduce", { exact: true }).click();
  await page.keyboard.press("End");
  await page.keyboard.type(" while offline");
  await expect(saveStatus(page)).toContainText("Can't reach the better-jira server. Retrying…");

  await page.context().setOffline(false);

  await expect(saveStatus(page)).toHaveText("Saved to Jira", RESEND);
  await expect.poll(() => jiraDescription(app, "TEST-2"), RESEND).toEqual({ text: "Steps to reproduce while offline", media: [] });
  expect(await app.uploads()).toEqual([]);

  // Back online the same file goes in, once.
  await attachImage(page, "first");
  await expect(descriptionImage(page)).toBeVisible();
  await expect.poll(app.uploads, RESEND).toEqual([expect.objectContaining({ key: "TEST-2", name: "media-image.png" })]);
  const [upload] = await app.uploads();
  await expect
    .poll(() => jiraDescription(app, "TEST-2"), RESEND)
    .toEqual({ text: expect.stringContaining("Steps to reproduce while offline"), media: [upload!.mediaId] });
  await expect(saveStatus(page)).toHaveText("Saved to Jira", RESEND);
  const sent = await app.jiraWrites();

  // A reload replays anything still unsent: nothing goes twice.
  await page.reload();
  await expect(description(page)).toContainText("Steps to reproduce while offline");
  await expect(descriptionImage(page)).toBeVisible();
  await sendSentinel(page, app);
  expect(await app.jiraWrites()).toEqual([...sent, SENTINEL]);
  expect(await app.uploads()).toHaveLength(1);
});

test("57 a file put into a comment offline is refused as Linear refuses it, and the comment keeps its text", async ({ page, app }) => {
  await app.seed({ writable: true, jiraComments: true });
  await openIssue(page, "TEST-2", "Browser fixture 2");
  const comment = page.getByRole("textbox", { name: "Leave a comment…" });
  await comment.fill("Seen while offline");

  await page.context().setOffline(true);
  await attachImage(page, "last");
  await expect(uploadFailed(page)).toContainText("Cannot upload files while being offline.");
  await expect(comment.getByRole("img")).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Retry" })).toHaveCount(0);
  await expect(comment).toHaveText("Seen while offline");
  expect(await app.uploads()).toEqual([]);

  // Back online the same file goes in, and the comment posts with it once.
  await page.context().setOffline(false);
  await attachImage(page, "last");
  await expect(comment.getByRole("img", { name: "media-image.png" })).toBeVisible();
  await page.getByRole("button", { name: "Submit comment" }).click();
  await expect(saveStatus(page)).toHaveText("Saved to Jira", RESEND);
  const [upload, ...more] = await app.uploads();
  expect(more).toEqual([]);
  const posted = ((await app.jiraIssue("TEST-2")).full.fields.comment.comments as any[]).filter((c) =>
    plain(c.body).includes("Seen while offline"),
  );
  expect(posted.map((c) => mediaIds(c.body))).toEqual([[upload!.mediaId]]);
});

test("57 a file that failed to upload says so in Linear's error toast, its red icon 8px before the title", async ({ page, app }) => {
  await app.seed({ writable: true });
  await openIssue(page, "TEST-2", "Browser fixture 2");
  await page.context().setOffline(true);
  await attachImage(page, "first");

  // Linear's error toast (`showAlert(…, true)`, Toast `W[error]`): a 16px round icon in redBase, the text 8px after it.
  const toast = uploadFailed(page);
  await expect(toast).toContainText("Cannot upload files while being offline.");
  const look = await toast.evaluate((card) => {
    const svg = card.querySelector("svg"),
      title = [...card.querySelectorAll("p")].find((p) => p.textContent?.includes("File failed to upload"));
    const probe = document.createElement("i");
    probe.style.color = "var(--red-base)";
    document.body.append(probe);
    const red = getComputedStyle(probe).color;
    probe.remove();
    if (!svg || !title) return null;
    const icon = svg.getBoundingClientRect(),
      text = document.createRange();
    text.selectNodeContents(title.lastChild!);
    return {
      size: [icon.width, icon.height],
      red: getComputedStyle(svg.querySelector("path")!).fill === red,
      gap: Math.round(text.getBoundingClientRect().left - icon.right),
    };
  });
  expect(look).toEqual({ size: [16, 16], red: true, gap: 8 });
});

test("57 an image whose upload Jira has is placed in the description even when the page reloads right after", async ({ page, app }) => {
  await app.seed({ writable: true });
  await app.changeInJira({ key: "TEST-2", description: "Steps to reproduce" });
  await openIssue(page, "TEST-2", "Browser fixture 2");
  await expect(description(page)).toHaveText("Steps to reproduce");
  await expect(description(page)).not.toHaveAttribute("aria-busy", "true");

  // A slow device: measuring the image takes this page a few seconds, and the reload comes the moment Jira answers the
  // upload. Jira has the file; the description doesn't show it yet.
  await page.evaluate(() => {
    const measure = window.createImageBitmap.bind(window) as (...args: unknown[]) => Promise<ImageBitmap>;
    window.createImageBitmap = ((...args: unknown[]) =>
      new Promise((resolve) => setTimeout(resolve, 5000)).then(() => measure(...args))) as typeof createImageBitmap;
  });
  const answer = page.waitForResponse("**/api/issues/TEST-2/attachments");
  await attachImage(page, "first");
  await (await answer).finished();
  // Leaving with the write still on its way asks first; the reload goes ahead.
  page.on("dialog", (dialog) => void dialog.accept());
  await page.reload();

  await expectPlacedOnce(page, app);
});

test("57 an image is placed in the description and lands once even when the page reloads before Jira answers its upload", async ({
  page,
  app,
}) => {
  await app.seed({ writable: true });
  await app.changeInJira({ key: "TEST-2", description: "Steps to reproduce" });
  await openIssue(page, "TEST-2", "Browser fixture 2");
  await expect(description(page)).toHaveText("Steps to reproduce");
  await expect(description(page)).not.toHaveAttribute("aria-busy", "true");

  // Jira takes the file, but the page reloads before its answer arrives (route.fetch would send the upload without its file).
  await page.evaluate(() => {
    const send = window.fetch.bind(window);
    window.fetch = ((input: RequestInfo | URL, init?: RequestInit) => {
      if (!String(input).endsWith("/api/issues/TEST-2/attachments")) return send(input, init);
      return send(input, init).then(() => {
        document.body.dataset.uploadReached = "true";
        return new Promise<Response>(() => {});
      });
    }) as typeof fetch;
  });
  await attachImage(page, "first");
  await expect(page.locator("body[data-upload-reached]")).toHaveCount(1);
  page.on("dialog", (dialog) => void dialog.accept());
  await page.reload();

  await expectPlacedOnce(page, app);
});

/** TEST-2's description shows the test image after the reload, and Jira has it there, uploaded once. */
async function expectPlacedOnce(page: Page, app: App) {
  await expect(descriptionImage(page)).toBeVisible();
  await expect.poll(async () => (await jiraDescription(app, "TEST-2")).media.length, RESEND).toBe(1);
  const [upload, ...more] = await app.uploads();
  expect(more).toEqual([]);
  expect(await jiraDescription(app, "TEST-2")).toEqual({
    text: expect.stringContaining("Steps to reproduce"),
    media: [upload!.mediaId],
  });
  await expect(saveStatus(page)).toHaveText("Saved to Jira", RESEND);
  expect(await app.uploads()).toHaveLength(1);
}

/** Fills the composer with a new issue and an image picked through its paperclip; the file uploads once Jira has made the
 *  issue. Answers the composer's Create issue button. */
async function composeWithFile(page: Page) {
  await expect(page.getByRole("grid", { name: "Todo" }).getByRole("row").first()).toBeVisible();
  await page.keyboard.press("c");
  const composer = page.getByRole("dialog", { name: "Create issue" });
  await composer.getByRole("textbox", { name: "Issue title", exact: true }).fill("Made with a file");
  const chooser = page.waitForEvent("filechooser");
  await composer.getByRole("button", { name: "Attach images, files, or videos" }).click();
  await (await chooser).setFiles("scripts/fixtures/media-image.png");
  await expect(composer.getByRole("img", { name: "media-image.png" })).toBeVisible();
  return composer.getByRole("button", { name: "Create issue" });
}

test("57 a new issue's file whose upload the connection cut off is sent once back online, exactly once", async ({ page, app }) => {
  await app.seed({ writable: true, jiraEdits: true, createSuccess: true });
  const create = await composeWithFile(page);
  // The connection drops the moment Jira answers the create, before the file's upload.
  await page.route(
    "**/api/issues/*/ops",
    async (route) => {
      const response = await route.fetch();
      await page.context().setOffline(true);
      await route.fulfill({ response });
    },
    { times: 1 },
  );
  await create.click();

  await expect(saveStatus(page)).toContainText("Can't reach the better-jira server. Retrying…");
  expect(await app.uploads()).toEqual([]);

  await page.context().setOffline(false);

  await expect.poll(app.uploads, RESEND).toEqual([expect.objectContaining({ key: "TEST-90", name: "media-image.png" })]);
  await expect(saveStatus(page)).toHaveText("Saved to Jira", RESEND);
  const [upload] = await app.uploads();
  expect((await app.jiraIssue("TEST-90")).full.fields.attachment).toEqual([
    expect.objectContaining({ id: upload!.id, filename: "media-image.png" }),
  ]);
  const sent = await app.jiraWrites();

  // A reload replays anything still unsent: nothing goes twice.
  await page.reload();
  await expect(row(page, "TEST-90", "Made with a file", "Backlog")).toBeVisible();
  await sendSentinel(page, app);
  expect(await app.jiraWrites()).toEqual([...sent, SENTINEL]);
  expect(await app.uploads()).toHaveLength(1);
});

test("57 a new issue's file Jira refuses is not sent again, and says why", async ({ page, app }) => {
  await app.seed({ writable: true, createSuccess: true });
  await app.refuse(["upload"], "Jira refused the file.");
  await (await composeWithFile(page)).click();

  await expect(page.getByRole("alertdialog", { name: "Jira did not save the change to TEST-90" })).toContainText(
    "Jira refused the file.",
  );
  await expect(saveStatus(page)).toHaveText("Not saved to Jira: TEST-90: Jira refused the file.");
  expect(await app.uploads()).toEqual([]);
  expect((await app.jiraIssue("TEST-90")).full.fields.attachment).toEqual([]);
});

test("57 a file picked offline in the new-issue composer is refused as Linear refuses it, and the issue is made without it", async ({
  page,
  app,
}) => {
  // Known failure: the composer keeps the file and uploads it once the issue is made, whenever that is.
  test.fail();
  await app.seed({ writable: true, createSuccess: true });
  await expect(page.getByRole("grid", { name: "Todo" }).getByRole("row").first()).toBeVisible();
  await page.keyboard.press("c");
  const composer = page.getByRole("dialog", { name: "Create issue" });
  await composer.getByRole("textbox", { name: "Issue title", exact: true }).fill("Made offline");

  // Linear's composer uploads a file the moment it is picked, so offline it can't: the file stays out and a toast says why.
  await page.context().setOffline(true);
  const chooser = page.waitForEvent("filechooser");
  await composer.getByRole("button", { name: "Attach images, files, or videos" }).click();
  await (await chooser).setFiles("scripts/fixtures/media-image.png");
  await expect(uploadFailed(page)).toContainText("Cannot upload files while being offline.");
  await expect(composer.getByRole("img", { name: "media-image.png" })).toHaveCount(0);

  await page.context().setOffline(false);
  await composer.getByRole("button", { name: "Create issue" }).click();
  await expect(saveStatus(page)).toHaveText("Saved to Jira", RESEND);
  expect((await app.jiraIssue("TEST-90")).issue.summary).toBe("Made offline");
  expect((await app.jiraIssue("TEST-90")).full.fields.attachment).toEqual([]);
  expect(await app.uploads()).toEqual([]);
});

test("57 a file put into a new sub-issue's description offline is refused as Linear refuses it", async ({ page, app }) => {
  // Known failure: the sub-issue composer keeps the file and uploads it once the sub-issue is made.
  test.fail();
  await app.seed({ writable: true, createSuccess: true });
  await openIssue(page, "TEST-2", "Browser fixture 2");
  const subIssues = page.getByRole("region", { name: "Sub-issues" });
  await subIssues.getByRole("button", { name: "Add sub-issues" }).click();
  await subIssues.getByRole("textbox", { name: "Sub-issue title" }).fill("Child made offline");

  await page.context().setOffline(true);
  const chooser = page.waitForEvent("filechooser");
  await subIssues.getByRole("button", { name: "Attach images, files, or videos" }).click();
  await (await chooser).setFiles("scripts/fixtures/media-image.png");
  await expect(uploadFailed(page)).toContainText("Cannot upload files while being offline.");
  await expect(subIssues.getByRole("img", { name: "media-image.png" })).toHaveCount(0);

  await page.context().setOffline(false);
  await subIssues.getByRole("button", { name: "Create", exact: true }).click();
  await expect(subIssues.getByText("Child made offline", { exact: true })).toBeVisible();
  await expect(saveStatus(page)).toHaveText("Saved to Jira", RESEND);
  expect((await app.jiraIssue("TEST-90")).full.fields.attachment).toEqual([]);
  expect(await app.uploads()).toEqual([]);
});

test("58 an edit whose send Jira never answered is sent again and lands once", async ({ page, app }) => {
  await app.seed({ writable: true, jiraEdits: true });
  await openIssue(page, "TEST-2", "Browser fixture 2");
  await app.unanswered(1);

  await retitle(page, "Sent after no answer");

  await expect.poll(() => opsAnswers(app), RESEND).toEqual([503, 200]);
  await expect(saveStatus(page)).toHaveText("Saved to Jira");
  expect(await app.jiraWrites()).toEqual([{ key: "TEST-2", ops: rename("Sent after no answer") }]);
  expect((await app.jiraIssue("TEST-2")).issue.summary).toBe("Sent after no answer");

  await page.reload();
  await expect(issueTitle(page)).toHaveValue("Sent after no answer");
  await sendSentinel(page, app);
  expect(await opsAnswers(app)).toEqual([503, 200, 200]);
  expect(await app.jiraWrites()).toEqual([{ key: "TEST-2", ops: rename("Sent after no answer") }, SENTINEL]);
});

test("58 a new issue whose answer Jira lost is sent again and made once, never twice", async ({ page, app }) => {
  await app.seed({ writable: true, jiraEdits: true, createSuccess: true });
  await app.unanswered(1, { applied: true });

  await page.keyboard.press("c");
  await page.getByRole("textbox", { name: "Issue title" }).fill("Made once");
  await page.getByRole("button", { name: "Create issue" }).click();

  await expect.poll(() => opsAnswers(app), RESEND).toEqual([503, 200]);
  await expect(saveStatus(page)).toHaveText("Saved to Jira");
  const made = async () => (await app.jiraIssues()).filter((i) => i.summary === "Made once").map((i) => i.key);
  expect(await made()).toEqual(["TEST-90"]);
  await expect(page.getByRole("row", { name: /Made once$/ })).toHaveCount(1);
  await expect(page.getByRole("row", { name: "TEST-90 Made once", exact: true })).toBeVisible();

  await page.reload();
  await expect(page.getByRole("row", { name: "TEST-90 Made once", exact: true })).toBeVisible();
  await expect(page.getByRole("row", { name: /Made once$/ })).toHaveCount(1);
  await sendSentinel(page, app);
  expect(await made()).toEqual(["TEST-90"]);
  expect(await opsAnswers(app)).toEqual([503, 200, 200]);
});

/** The statuses the app's uploads were answered with, in order. */
const uploadAnswers = async (app: { requests(): Promise<{ path: string; status: number }[]> }) =>
  (await app.requests()).filter((r) => r.path.endsWith("/attachments")).map((r) => r.status);

test("58 a new issue's file whose upload Jira didn't answer is sent again and attached once, not rolled back", async ({ page, app }) => {
  await app.seed({ writable: true, jiraEdits: true, createSuccess: true });
  await app.unanswered(1, { applied: true, uploads: true });
  await (await composeWithFile(page)).click();

  await expect.poll(() => uploadAnswers(app), RESEND).toEqual([503, 200]);
  await expect(saveStatus(page)).toHaveText("Saved to Jira", RESEND);
  const [upload, ...more] = await app.uploads();
  expect(more).toEqual([]);
  expect((await app.jiraIssue("TEST-90")).full.fields.attachment).toEqual([
    expect.objectContaining({ id: upload!.id, filename: "media-image.png" }),
  ]);
  await expect(page.getByRole("alertdialog", { name: /Jira did not save/ })).toHaveCount(0);
});

test("58 an existing issue's file whose upload Jira didn't answer is sent again at once and lands once", async ({ page, app }) => {
  await app.seed({ writable: true, jiraEdits: true });
  await openIssue(page, "TEST-2", "Browser fixture 2");
  await app.unanswered(1, { applied: true, uploads: true });

  // Linear's editor upload tries once more at once (`retryOnFailure`: one retry, no backoff); the server gives back the
  // file the first send made.
  await attachImage(page, "first");
  await expect(descriptionImage(page)).toBeVisible();
  await expect.poll(() => uploadAnswers(app), RESEND).toEqual([503, 200]);
  await expect(page.getByRole("button", { name: "Retry" })).toHaveCount(0);
  const [upload, ...more] = await app.uploads();
  expect(more).toEqual([]);
  await expect.poll(async () => (await jiraDescription(app, "TEST-2")).media, RESEND).toEqual([upload!.mediaId]);
});

test("58 an existing issue's file whose upload Jira didn't answer twice leaves the description with Linear's toast", async ({
  page,
  app,
}) => {
  await app.seed({ writable: true, jiraEdits: true });
  await app.changeInJira({ key: "TEST-2", description: "Steps to reproduce" });
  await openIssue(page, "TEST-2", "Browser fixture 2");
  await expect(description(page)).toHaveText("Steps to reproduce");
  await app.unanswered(2, { uploads: true });

  await attachImage(page, "first");
  await expect(uploadFailed(page)).toContainText("Jira didn't answer.");
  await expect(descriptionImage(page)).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Retry" })).toHaveCount(0);
  expect(await uploadAnswers(app)).toEqual([503, 503]);
  expect(await app.uploads()).toEqual([]);
  await expect(description(page)).toHaveText("Steps to reproduce");
});

test("59 local edits survive a reload and replay only what Jira lacks", async ({ page, app }) => {
  await app.seed({ writable: true, jiraEdits: true });
  await openIssue(page, "TEST-2", "Browser fixture 2");

  // Jira takes the rename, but its answer never comes back.
  await app.unanswered(1, { applied: true });
  await retitle(page, "Jira took this");
  await expect.poll(() => opsAnswers(app)).toEqual([503]);
  // The server can't be reached for the next edit, so Jira lacks it.
  let reachable = false;
  await page.route("**/api/issues/*/ops", (route) => (reachable ? route.continue() : route.abort()));
  await setPriority(page, "Low", "High");
  await expect(page.getByRole("status", { name: "Local save status" })).toHaveText("Saved locally");

  reachable = true;
  await page.reload();

  await expect(issueTitle(page)).toHaveValue("Jira took this");
  await expect(priorityButton(page, "High")).toBeVisible();
  // The rename the lost answer applied went once; after the reload only the priority Jira lacked went.
  await expect.poll(app.jiraWrites, RESEND).toEqual([
    { key: "TEST-2", ops: rename("Jira took this") },
    { key: "TEST-2", ops: prioritize("High") },
  ]);
  await expect(saveStatus(page)).toHaveText("Saved to Jira");
  expect((await app.jiraIssue("TEST-2")).issue).toMatchObject({ summary: "Jira took this", priority: "High" });

  await page.reload();
  await expect(priorityButton(page, "High")).toBeVisible();
  await sendSentinel(page, app);
  expect(await app.jiraWrites()).toEqual([
    { key: "TEST-2", ops: rename("Jira took this") },
    { key: "TEST-2", ops: prioritize("High") },
    SENTINEL,
  ]);
});

test("59 opening and reloading issues writes nothing to Jira", async ({ page, app }) => {
  await app.seed({ writable: true, jiraEdits: true });

  await openIssue(page, "TEST-1", "Rich browser fixture");
  await expect(page.getByRole("textbox", { name: "Issue description" })).toBeVisible();
  await openIssue(page, "TEST-2", "Browser fixture 2");
  await expect(page.getByRole("textbox", { name: "Issue description" })).toBeVisible();
  await page.reload();
  await expect(issueTitle(page)).toHaveValue("Browser fixture 2");
  await openIssue(page, "TEST-4", "Browser fixture 4");

  // A write of the user's own goes last: everything before it has reached the fake Jira by the time it lands.
  await setPriority(page, "Urgent", "Low");
  await expect(saveStatus(page)).toHaveText("Saved to Jira");
  await expect.poll(app.jiraWrites).toEqual([{ key: "TEST-4", ops: prioritize("Low") }]);
});

test("60 closing a tab with unsent edits asks first, and once they land it closes without asking", async ({ page, app }) => {
  await app.seed({ writable: true, jiraEdits: true });
  await openIssue(page, "TEST-2", "Browser fixture 2");
  await page.route("**/api/issues/*/ops", (route) => route.abort());

  await retitle(page, "Not sent yet");
  await expect(saveStatus(page)).toContainText("Can't reach the better-jira server. Retrying…");

  const asked = page.waitForEvent("dialog");
  await page.close({ runBeforeUnload: true });
  const dialog = await asked;
  expect(dialog.type()).toBe("beforeunload");
  await dialog.dismiss();

  // The user stayed: the edit is still there, and goes once the server answers.
  expect(page.isClosed()).toBe(false);
  await expect(issueTitle(page)).toHaveValue("Not sent yet");
  await page.unrouteAll();
  await expect(saveStatus(page)).toHaveText("Saved to Jira", RESEND);
  expect(await app.jiraWrites()).toEqual([{ key: "TEST-2", ops: rename("Not sent yet") }]);

  const dialogs: string[] = [];
  page.on("dialog", (d) => {
    dialogs.push(d.type());
    void d.dismiss();
  });
  await page.close({ runBeforeUnload: true });
  await expect.poll(() => page.isClosed()).toBe(true);
  expect(dialogs).toEqual([]);
});

test("61 undo and redo an edit, and Jira gets each reverse change", async ({ page, app }) => {
  await app.seed({ writable: true, jiraEdits: true });
  await openIssue(page, "TEST-2", "Browser fixture 2");
  const jiraPriority = async () => (await app.jiraIssue("TEST-2")).issue.priority;

  await setPriority(page, "Low", "High");
  await expect.poll(jiraPriority).toBe("High");
  await expect(saveStatus(page)).toHaveText("Saved to Jira");

  await page.keyboard.press("ControlOrMeta+z");
  await expect(priorityButton(page, "Low")).toBeVisible();
  await expect.poll(jiraPriority).toBe("Low");
  await expect(saveStatus(page)).toHaveText("Saved to Jira");
  await expect(page.getByRole("button", { name: "Undo" })).toBeDisabled();

  await page.keyboard.press("ControlOrMeta+Shift+z");
  await expect(priorityButton(page, "High")).toBeVisible();
  await expect.poll(jiraPriority).toBe("High");
  await expect(saveStatus(page)).toHaveText("Saved to Jira");
  await expect(page.getByRole("button", { name: "Redo" })).toBeDisabled();

  expect(await app.jiraWrites()).toEqual([
    { key: "TEST-2", ops: prioritize("High") },
    { key: "TEST-2", ops: prioritize("Low") },
    { key: "TEST-2", ops: prioritize("High") },
  ]);
  await page.reload();
  await expect(priorityButton(page, "High")).toBeVisible();
});

test("62 a priority, assignee and labels changed in Jira show on the board and the open issue without a reload", async ({
  page,
  app,
}) => {
  await app.seed({ writable: true, jiraEdits: true });
  await openIssue(page, "TEST-2", "Browser fixture 2");

  await app.changeInJira({ key: "TEST-2", priority: "Urgent", assignee: "priya", labels: ["backend"] });

  await expect(priorityButton(page, "Urgent")).toBeVisible();
  await expect(page.getByRole("button", { name: /Priya Raman$/ })).toBeVisible();
  await expect(page.getByRole("button", { name: "backend", exact: true })).toBeVisible();
  await expect(row(page, "TEST-2", "Browser fixture 2").getByRole("button", { name: "Labels on TEST-2" })).toHaveText("backend");
  await sendSentinel(page, app);
  expect(await app.jiraWrites()).toEqual([SENTINEL]);
});

test("62 a rename in Jira never replaces a title being typed, and the typed title is what gets saved", async ({ page, app }) => {
  await app.seed({ writable: true, jiraEdits: true });
  await openIssue(page, "TEST-2", "Browser fixture 2");
  await issueTitle(page).fill("Typed by me");

  await app.changeInJira({ key: "TEST-2", summary: "Renamed in Jira" });

  // The board took Jira's rename, so the open issue has it too, and the field still holds what was typed.
  await expect(row(page, "TEST-2", "Renamed in Jira")).toBeVisible();
  await expect(issueTitle(page)).toHaveValue("Typed by me");
  await expect(issueTitle(page)).toBeFocused();

  await issueTitle(page).press("Tab");
  await expect(row(page, "TEST-2", "Typed by me")).toBeVisible();
  await expect.poll(async () => (await app.jiraIssue("TEST-2")).issue.summary).toBe("Typed by me");
  expect(await app.jiraWrites()).toEqual([{ key: "TEST-2", ops: rename("Typed by me") }]);
  await page.reload();
  await expect(issueTitle(page)).toHaveValue("Typed by me");
});

test("62 a title focused but not typed in takes Jira's rename on leaving, without writing the old title back", async ({
  page,
  app,
}) => {
  await app.seed({ writable: true, jiraEdits: true });
  await openIssue(page, "TEST-2", "Browser fixture 2");
  await issueTitle(page).focus();

  await app.changeInJira({ key: "TEST-2", summary: "Renamed in Jira" });
  await expect(row(page, "TEST-2", "Renamed in Jira")).toBeVisible();
  await issueTitle(page).press("Tab");

  await expect(issueTitle(page)).toHaveValue("Renamed in Jira");
  // A write of the user's own goes last: anything the title sent has reached the fake Jira by the time it lands.
  await setPriority(page, "Low", "High");
  await expect(saveStatus(page)).toHaveText("Saved to Jira");
  await expect.poll(app.jiraWrites).toEqual([{ key: "TEST-2", ops: prioritize("High") }]);
  expect((await app.jiraIssue("TEST-2")).issue.summary).toBe("Renamed in Jira");
});

test("63 an open issue deleted in Jira closes, says why, drops its sub-issue draft and writes nothing", async ({ page, app }) => {
  await app.seed({ writable: true, jiraEdits: true });
  await openIssue(page, "TEST-2", "Browser fixture 2");
  await page.getByRole("button", { name: "Add sub-issues" }).click();
  await page.getByRole("textbox", { name: "Sub-issue title" }).fill("Child never made");

  await app.changeInJira({ key: "TEST-2", delete: true });

  await expect(page.getByRole("alertdialog", { name: "TEST-2 was deleted in Jira" })).toContainText(
    "It is no longer on your boards. Its unsaved sub-issue draft was discarded.",
  );
  await expect(issueTitle(page)).toHaveCount(0);
  await expect(page).not.toHaveURL(/TEST-2/);
  await expect(row(page, "TEST-2", "Browser fixture 2")).toHaveCount(0);

  // The board still works: another issue opens, with no trace of the dropped draft.
  await openIssue(page, "TEST-4", "Browser fixture 4");
  await expect(page.getByText("Child never made")).toHaveCount(0);
  await setPriority(page, "Urgent", "High");
  await expect(saveStatus(page)).toHaveText("Saved to Jira");
  await expect.poll(app.jiraWrites).toEqual([{ key: "TEST-4", ops: prioritize("High") }]);

  await page.reload();
  await expect(row(page, "TEST-4", "Browser fixture 4")).toBeVisible();
  await expect(row(page, "TEST-2", "Browser fixture 2")).toHaveCount(0);
  expect((await app.jiraIssue("TEST-2")).issue).toBeNull();
});
