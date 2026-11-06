import { afterAll, expect, test } from "bun:test";
import { open, stop } from "./harness";

afterAll(stop);

const dialog = (label: string) => `[role=dialog][aria-label="${label}"]`;
const inViewport = (label: string) => `(()=>{const r=document.querySelector('${dialog(label)}')?.getBoundingClientRect();return !!r&&r.top>=0&&r.bottom<=innerHeight&&r.left>=0&&r.right<=innerWidth})()`;

test("R1: S on a keyboard-selected card opens the status picker on screen, beside the card", async () => {
  const page = await open();
  try {
    await page.keys("jj"); await page.key("s");
    await page.waitFor(`!!document.querySelector('${dialog("Change status")}')`);
    await Bun.sleep(100);
    expect(await page.eval(inViewport("Change status"))).toBe(true);
    const [card, menu] = await page.eval<DOMRect[]>(`[document.querySelector("[data-selected]"),document.querySelector('${dialog("Change status")}')].map(n=>n.getBoundingClientRect().toJSON())`);
    expect(Math.abs(menu!.left - card!.left)).toBeLessThan(40);
    expect(Math.min(Math.abs(menu!.top - card!.bottom), Math.abs(menu!.bottom - card!.top))).toBeLessThan(20);
    expect(await page.active()).toBe("Change status…");
  } finally { await page.close(); }
});

test("R2: C focuses the issue title, so typing goes into it", async () => {
  const page = await open();
  try {
    await page.key("c");
    await page.waitFor(`document.activeElement?.getAttribute("aria-label")==="Issue title"`);
    await page.type("Typed straight away");
    expect(await page.eval(`document.querySelector('[aria-label="Issue title"]').value`)).toBe("Typed straight away");
  } finally { await page.close(); }
});

test("I13: the due-date picker focuses the date text field, not the first preset button", async () => {
  const page = await open();
  try {
    await page.key("j"); await page.key("Enter");
    await page.click("#prop-due");
    await page.waitFor(`document.activeElement?.getAttribute("aria-label")==="Due date"`, 3000);
    await Bun.sleep(300);
    expect(await page.active()).toBe("Due date");
  } finally { await page.close(); }
});

test("R3: ⌘K toggles the command menu closed while it is open", async () => {
  const page = await open();
  try {
    await page.key("k", "meta");
    await page.waitFor(`!!document.querySelector('${dialog("Search issues and commands")}')`);
    await page.key("k", "meta");
    await page.waitFor(`!document.querySelector('${dialog("Search issues and commands")}')`, 2000);
  } finally { await page.close(); }
});

test("B9: P and L open their pickers without opening the issue panel", async () => {
  const page = await open();
  try {
    await page.key("j");
    for (const [key, label] of [["p", "Set priority"], ["l", "Change labels"]] as const) {
      await page.key(key);
      await page.waitFor(`!!document.querySelector('${dialog(label)}')`);
      expect(await page.eval(`!!document.getElementById("summary")`)).toBe(false);
      expect(await page.eval(inViewport(label))).toBe(true);
      await page.key("Escape");
      await page.waitFor(`!document.querySelector('${dialog(label)}')`);
    }
  } finally { await page.close(); }
});

test("R6: the keyboard-selected card is drawn differently from a hovered card", async () => {
  const page = await open();
  try {
    await page.key("j");
    const selected = await page.waitFor<string>(`document.querySelector("[data-selected]")?.dataset.key`);
    const other = await page.eval<string>(`[...document.querySelectorAll("[data-key]")].find(n=>n.dataset.key!==${JSON.stringify(selected)}&&n.getClientRects().length).dataset.key`);
    await page.hover(`[data-key="${other}"]`);
    await Bun.sleep(150);
    const look = (key: string) => page.eval<string>(`(()=>{const s=getComputedStyle(document.querySelector('[data-key="${key}"]'));return s.backgroundColor+"|"+s.boxShadow+"|"+s.outlineStyle})()`);
    expect(await look(selected)).not.toBe(await look(other));
  } finally { await page.close(); }
});
