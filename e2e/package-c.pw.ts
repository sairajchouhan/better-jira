import { expect, test } from "./app";

test("BJ-39: bottom of column creates with that column's status", async ({ open }) => {
  const page = await open();
  await page.click('[aria-label="Add issue to In Progress"]');
  await page.waitFor(`!!document.querySelector('[aria-label="Issue title"]')`);
  expect(await page.eval(`!!document.querySelector('[aria-label="Status: In Progress"]')`)).toBe(true);
});
