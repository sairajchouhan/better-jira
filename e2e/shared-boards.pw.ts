import { expect, fixture, test, shownIssue } from "./app";

// Blocker 5: an issue two boards hold shows on both, an issue one board holds only on that one, and an issue opened
// from the second board stays in that board's context. The fixture's `sharedBoards` puts TEST-2 and TEST-3 on boards
// 1 and 2, and SQUAD-1 on board 2 only.
const keys = `[...document.querySelectorAll("[data-key]")].map(e=>e.dataset.key).sort()`;
const breadcrumb = `document.querySelector('[aria-label="Breadcrumb"]')?.textContent`;

test("shared boards: an issue on two boards shows on both and opens in the board it was opened from", async ({ open }) => {
  await fixture.reset({ sharedBoards: true });
  const page = await open("/board/1/all");
  await test.step("board 1 lists its six issues and not board 2's own", async () => {
    expect(await page.waitFor<string[]>(`(${keys}).length===6&&${keys}`)).toEqual([
      "TEST-1",
      "TEST-2",
      "TEST-3",
      "TEST-4",
      "TEST-5",
      "TEST-6",
    ]);
  });
  await test.step("board 2 lists the two shared issues and its own", async () => {
    await page.goto("/board/2/all");
    expect(await page.waitFor<string[]>(`(${keys}).length===3&&${keys}`)).toEqual(["SQUAD-1", "TEST-2", "TEST-3"]);
  });
  await test.step("a shared issue opened from board 2 stays in board 2", async () => {
    await page.click('[data-key="TEST-2"]');
    await page.waitFor(`!!document.getElementById('summary')&&${shownIssue}==='TEST-2'`);
    expect(await page.eval(`location.pathname`)).toMatch(/^\/board\/2\//);
    await page.click('[title="Open as full page"]');
    expect(await page.waitFor<string>(`/TEST-2/.test(${breadcrumb}??'')&&${breadcrumb}`)).toMatch(/Squad board›TEST-2/);
  });
  await test.step("the same issue opened from board 1 stays in board 1", async () => {
    await page.goto("/board/1/all");
    await page.waitFor(`document.querySelectorAll("[data-key]").length===6`);
    await page.click('[data-key="TEST-2"]');
    await page.waitFor(`!!document.getElementById('summary')&&${shownIssue}==='TEST-2'`);
    expect(await page.eval(`location.pathname`)).toMatch(/^\/board\/1\//);
    await page.click('[title="Open as full page"]');
    expect(await page.waitFor<string>(`/TEST-2/.test(${breadcrumb}??'')&&${breadcrumb}`)).toMatch(/Browser audit›TEST-2/);
  });
});
