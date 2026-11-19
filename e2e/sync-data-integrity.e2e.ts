import type { Page } from "@playwright/test";
import { expect, test, type JiraWrite } from "./app";

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
