import { expect, test } from "./app";
import {
  changeStatus,
  coldOpen,
  openIssue,
  readDataset,
  search,
  speedTimer,
  stepIssues,
  switchBoards,
  type Dataset,
} from "./speed";

/** Speed budget: each core action, timed in the page (e2e/speed.ts) on two boards of about 1,600 issues each (3,206 in all, the
 *  size of the owner's work copy), fails when the fastest of RUNS runs passes its ceiling. Load on the machine moves the fastest
 *  run least, and a real slowdown moves it first. Each ceiling is about 1.5 times the slowest fastest-run seen in 20 repeats at
 *  --workers 3 with a load average of 20 to 39 (cold open 354 ms, open 50, J/K 36, switch 46, search 25, status 53). */
const RUNS = 7;
const SEED = { bulk: 1600, bulkVariety: 40, writable: true };
const BUDGET = {
  coldOpen: 480,
  openIssue: 75,
  step: 55,
  switchBoard: 70,
  search: 40,
  status: 80,
};

test.describe.configure({ timeout: 120_000 });

const fastest = (samples: number[]) => Math.min(...samples);
const within = (samples: number[], budget: number) => {
  const shown = samples.map(Math.round).join(", ");
  test.info().annotations.push({ type: "speed", description: `fastest ${Math.round(fastest(samples))} ms of ${shown}` });
  expect(fastest(samples), `fastest of ${shown} ms`).toBeLessThanOrEqual(budget);
};

let data: Dataset;
test.beforeEach(async ({ page, app, fixtureUrl }) => {
  await page.addInitScript(speedTimer);
  await app.seed(SEED);
  data = await readDataset(fixtureUrl);
  await expect(page.getByRole("grid").getByRole("row").first()).toBeVisible();
});

test("speed: a cold open shows a usable board", async ({ browser, fixtureUrl }) => {
  within((await coldOpen(browser, fixtureUrl, 1, RUNS, { reopens: false })).cold, BUDGET.coldOpen);
});

test("speed: a card opens its issue", async ({ page }) => {
  within(await openIssue(page, data, RUNS), BUDGET.openIssue);
});

test("speed: J and K move to the next and previous issue", async ({ page }) => {
  within(await stepIssues(page, data, RUNS), BUDGET.step);
});

test("speed: the sidebar switches to the other board", async ({ page }) => {
  within(await switchBoards(page, data, RUNS, 1, 2), BUDGET.switchBoard);
});

test("speed: search lists the issue on the last keystroke", async ({ page }) => {
  within(await search(page, data, RUNS), BUDGET.search);
});

test("speed: a status change shows on the board", async ({ page, app }) => {
  within((await changeStatus(page, "TEST-2", RUNS)).shown, BUDGET.status);
  expect((await app.jiraIssue("TEST-2")).issue.status).toBe("todo");
});
