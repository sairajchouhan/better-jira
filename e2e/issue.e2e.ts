import { afterAll, expect, test } from "bun:test";
import { open, type Page, stop } from "./harness";

afterAll(stop);

async function openIssue(page: Page, key = "TEST-1") {
  await page.click(`[data-key="${key}"]`);
  await page.waitFor(`!!document.getElementById("summary")&&!document.querySelector('[role=status]')?.textContent?.startsWith("Loading")`);
}
const editor = (id: string) => `document.querySelector('#${id}[contenteditable=true]')`;

test("R4/I8: the description is edited in place and autosaves, so a reload keeps the change", async () => {
  const page = await open();
  try {
    await openIssue(page);
    await page.key("i", "ctrl", "shift");
    await page.waitFor(`document.activeElement===${editor("description")}`);
    await page.click("#description h2"); await page.key("End");
    await page.type(" edited");
    expect(await page.eval(`!!document.querySelector('[role=dialog] #description')`)).toBe(false);
    await Bun.sleep(1500);
    await page.reload();
    await openIssue(page);
    expect(await page.waitFor<string>(`document.querySelector("#description h2")?.textContent`)).toBe("Rich fixture heading edited");
  } finally { await page.close(); }
});

test("I2: Tab inside a description code block indents and keeps focus in the editor", async () => {
  const page = await open();
  try {
    await openIssue(page);
    await page.key("i", "ctrl", "shift");
    await page.waitFor(`!!${editor("description")}`);
    await page.click("#description pre"); await page.key("End");
    await page.key("Tab");
    expect(await page.eval(`document.activeElement?.id`)).toBe("description");
    expect(await page.eval(`document.querySelector("#description pre").textContent`)).toBe("const answer = 42;  ");
  } finally { await page.close(); }
});

test("I9: the formatting toolbar stays one row when the caret enters a table", async () => {
  const page = await open();
  try {
    await openIssue(page);
    await page.key("i", "ctrl", "shift");
    await page.waitFor(`!!${editor("description")}`);
    await page.click("#description h2");
    const toolbar = `document.querySelector('[role=toolbar][aria-label="Description formatting"]').getBoundingClientRect().height`;
    const before = await page.eval<number>(toolbar);
    await page.click("#description td");
    await page.waitFor(`!!document.querySelector('[aria-label="Add table row"]')`);
    expect(await page.eval<number>(toolbar)).toBe(before);
    expect(before).toBeLessThan(40);
  } finally { await page.close(); }
});

test("I7: a sent comment keeps focus in the comment box, renders Markdown, and can be edited and deleted", async () => {
  const page = await open();
  try {
    await openIssue(page);
    await page.click("#comment");
    await page.type("**bold** first");
    await page.key("Enter", "meta");
    await page.waitFor(`document.querySelectorAll("[data-comment]").length===1`);
    await Bun.sleep(150);
    expect(await page.eval(`document.activeElement?.id`)).toBe("comment");
    expect(await page.eval(`document.querySelector("[data-comment] strong")?.textContent`)).toBe("bold");
    await page.click('[data-comment] [aria-label="Edit comment"]');
    await page.waitFor(`document.activeElement?.getAttribute("aria-label")==="Edit comment"`);
    await page.key("End"); await page.type(" again");
    await page.click("text=Save comment");
    await page.waitFor(`document.querySelector("[data-comment]")?.textContent.includes("first again")`);
    await page.click('[data-comment] [aria-label="Delete comment"]');
    await page.waitFor(`document.querySelectorAll("[data-comment]").length===0`);
  } finally { await page.close(); }
});

test("I6: a line break typed in a comment shows as a line break", async () => {
  const page = await open();
  try {
    await openIssue(page);
    await page.click("#comment");
    await page.type("line one"); await page.key("Enter"); await page.type("line two");
    await page.key("Enter", "meta");
    await page.waitFor(`document.querySelectorAll("[data-comment]").length===1`);
    expect(await page.eval(`document.querySelector("[data-comment] .leading-\\\\[1\\\\.6\\\\]").innerText.trim()`)).toMatch(/^line one\n+line two$/);
  } finally { await page.close(); }
});
