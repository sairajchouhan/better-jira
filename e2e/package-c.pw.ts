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

test("BJ-51: nested progress opens the child's own children", async ({ open }) => {
  const setup = `const read=fetch;window.fetch=async(...args)=>{const r=await read(...args);if(new URL(String(args[0]),location.href).pathname!=="/api/issues")return r;const issues=await r.json();issues.find(i=>i.key==="TEST-3").parent="TEST-2";issues.find(i=>i.key==="TEST-4").parent="TEST-3";return Response.json(issues)}`;
  const page = await open("?issue=TEST-2&view=page", { setup });
  await page.click('[data-sub-issue="TEST-3"] [data-row-progress]');
  await page.waitFor(`!!document.querySelector('[role=dialog][aria-label="Open sub-issues of TEST-3"]')`);
  expect(await page.eval(`document.querySelector('[role=dialog][aria-label="Open sub-issues of TEST-3"]').textContent`)).toContain("TEST-4");
  expect(await page.eval(`new URL(location.href).searchParams.get("issue")`)).toBe("TEST-2");
});
