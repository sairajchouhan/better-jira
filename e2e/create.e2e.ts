import { afterAll, expect, test } from "bun:test";
import { open, stop } from "./harness";

afterAll(stop);
const title = `document.querySelector('[aria-label="Issue title"]')`;

test("B4: Enter in the title moves to the description", async () => {
  const page = await open();
  try {
    await page.key("c");
    await page.waitFor(`document.activeElement===${title}`);
    await page.type("Title");
    await page.key("Enter");
    expect(await page.eval(`document.activeElement?.id`)).toBe("create-description");
    expect(await page.eval(`!!${title}`)).toBe(true);
  } finally { await page.close(); }
});

test("B3: closing the composer keeps the unsent title and description for the next C", async () => {
  const page = await open();
  try {
    await page.key("c");
    await page.waitFor(`document.activeElement===${title}`);
    await page.type("Draft title");
    await page.click("#create-description");
    await page.type("Draft body");
    await page.key("Escape");
    await page.waitFor(`!${title}`);
    await page.key("c");
    expect(await page.waitFor<string>(`${title}?.value`)).toBe("Draft title");
    expect(await page.eval(`document.getElementById("create-description").textContent`)).toBe("Draft body");
  } finally { await page.close(); }
});

test("B5: creating an issue stays on the board and shows a toast that opens it", async () => {
  const page = await open();
  try {
    await page.key("c");
    await page.waitFor(`document.activeElement===${title}`);
    await page.type("Fresh issue");
    await page.key("Enter", "meta");
    await page.waitFor(`!${title}`);
    expect(await page.waitFor<string>(`document.querySelector("[data-toast]")?.textContent`)).toMatch(/^Created TEST-NEW\d+View issue$/);
    expect(await page.eval(`!!document.getElementById("summary")`)).toBe(false);
    await page.click("text=View issue");
    expect(await page.waitFor<string>(`document.getElementById("summary")?.value??document.getElementById("summary")?.textContent`)).toBe("Fresh issue");
  } finally { await page.close(); }
});

test("B13: composer properties are pill menus, not native selects; Enter picks without submitting", async () => {
  const page = await open();
  try {
    await page.key("c");
    await page.waitFor(`document.activeElement===${title}`);
    await page.type("Pill test");
    expect(await page.eval(`document.querySelectorAll('[role=dialog][aria-label="Create issue"] select').length`)).toBe(0);
    const pill = await page.rect('[aria-label="Priority: Normal"]');
    await page.click('[aria-label="Priority: Normal"]');
    await page.waitFor(`document.activeElement?.getAttribute("aria-label")==="Priority…"`);
    const menu = await page.rect('[role=dialog][aria-label="Priority"]');
    expect(menu.top).toBeGreaterThanOrEqual(pill.bottom);
    expect(Math.abs(menu.left - pill.left)).toBeLessThan(2);
    await page.type("high"); await page.key("Enter");
    await page.waitFor(`!!document.querySelector('[aria-label="Priority: High"]')`);
    expect(await page.eval(`${title}?.value`)).toBe("Pill test");
    await page.click('[aria-label="Status: Backlog"]');
    await page.waitFor(`!!document.querySelector('[role=dialog][aria-label="Status"]')`);
    await page.key("Escape");
    await page.waitFor(`!document.querySelector('[role=dialog][aria-label="Status"]')`);
    expect(await page.eval(`!!${title}`)).toBe(true);
  } finally { await page.close(); }
});

test("B13: the Display menu uses pill menus instead of native selects", async () => {
  const page = await open();
  try {
    await page.click('[aria-label="Display options"]');
    await page.waitFor(`!!document.querySelector('[aria-label^="Ordering: "]')`);
    expect(await page.eval(`document.querySelectorAll(".view-popup select").length`)).toBe(0);
    await page.click('[aria-label="Ordering: Manual"]');
    await page.waitFor(`document.activeElement?.getAttribute("aria-label")==="Ordering…"`);
    await page.type("title"); await page.key("Enter");
    await page.waitFor(`!!document.querySelector('[aria-label="Ordering: Title"]')`);
    expect(await page.eval(`!!document.querySelector('[aria-label="Display options"][aria-expanded=true]')`)).toBe(true);
  } finally { await page.close(); }
});
