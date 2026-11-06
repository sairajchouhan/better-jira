import { afterAll, expect, test } from "bun:test";
import { open, stop } from "./harness";

afterAll(stop);

for (const parent of ["Browser audit", "Issues"]) {
  test(`issue breadcrumb ${parent} returns to All issues on the current board`, async () => {
    const page = await open();
    try {
      await page.click("text=Active");
      await page.click('[data-key="TEST-1"]');
      await page.waitFor(`!!document.getElementById('summary')`);
      await page.click('[title="Open as full page"]');
      const breadcrumb = `document.querySelector('[aria-label="Breadcrumb"]')`;
      expect(await page.eval(`${breadcrumb}?.textContent`)).toMatch(/Browser audit.*Issues.*TEST-1/);
      await page.click(`[aria-label="Breadcrumb"] [aria-label="${parent}"]`);
      await page.waitFor(`!document.getElementById('summary')`);
      expect(await page.eval(`new URLSearchParams(location.search).get('board')`)).toBe("1");
      expect(await page.eval(`new URLSearchParams(location.search).has('issue')`)).toBe(false);
      expect(await page.eval(`[...document.querySelectorAll('button[aria-pressed=true]')].some(b=>b.textContent==='All issues')`)).toBe(true);
      await page.eval("history.back()");
      await page.waitFor(`!!document.getElementById('summary')`);
      expect(await page.eval(`new URLSearchParams(location.search).get('issue')`)).toBe("TEST-1");
    } finally { await page.close(); }
  });
}

test("board breadcrumb opens All issues with the keyboard", async () => {
  const page = await open();
  try {
    await page.click("text=Backlog");
    await page.eval(`document.querySelector('[aria-label="Breadcrumb"] [aria-label="Issues"]')?.focus()`);
    await page.key("Enter");
    expect(await page.eval(`[...document.querySelectorAll('button[aria-pressed=true]')].some(b=>b.textContent==='All issues')`)).toBe(true);
  } finally { await page.close(); }
});

test("breadcrumb exits the side panel, My issues and text search", async () => {
  const page = await open();
  try {
    await page.click('[data-key="TEST-1"]');
    await page.waitFor(`!!document.getElementById('summary')`);
    await page.click('nav[aria-label="Main navigation"] button:nth-of-type(3)');
    await page.key("f", "meta");
    await page.waitFor(`document.activeElement?.id==='find-in-view'`);
    await page.type("no matching issue");
    await page.click('[aria-label="Breadcrumb"] [aria-label="Issues"]');
    await page.waitFor(`!document.getElementById('summary')`);
    expect(await page.eval(`!!document.getElementById('find-in-view')`)).toBe(false);
    expect(await page.eval(`document.querySelectorAll('[data-key]').length`)).toBe(6);
  } finally { await page.close(); }
});
