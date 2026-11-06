import { afterAll, expect, test } from "bun:test";
import { open, PREFS_KEY, stop } from "./harness";

afterAll(stop);
const root = `document.querySelector('[aria-label="Add Filter…"]')`;

test("B8: choosing a filter category replaces the root list instead of opening beside it", async () => {
  const page = await open();
  try {
    await page.waitFor(`document.querySelectorAll("[data-key]").length===6`);
    await page.key("f");
    await page.waitFor(`document.activeElement===${root}`);
    await page.type("label"); await page.key("Enter");
    await page.waitFor(`document.activeElement?.getAttribute("aria-label")==="Filter Labels"`);
    expect(await page.eval(`!!${root}`)).toBe(false);
    await page.click("text=‹Labels");
    await page.waitFor(`document.activeElement===${root}`);
  } finally { await page.close(); }
});

test("R5: Esc in a filter submenu closes the menu and returns focus to the filter button", async () => {
  const page = await open();
  try {
    await page.waitFor(`document.querySelectorAll("[data-key]").length===6`);
    await page.key("f");
    await page.waitFor(`document.activeElement===${root}`);
    await page.type("label"); await page.key("Enter");
    await page.waitFor(`document.activeElement?.getAttribute("aria-label")==="Filter Labels"`);
    await page.key("Escape");
    await page.waitFor(`!document.querySelector('[aria-label="Filter Labels"]')`);
    expect(await page.eval(`!!${root}`)).toBe(false);
    expect(await page.active()).toBe("Add filter");
    await page.key("j");
    await page.waitFor(`!!document.querySelector("[data-selected]")`);
  } finally { await page.close(); }
});

test("B7: clicking a filter chip opens a small operator/value picker under the chip", async () => {
  const prefs = { 1: { filters: { id: "root", join: "and", children: [{ id: "r1", field: "labels", op: "is", values: ["ui"] }] } } };
  const setup = `if(!sessionStorage.seeded){sessionStorage.seeded=1;localStorage.setItem(${JSON.stringify(PREFS_KEY)},${JSON.stringify(JSON.stringify(prefs))});}`;
  const page = await open("", { setup });
  try {
    await page.waitFor(`document.querySelectorAll("[data-key]").length===1`);
    const chip = await page.rect('[aria-label="Remove labels filter"]');
    await page.click("text=Labels is ui");
    await page.waitFor(`!!document.querySelector('[role=dialog][aria-label="Edit Labels filter"]')`);
    expect(await page.eval(`!!document.querySelector('[aria-label="Advanced filter"]')`)).toBe(false);
    const menu = await page.rect('[role=dialog][aria-label="Edit Labels filter"]');
    expect(menu.top).toBeGreaterThanOrEqual(chip.bottom);
    expect(menu.top - chip.bottom).toBeLessThan(40);
    await page.click('[role=group][aria-label="Labels operator"] button:nth-child(2)');
    await page.waitFor(`document.querySelectorAll("[data-key]").length===5`);
    expect(await page.eval(`[...document.querySelectorAll("button")].some(b=>b.textContent==="Labels is not ui")`)).toBe(true);
  } finally { await page.close(); }
});
