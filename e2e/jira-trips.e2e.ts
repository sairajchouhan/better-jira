import type { Page } from "@playwright/test";
import { expect, test, type App } from "./app";
import { JIRA_MESSAGES } from "../src/shared/jira-trips";

/** Trips to Jira (src/shared/jira-trips.ts): every way the app sends its user to the Jira site it's connected to is recorded
 *  by the server, with where the user was and the page's path pattern; going somewhere in the app is not. */

const SITE = "https://example.atlassian.net";
const FILTER = `${SITE}/issues/?jql=project%20%3D%20TEST`;
const PAGE = `${SITE}/wiki/spaces/ENG/pages/123456/Release+checklist`;
const ISSUE = `${SITE}/browse/TEST-3`;
const DASHBOARD = `${SITE}/jira/dashboards/10000`;

test.beforeEach(async ({ context }) => {
  // Jira's own pages, and any other site a link opens, answer here: a trip never leaves the machine.
  await context.route(/^https:\/\/(?!127\.0\.0\.1)/, (route) => route.fulfill({ contentType: "text/html", body: "<title>Elsewhere</title>" }));
});

const text = (t: string) => ({ type: "text", text: t });
const link = (t: string, href: string) => ({ type: "text", text: t, marks: [{ type: "link", attrs: { href } }] });
const card = (url: string) => ({ type: "inlineCard", attrs: { url } });
/** TEST-2's description in Jira: a filter link, a Confluence page and an issue on this site. */
const description = {
  type: "doc",
  version: 1,
  content: [
    { type: "paragraph", content: [text("See "), link("the open filter", FILTER), text(".")] },
    { type: "paragraph", content: [text("Page "), card(PAGE), text(" issue "), card(ISSUE)] },
  ],
};

async function openIssue(page: Page, key = "TEST-2", title = "Browser fixture 2") {
  await page.getByRole("grid", { name: "Todo" }).getByRole("row", { name: `${key} ${title}`, exact: true }).getByText(title, { exact: true }).click();
  await expect(page.getByRole("textbox", { name: "Issue title" })).toHaveValue(title);
}
const descriptionLinks = async (page: Page, app: App) => {
  await app.changeInJira({ key: "TEST-2", description });
  await openIssue(page);
  return page.locator(".issue-description");
};
/** Adds `url` to TEST-2 as a link resource (opening the issue first unless `open` is false). */
async function addLink(page: Page, url: string, open = true) {
  if (open) await openIssue(page);
  await page.keyboard.press("Control+l");
  const form = page.getByRole("dialog", { name: "Add link" });
  await form.getByRole("textbox", { name: "URL", exact: true }).fill(url);
  await form.getByRole("button", { name: "Add link" }).click();
  await expect(page.getByRole("region", { name: "Resources" }).locator(`a[href="${url}"]`)).toBeVisible();
}
/** Reloads, so the board reads the issues' web links, and turns on the cards' Links property. */
async function showLinksOnCards(page: Page) {
  await page.goto(new URL("/", page.url()).href);
  await page.getByRole("button", { name: "Display options" }).click();
  const display = page.getByRole("dialog", { name: "Display options" });
  await display.getByRole("button", { name: "Links", exact: true }).click();
  await page.keyboard.press("Escape");
}
const inbox = (page: Page) => page.getByRole("navigation", { name: "Main navigation" }).getByRole("link", { name: /^Inbox/ });
const inboxRow = (page: Page, key: string) => page.getByRole("region", { name: "Inbox" }).getByRole("link", { name: new RegExp(`^(Unread|Read) ${key} `) });
const mod = process.platform === "darwin" ? "Meta" : "Control";

type Exit = {
  name: string;
  settings?: Parameters<App["seed"]>[0];
  /** Does what sends the user to Jira; `app` and the page are seeded. */
  go(page: Page, app: App): Promise<void>;
  /** The trip the server keeps. */
  trip: { kind: string; path: string | null; screen?: string; issue?: string | null };
};

const EXITS: Exit[] = [
  {
    name: "the issue's key in its header",
    go: async (page) => {
      await openIssue(page);
      await page.locator("[data-trip=issue-key]").click();
    },
    trip: { kind: "issue-key", path: "/browse/:key", issue: "TEST-2" },
  },
  {
    name: "the issue's crumb on its page",
    go: async (page) => {
      await page.goto(new URL("/issue/TEST-2", page.url()).href);
      await page.locator("[data-trip=breadcrumb]").click();
    },
    trip: { kind: "breadcrumb", path: "/browse/:key", screen: "/issue/$key/{-$slug}", issue: "TEST-2" },
  },
  {
    name: "a space's Board settings",
    go: async (page) => {
      await page.getByRole("navigation", { name: "Main navigation" }).getByRole("link", { name: "Browser audit" }).click({ button: "right" });
      await page.getByRole("menuitem", { name: "Board settings" }).click();
    },
    trip: { kind: "board-settings", path: "/secure/RapidView.jspa?rapidView", issue: null },
  },
  {
    name: "Open in Jira on a notification for an issue outside the mirror",
    go: async (page) => {
      await inbox(page).click();
      await inboxRow(page, "OUT-9").click();
      await page.getByRole("link", { name: "Open in Jira" }).click();
    },
    trip: { kind: "inbox-open-in-jira", path: "/browse/:key", screen: "/inbox" },
  },
  {
    name: "a notification ⌘-clicked",
    go: async (page) => {
      await inbox(page).click();
      await inboxRow(page, "TEST-1").click({ modifiers: [mod] });
    },
    trip: { kind: "inbox-row", path: "/browse/:key", screen: "/inbox" },
  },
  {
    name: "a notification's View comment, for an issue outside the mirror",
    settings: { inboxRichOutside: true },
    go: async (page) => {
      await inbox(page).click();
      await inboxRow(page, "OUT-9").click();
      await page.getByRole("link", { name: "View comment" }).first().click();
    },
    trip: { kind: "inbox-comment", path: "/browse/:key", screen: "/inbox" },
  },
  {
    name: "the inbox's Go to settings",
    go: async (page) => {
      await inbox(page).click();
      await page.getByRole("button", { name: "Notification actions" }).click();
      await page.getByRole("menuitem", { name: "Go to settings" }).click();
    },
    trip: { kind: "notification-settings", path: "/jira/settings/personal/notifications", screen: "/inbox" },
  },
  {
    name: "a Jira filter linked in a description",
    go: async (page, app) => {
      await (await descriptionLinks(page, app)).getByText("the open filter").click();
    },
    trip: { kind: "description-link", path: "/issues?jql", issue: "TEST-2" },
  },
  {
    name: "a Confluence page on the same site, in a description",
    go: async (page, app) => {
      await (await descriptionLinks(page, app)).locator(`a[href="${PAGE}"]`).click();
    },
    trip: { kind: "description-link:confluence", path: "/wiki/spaces/:space/pages/:id/:value", issue: "TEST-2" },
  },
  {
    name: "an issue link ⌘-clicked in a description",
    go: async (page, app) => {
      await (await descriptionLinks(page, app)).locator(`a[href="${ISSUE}"]`).click({ modifiers: [mod] });
    },
    trip: { kind: "description-link", path: "/browse/:key", issue: "TEST-2" },
  },
  {
    name: "an issue link middle-clicked in a description",
    go: async (page, app) => {
      await (await descriptionLinks(page, app)).locator(`a[href="${ISSUE}"]`).click({ button: "middle" });
    },
    trip: { kind: "description-link", path: "/browse/:key", issue: "TEST-2" },
  },
  {
    name: "a Jira dashboard linked in a comment",
    go: async (page, app) => {
      await app.changeInJira({ key: "TEST-2", comment: { body: `The numbers: ${DASHBOARD}` } });
      await openIssue(page);
      await page.locator("[data-trip=comment-link]").locator(`a[href="${DASHBOARD}"]`).click();
    },
    trip: { kind: "comment-link", path: "/jira/dashboards/:id", issue: "TEST-2" },
  },
  {
    name: "a Jira page added as a link resource",
    settings: { writable: true },
    go: async (page) => {
      await openIssue(page);
      await page.keyboard.press("Control+l");
      const form = page.getByRole("dialog", { name: "Add link" });
      await form.getByRole("textbox", { name: "URL", exact: true }).fill(DASHBOARD);
      await form.getByRole("button", { name: "Add link" }).click();
      await page.getByRole("region", { name: "Resources" }).locator(`a[href="${DASHBOARD}"]`).click();
    },
    trip: { kind: "resource-link", path: "/jira/dashboards/:id", issue: "TEST-2" },
  },
  {
    name: "the activity entry for a Jira page linked to the issue",
    settings: { writable: true },
    go: async (page) => {
      await openIssue(page);
      await page.keyboard.press("Control+l");
      const form = page.getByRole("dialog", { name: "Add link" });
      await form.getByRole("textbox", { name: "URL", exact: true }).fill(DASHBOARD);
      await form.getByRole("button", { name: "Add link" }).click();
      await page.locator(`[data-activity=link] a[href="${DASHBOARD}"]`).click();
    },
    trip: { kind: "activity-link", path: "/jira/dashboards/:id", issue: "TEST-2" },
  },
  {
    name: "a link resource's Open link",
    settings: { writable: true },
    go: async (page) => {
      await addLink(page, DASHBOARD);
      const resources = page.getByRole("region", { name: "Resources" });
      await resources.locator(`a[href="${DASHBOARD}"]`).hover();
      await resources.getByRole("button", { name: `Options for ${DASHBOARD}` }).click();
      await page.getByRole("menuitem", { name: "Open link" }).click();
    },
    trip: { kind: "resource-link", path: "/jira/dashboards/:id", issue: "TEST-2" },
  },
  {
    name: "a card's link badge",
    settings: { writable: true },
    go: async (page) => {
      await addLink(page, DASHBOARD);
      await showLinksOnCards(page);
      await page.getByRole("link", { name: /^Open link .* on TEST-2$/ }).click();
    },
    trip: { kind: "card-link", path: "/jira/dashboards/:id" },
  },
  {
    name: "a card's Open link… menu, for an issue with three links",
    settings: { writable: true },
    go: async (page) => {
      await addLink(page, DASHBOARD);
      await addLink(page, FILTER, false);
      await addLink(page, "https://example.com/handbook", false);
      await showLinksOnCards(page);
      await page.getByRole("button", { name: "Links on TEST-2" }).click();
      await page.getByRole("menuitem").filter({ hasText: /dashboards|10000/i }).first().click();
    },
    trip: { kind: "card-link", path: "/jira/dashboards/:id" },
  },
  {
    name: "Open in new window on a link in an issue's document",
    settings: { writable: true },
    go: async (page) => {
      await openIssue(page);
      await page.getByRole("button", { name: "Issue options" }).click();
      await page.getByRole("menuitem", { name: "Add document…" }).click();
      const body = page.locator("[data-trip=document-link] .ProseMirror").last();
      await body.click();
      await page.keyboard.type("dashboard");
      await page.keyboard.press("Shift+Home");
      await page.keyboard.press(`${mod}+k`);
      await page.keyboard.type(DASHBOARD);
      await page.keyboard.press("Enter");
      await body.getByText("dashboard").click();
      await page.getByRole("button", { name: "Open in new window" }).click();
    },
    trip: { kind: "document-link", path: "/jira/dashboards/:id", issue: "TEST-2" },
  },
  {
    name: "a type change Jira refuses, which says to use Move in Jira",
    settings: { writable: true, refuse: ["summary"], refuseText: `Jira won't change TEST-2 to Bug. ${JIRA_MESSAGES["move-in-jira"].phrase}` },
    go: async (page) => {
      await openIssue(page);
      const title = page.getByRole("textbox", { name: "Issue title" });
      await title.fill("Renamed");
      await title.press("Enter");
      await expect(page.getByText(JIRA_MESSAGES["move-in-jira"].phrase).first()).toBeVisible();
    },
    trip: { kind: "message:move-in-jira", path: "/browse/:key", issue: "TEST-2" },
  },
  {
    name: "Add space fallback, which says to copy the board's address from Jira when listing fails",
    settings: { availableBoardsFailure: true },
    go: async (page) => {
      await page.getByRole("button", { name: "Add space" }).click();
      await expect(page.getByText(JIRA_MESSAGES["board-address"].phrase)).toBeVisible();
    },
    trip: { kind: "message:board-address", path: "/jira/software/projects/:project/boards/:id" },
  },
];

for (const exit of EXITS)
  test(`a trip to Jira is recorded: ${exit.name}`, async ({ page, app }) => {
    await app.seed(exit.settings);
    await expect(page.getByRole("grid", { name: "Todo" }).getByRole("row").first()).toBeVisible();
    const before = Date.now();
    await exit.go(page, app);
    await expect.poll(() => app.trips()).toEqual([expect.objectContaining({ board: 1, ...exit.trip })]);
    const [trip] = await app.trips();
    expect(Date.parse(trip!.time)).toBeGreaterThanOrEqual(before - 1000);
    expect(trip!.screen).toEqual(expect.any(String));
  });

test("going somewhere in the app, or to another site, is no trip to Jira", async ({ page, app }) => {
  await app.seed();
  await app.changeInJira({ key: "TEST-2", comment: { body: "Theirs: https://partner.atlassian.net/browse/PX-3" } });
  const issueChip = await descriptionLinks(page, app);
  // A plain click on an issue of this site opens it here.
  await issueChip.locator(`a[href="${ISSUE}"]`).click();
  await expect(page.getByRole("textbox", { name: "Issue title" })).not.toHaveValue("Browser fixture 2");
  // A row middle-clicked opens the issue's page in this app, in a new tab.
  await page.keyboard.press("Escape");
  const tab = page.context().waitForEvent("page");
  await page.getByRole("grid", { name: "Todo" }).getByRole("row", { name: "TEST-2 Browser fixture 2", exact: true }).click({ button: "middle" });
  await (await tab).close();
  // A link to another Atlassian site is someone else's Jira.
  await openIssue(page);
  await page.locator(`a[href="https://partner.atlassian.net/browse/PX-3"]`).click();

  // Then one trip, so the log is read after everything above had its chance to record one.
  await page.locator("[data-trip=issue-key]").click();
  await expect.poll(() => app.trips()).toEqual([expect.objectContaining({ kind: "issue-key" })]);
});

test("a trip made offline is kept, and sent once with its own time when the browser is back online", async ({ page, app }) => {
  await app.seed();
  await openIssue(page);
  await page.context().setOffline(true);
  await page.locator("[data-trip=issue-key]").click();
  const kept = () => page.evaluate(() => JSON.parse(localStorage.getItem("better-jira:trips") ?? "[]") as { time: string }[]);
  await expect.poll(async () => (await kept()).length).toBe(1);
  const { time } = (await kept())[0]!;
  expect(await app.trips()).toEqual([]);

  await page.context().setOffline(false);
  await expect.poll(() => app.trips()).toEqual([expect.objectContaining({ kind: "issue-key", path: "/browse/:key", issue: "TEST-2", time })]);
  await expect.poll(async () => (await kept()).length).toBe(0);
  expect(await app.trips()).toHaveLength(1);
});
