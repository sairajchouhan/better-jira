import { afterAll, expect, test } from "bun:test";
import { open, stop, type Page } from "./harness";

afterAll(stop);
async function openIssue(page: Page, key = "TEST-1") {
  await page.click(`[data-key="${key}"]`);
  await page.waitFor(`!!document.getElementById("summary")&&!document.querySelector('[role=status]')?.textContent?.startsWith("Loading")`);
}

test("I12: the priority picker lists priorities ranked Urgent to Low, each with its icon", async () => {
  const page = await open();
  try {
    await page.key("j");
    await page.key("p");
    await page.waitFor(`document.querySelectorAll("[cmdk-item]").length>1`);
    expect(await page.eval(`[...document.querySelectorAll("[cmdk-item]")].map(i=>i.textContent)`)).toEqual(["No priority", "Urgent", "High", "Normal", "Low"]);
    expect(await page.eval(`[...document.querySelectorAll("[cmdk-item]")].every(i=>i.querySelector("svg"))`)).toBe(true);
  } finally { await page.close(); }
});

test("I14: Enter in the emoji search picks the match", async () => {
  const page = await open();
  try {
    await openIssue(page);
    await page.click('[aria-label="Add reaction"]');
    await page.waitFor(`document.activeElement?.getAttribute("aria-label")==="Search emoji"`);
    await page.type("thumbs up");
    await page.key("Enter");
    await page.waitFor(`!!document.querySelector('[aria-label="Remove 👍 reaction"]')`);
  } finally { await page.close(); }
});

test("I15: a link to an unknown issue says it was not found", async () => {
  const page = await open("?issue=NOPE-1");
  try {
    expect(await page.waitFor<string>(`document.querySelector("[data-toast]")?.textContent`)).toBe("Issue NOPE-1 not found");
  } finally { await page.close(); }
});

test("I16: a favourited issue's star turns yellow", async () => {
  const page = await open();
  try {
    await openIssue(page);
    await page.click('[aria-label="Add issue to favorites"]');
    expect(await page.waitFor<string>(`getComputedStyle(document.querySelector('[aria-label="Remove issue from favorites"]')).color`)).toBe("rgb(242, 201, 76)");
  } finally { await page.close(); }
});

test("I18: issue navigation shows its position and next before previous", async () => {
  const page = await open();
  try {
    await openIssue(page, "TEST-1");
    const summary = `(document.getElementById("summary").value??document.getElementById("summary").textContent)`;
    expect(await page.eval(summary)).toBe("Rich browser fixture");
    expect(await page.eval(`document.querySelector('[aria-label="Issue position"]').textContent`)).toBe('1 / 6');
    expect(await page.eval(`[...document.querySelector('[aria-label="Issue position"]').parentElement.querySelectorAll('button')].map(b=>b.title)`)).toEqual(['Next (J / ↓)','Previous (K / ↑)']);
    await page.click('[title="Next (J / ↓)"]');
    expect(await page.waitFor<string>(`${summary}!=="Rich browser fixture"&&${summary}`)).toMatch(/^Browser fixture \d$/);
  } finally { await page.close(); }
});

test("I17/R7: properties are unlabelled 13px/500 rows under section headings, with Linear's page title size", async () => {
  const page = await open();
  try {
    await openIssue(page);
    const props = `document.querySelector("[data-properties]")`;
    expect(await page.eval(`getComputedStyle(${props}.parentElement).borderTopWidth`)).toBe("0px");
    await page.click('[title="Open as full page"]');
    await page.waitFor(`getComputedStyle(document.getElementById("summary")).fontSize==="24px"`);
    expect(await page.eval(`getComputedStyle(document.getElementById("summary")).fontWeight`)).toBe("600");
    expect(await page.eval(`[...${props}.querySelectorAll("h3")].map(h=>h.textContent)`)).toEqual(["Properties", "Labels", "Project"]);
    expect(await page.eval(`${props}.querySelectorAll("dt").length`)).toBe(0);
    expect(await page.eval(`/Reporter|Created|Updated/.test(${props}.textContent)`)).toBe(false);
    const style = `getComputedStyle(document.getElementById("prop-status"))`;
    expect(await page.eval(`[${style}.fontSize,${style}.fontWeight]`)).toEqual(["13px", "500"]);
  } finally { await page.close(); }
});
