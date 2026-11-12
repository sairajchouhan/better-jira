import { expect, test } from "./app";

test("BJ-39: bottom of column creates with that column's status", async ({ open }) => {
  const page = await open();
  await page.click('[aria-label="Add issue to In Progress"]');
  await page.waitFor(`!!document.querySelector('[aria-label="Issue title"]')`);
  expect(await page.eval(`!!document.querySelector('[aria-label="Status: In Progress"]')`)).toBe(true);
});

test("BJ-49: inline sub-issue composer offers a due date", async ({ open }) => {
  const page = await open("?issue=TEST-2&panel=true");
  await page.click('[aria-label="Create new sub-issue"]');
  await page.click('[aria-label="Sub-issue due date. No due date"]');
  await page.click('text=Tomorrow');
  expect(await page.eval(`document.querySelector('[aria-label^="Sub-issue due date."]').textContent`)).toMatch(/\d{4}-\d{2}-\d{2}/);
});
