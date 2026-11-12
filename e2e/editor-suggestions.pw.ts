import { expect, test } from "./app";

const rows = `[...document.querySelectorAll('[aria-label="Mention people"] [role=option]')]`;
const selected = `${rows}.findIndex(n=>n.ariaSelected==='true')`;

test("BJ-180: ⌥↑/⌥↓ jump between the @ menu's groups; → peeks the issue, ← closes it", async ({ open }) => {
  const page = await open("?issue=TEST-2&view=page");
  await page.waitFor(`!!document.querySelector('#description p')`);
  await page.click("#description p");
  await page.key("End");
  await page.type(" @r");
  await page.waitFor(`${rows}.some(n=>n.textContent.includes('Priya')) && ${rows}.some(n=>/TEST-\\d/.test(n.textContent))`);
  const firstIssue = await page.eval<number>(`${rows}.findIndex(n=>/TEST-\\d/.test(n.textContent))`);
  expect(firstIssue).toBeGreaterThan(0);
  await page.key("ArrowDown", "alt");
  expect(await page.eval(selected)).toBe(firstIssue);
  await page.key("ArrowRight");
  const key = await page.eval<string>(`${rows}[${firstIssue}].textContent.match(/TEST-\\d+/)[0]`);
  await page.waitFor(`document.querySelector('[aria-label="Quick look"]')?.textContent.includes(${JSON.stringify(key)})`);
  // The editor keeps focus while the peek is open.
  expect(await page.eval(`document.querySelector('#description').contains(document.activeElement)`)).toBe(true);
  await page.key("ArrowLeft");
  await page.waitFor(`!document.querySelector('[aria-label="Quick look"]')`);
  await page.key("ArrowUp", "alt");
  expect(await page.eval(selected)).toBe(0);
});
