import { expect, test, fixture, type App as Page } from "./app";

// Package F (BJ-181): Linear's table menus, edge buttons and move keys, checked through what reaches Jira.

const savedDescription = async (key = "TEST-2") => {
  const writes = (await fixture.log()).writes.filter((w: { key: string }) => w.key === key);
  for (const write of writes.reverse())
    for (const op of write.ops) if (op.op === "fields" && op.fields.description) return op.fields.description;
  return null;
};
/** The rows of the description's table, as Jira got them: each cell's type initial and text. */
const savedTable = async () => {
  const table = (await savedDescription())?.content.find((n: any) => n.type === "table");
  const text = (n: any): string => (n.text ?? "") + (n.content ?? []).map(text).join("");
  return table?.content.map((row: any) => row.content.map((c: any) => (c.type === "tableHeader" ? "H:" : "") + text(c)));
};
/** The inserted table's rows, as shown (it lands above the fixture's own table). */
const rows = (page: Page) =>
  page.eval<string[][]>(
    `[...document.querySelector('#description table').rows].map(r=>[...r.cells].map(c=>(c.tagName==='TH'?'H:':'')+c.textContent))`,
  );
const pick = async (page: Page, menu: string, item: string) => {
  await page.waitFor(`!!document.querySelector('[aria-label="${menu}"] [role^=menuitem]')`);
  await page.eval(
    `[...document.querySelectorAll('[aria-label="${menu}"] [role^=menuitem]')].find(n=>n.textContent.startsWith(${JSON.stringify(item)})).click()`,
  );
};
/** Hovers a cell, then clicks its row or column handle (the pointer slides along the row or column to reach it). */
async function handle(page: Page, cell: string, axis: "Row" | "Column") {
  await page.hover(cell);
  await page.click(`[aria-label="${axis} actions"]`);
}

test("BJ-181: table menus, edge buttons and ⌘⇧⌥ arrows edit the table Jira gets", async ({ open }) => {
  await fixture.reset({ writable: true });
  const page = await open("?issue=TEST-2&view=page");
  await page.eval(
    `Object.defineProperty(navigator,'clipboard',{value:{write:async items=>{window.__copied=await (await items[0].getType('text/plain')).text()},writeText:async t=>{window.__copied=t}}})`,
  );
  await page.waitFor(`!!document.querySelector('#description p')`);
  await page.click("#description p");
  await page.key("End");
  await page.key("Enter");
  await page.type("/table");
  await page.key("Enter");
  await page.waitFor(`!!document.querySelector('#description table')`);
  for (const [i, text] of ["b", "2", "a", "1"].entries()) {
    if (i) await page.key("Tab");
    await page.type(text);
  }

  await test.step("⌘⇧⌥↑ moves the caret's row up; ⌘⇧⌥→ moves its column right", async () => {
    await page.key("ArrowUp", "meta", "shift", "alt");
    expect(await rows(page)).toEqual([["a", "1"], ["b", "2"]]);
    await page.type("0");
    await page.key("ArrowLeft", "meta", "shift", "alt");
    expect(await rows(page)).toEqual([["10", "a"], ["2", "b"]]);
  });

  await test.step("the cell menu, from a right-click, adds the header", async () => {
    const r = await page.rect("#description td");
    await page.page.mouse.click(r.x + 5, r.y + 5, { button: "right" });
    await pick(page, "Cell actions", "Add header");
    expect(await rows(page)).toEqual([["H:10", "H:a"], ["2", "b"]]);
  });

  await test.step("the edge Add row button appends a row; the row menu inserts above and the column menu sorts", async () => {
    await page.click('[aria-label="Add row"]');
    expect((await rows(page)).length).toBe(3);
    await page.click("#description tr:nth-child(3) td:nth-child(2)");
    await page.type("c");
    await handle(page, "#description tr:nth-child(3) td:nth-child(1)", "Row");
    await pick(page, "Row actions", "Insert row above");
    expect(await rows(page)).toEqual([["H:10", "H:a"], ["2", "b"], ["", ""], ["", "c"]]);
    await handle(page, "#description tr:nth-child(2) td:nth-child(2)", "Column");
    await pick(page, "Column actions", "Sort descending");
    expect(await rows(page)).toEqual([["H:10", "H:a"], ["", "c"], ["2", "b"], ["", ""]]);
  });

  await test.step("Table actions › Copy table copies Markdown and toasts", async () => {
    await page.click('[aria-label="Table actions"]');
    await pick(page, "Table actions", "Copy table");
    await page.waitFor(`document.body.textContent.includes('Table copied to clipboard')`);
    expect(await page.eval<string>(`window.__copied`)).toContain("| 10 | a |");
  });

  await page.click("#description p");
  await expect
    .poll(savedTable, { timeout: 8000 })
    .toEqual([["H:10", "H:a"], ["", "c"], ["2", "b"], ["", ""]]);
});
