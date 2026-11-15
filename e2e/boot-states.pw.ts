import { expect, fixture, test } from "./app";

/** The boot screen or the app: never an empty page (BJ-277). */
const somethingShown = `!!document.querySelector("[data-key], [role=alert] h1, [role=status] h1, #loading")`;

test("BJ-277: a load error shows in the boot screen and stays through every retry until the app loads", async ({ open }) => {
  await fixture.reset({ clientFailures: 3 });
  const page = await open();
  await page.waitFor(`document.querySelector("[role=alert] h1")?.textContent === "Couldn't load your Jira data"`);
  expect(await page.eval(`document.querySelector("[role=alert]").textContent`)).toContain("Test unavailable");
  // Each retry, automatic or clicked, keeps the screen; it never empties while the load runs.
  const blank: boolean[] = [];
  const watch = setInterval(() => void page.eval(somethingShown).then((v) => blank.push(!v), () => {}), 10);
  await page.page.getByRole("button", { name: "Try again" }).click();
  await page.waitFor(`!!document.querySelector("[data-key]")`, 30_000);
  clearInterval(watch);
  expect(blank.filter(Boolean)).toEqual([]);
});

test("a first sync still reading the boards shows its progress as a wait, then opens the app by itself", async ({ open }) => {
  await fixture.reset({ syncingReads: 3 });
  const page = await open();
  await page.waitFor(`document.querySelector("[data-boot-screen][role=status] h1")?.textContent === "Syncing your Jira boards"`);
  expect(await page.eval(`document.querySelector("[data-boot-screen]").textContent`)).toContain("300 of 900 issues");
  expect(await page.eval(`!!document.querySelector("[role=alert]")`)).toBe(false);
  await page.waitFor(`!!document.querySelector("[data-key]")`, 15_000);
});

test("the footer warns when the mirror can't read Jira", async ({ open }) => {
  const reason = "Jira rejected your email and API token (401).";
  await fixture.reset({ syncErrors: [reason] });
  const page = await open();
  await page.waitFor(`document.querySelector("[aria-label='Jira sync status']")?.textContent?.includes(${JSON.stringify(reason)})`, 15_000);
});

test("BJ-338: a board shown on its first page says in the footer that the rest is still syncing, then goes quiet", async ({ open }) => {
  await fixture.reset({ streaming: 1 });
  const page = await open();
  await page.waitFor(`document.querySelector("[aria-label='First sync']")?.textContent?.startsWith("Still syncing Board ") === true`, 15_000);
  expect(await page.eval(`document.querySelector("[aria-label='First sync']").textContent`)).toContain("100 of 900 issues");
  // The next poll finds every page read.
  await page.eval(`window.dispatchEvent(new Event("focus"))`);
  await page.waitFor(`!document.querySelector("[aria-label='First sync']")`, 45_000);
});
