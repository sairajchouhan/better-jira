import { afterAll, expect, test } from "bun:test";
import { open, PREFS_KEY, stop } from "./harness";

afterAll(stop);
const hiddenNames = `[...document.querySelectorAll('aside[aria-label="Hidden columns"] [aria-label^="Show "]')].map(b=>b.getAttribute("aria-label").slice(5))`;

test("B15: hidden columns list only columns the tab can hold", async () => {
  const page = await open();
  try {
    await page.waitFor(`!!document.querySelector('aside[aria-label="Hidden columns"]')`);
    expect(await page.waitFor<string[]>(`(${hiddenNames}).length&&${hiddenNames}`)).toEqual(["Backlog", "Review", "Done"]);
    await page.click("text=Active");
    await page.waitFor(`document.querySelector('[aria-pressed="true"]')?.textContent==="Active"`);
    expect(await page.waitFor<string[]>(`(${hiddenNames}).length&&${hiddenNames}`)).toEqual(["Review"]);
    expect(await page.eval(`[...document.querySelectorAll("section h2 .truncate")].map(s=>s.textContent)`)).toEqual(["Todo", "Doing"]);
  } finally { await page.close(); }
});

test("B6: the hidden columns list has an edge against the clipped board", async () => {
  const page = await open();
  try {
    const aside = `getComputedStyle(document.querySelector('aside[aria-label="Hidden columns"]'))`;
    expect(await page.waitFor<string>(`${aside}.borderLeftWidth`)).toBe("1px");
    expect(await page.eval(`${aside}.borderLeftStyle`)).toBe("solid");
  } finally { await page.close(); }
});

test("B14: column titles are medium weight in the secondary text colour, not white", async () => {
  const page = await open();
  try {
    const title = `getComputedStyle(document.querySelector("section h2 .truncate"))`;
    expect(await page.waitFor<string>(`${title}.fontWeight`)).toBe("500");
    expect(await page.eval(`${title}.color`)).toBe("lch(90.451 1.2 272)"); // dark --fg-2
  } finally { await page.close(); }
});

test("R8: at 390px the bottom bar stays on one line", async () => {
  const page = await open("", { width: 390, height: 844 });
  try {
    await page.waitFor(`document.querySelector('[aria-label="Local save status"]')?.textContent==="Saved locally"||document.querySelector('[aria-label="Local save status"]')?.textContent==="Not saved"`, 10000);
    expect(await page.eval(`[...document.querySelectorAll("footer .truncate, footer [role=status]")].map(s=>s.getBoundingClientRect().height<=18)`)).toEqual([true, true, true]);
  } finally { await page.close(); }
});

test("B11: a board is favourited once, whichever tab is open, and old per-tab entries merge", async () => {
  const setup = `if(!sessionStorage.seeded){sessionStorage.seeded=1;localStorage.setItem("better-jira:favorites:v1:https://example.atlassian.net/audit-me",JSON.stringify(["board:1:active","board:1:backlog"]));}`;
  const page = await open("", { setup });
  try {
    const entries = `[...document.querySelectorAll("nav button, aside button")].filter(b=>b.textContent.includes("☆")).map(b=>b.textContent)`;
    expect(await page.waitFor<string[]>(`(${entries}).length&&${entries}`)).toEqual(["☆Browser audit"]);
    expect(await page.eval(`document.querySelector('[role=switch][aria-label$="favorites"]:not([aria-label*=issue])').getAttribute("aria-checked")`)).toBe("true");
    await page.click("text=Active");
    expect(await page.eval(`document.querySelector('[role=switch][aria-label$="favorites"]:not([aria-label*=issue])').getAttribute("aria-checked")`)).toBe("true");
    await page.click('[aria-label="Remove from favorites"]');
    await page.click("text=Backlog");
    expect(await page.eval(`document.querySelector('[aria-label="Add to favorites"]')?.getAttribute("aria-checked")`)).toBe("false");
    expect(await page.eval(entries)).toEqual([]);
  } finally { await page.close(); }
});

const columnKeys = (name: string) => `[...document.querySelectorAll("section")].find(s=>s.querySelector("h2 .truncate")?.textContent===${JSON.stringify(name)})?.querySelectorAll("[data-key]")`;
const keysIn = (name: string) => `[...(${columnKeys(name)}??[])].map(c=>c.dataset.key)`;

test("B2: dropping a card places it where it was dropped, within and across columns", async () => {
  const page = await open();
  try {
    expect(await page.waitFor<string[]>(`(${keysIn("Todo")}).length===5&&${keysIn("Todo")}`)).toEqual(["TEST-1", "TEST-2", "TEST-4", "TEST-5", "TEST-6"]);
    const top = await page.rect('[data-key="TEST-1"]');
    await page.drag('[data-key="TEST-6"]', top.x + top.width / 2, top.y + 4);
    expect(await page.waitFor<string[]>(`${keysIn("Todo")}[0]==="TEST-6"&&${keysIn("Todo")}`)).toEqual(["TEST-6", "TEST-1", "TEST-2", "TEST-4", "TEST-5"]);
    const target = await page.rect('[data-key="TEST-3"]');
    await page.drag('[data-key="TEST-2"]', target.x + target.width / 2, target.y + 4);
    expect(await page.waitFor<string[]>(`(${keysIn("Doing")}).length===2&&${keysIn("Doing")}`)).toEqual(["TEST-2", "TEST-3"]);
    await page.reload();
    expect(await page.waitFor<string[]>(`(${keysIn("Doing")}).length===2&&${keysIn("Doing")}`)).toEqual(["TEST-2", "TEST-3"]);
    expect(await page.eval(keysIn("Todo"))).toEqual(["TEST-6", "TEST-1", "TEST-4", "TEST-5"]);
  } finally { await page.close(); }
});

test("B12: swimlanes share one sticky column header row", async () => {
  const setup = `if(!sessionStorage.seeded){sessionStorage.seeded=1;localStorage.setItem(${JSON.stringify(PREFS_KEY)},JSON.stringify({1:{display:{rows:"assignee"}}}));}`;
  const page = await open("", { setup, height: 500 });
  try {
    await page.waitFor(`document.querySelectorAll("[data-key]").length===6`);
    expect(await page.eval(`[...document.querySelectorAll("h2 .truncate")].map(s=>s.textContent)`)).toEqual(["Todo", "Doing"]);
    const header = `document.querySelector("h2").getBoundingClientRect().top`;
    const before = await page.eval<number>(header);
    await page.eval(`document.querySelector("h2").closest(".overflow-auto").scrollTop=200`);
    expect(await page.eval<number>(header)).toBe(before);
  } finally { await page.close(); }
});

test("B10: My issues is a sidebar view, not a tab beside Active/Backlog/All", async () => {
  const page = await open();
  try {
    await page.waitFor(`document.querySelectorAll("[data-key]").length===6`);
    expect(await page.eval(`[...document.querySelectorAll("header button")].some(b=>b.textContent==="My issues")`)).toBe(false);
    const item = `[...document.querySelectorAll("nav button")].find(b=>b.textContent.includes("My issues"))`;
    await page.eval(`${item}.click()`);
    await page.waitFor(`document.querySelectorAll("[data-key]").length===0`);
    expect(await page.eval(`${item}.getAttribute("aria-current")`)).toBe("true");
    await page.eval(`${item}.click()`);
    await page.waitFor(`document.querySelectorAll("[data-key]").length===6`);
  } finally { await page.close(); }
});
