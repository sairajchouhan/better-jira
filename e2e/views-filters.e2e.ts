/** QA round 2: views and filters. */
import { afterAll, expect, test } from "bun:test";
import { open, PREFS_KEY, stop } from "./harness";

afterAll(stop);
const root = `document.querySelector('[aria-label="Add Filter…"]')`;
const chips = `[...document.querySelectorAll("button.truncate")].map(b=>b.textContent)`;
const stored = `JSON.parse(localStorage.getItem(${JSON.stringify(PREFS_KEY)})??"{}")[1]`;

test("R2-D3: the Overdue preset saves a relative filter and its chip reads Overdue", async () => {
  const page = await open();
  try {
    await page.click('[aria-label="Add filter"]');
    await page.hover("text=Dates");
    await page.waitFor(`!!document.querySelector('[aria-label="Filter Dates"]')`);
    await page.hover("text=Due date");
    await page.waitFor(`!!document.querySelector('input[aria-label="Due date"]')`);
    await page.click("text=Overdue");
    await page.waitFor(`${chips}.includes("Overdue")`);
    await page.waitFor(`${stored}?.filters?.children?.[0]?.values?.[0]==="P0D"`);
  } finally {
    await page.close();
  }
});

test("R2-D4: a view=page link opens full page once and keeps the board's Open issues in", async () => {
  const page = await open("?board=1&issue=TEST-2&view=page");
  try {
    await page.waitFor(`machines.ui.getSnapshot().context.view==="page"`);
    await page.key("Escape");
    await page.waitFor(`!machines.ui.getSnapshot().context.panel`);
    await page.waitFor(`machines.ui.getSnapshot().context.view==="side"`);
    await page.click('[data-key="TEST-1"]');
    await page.waitFor(`machines.ui.getSnapshot().context.selected==="TEST-1"`);
    expect(await page.eval(`machines.ui.getSnapshot().context.view`)).toBe("side");
    expect(await page.eval(`${stored}?.display?.openIn ?? "side"`)).toBe("side");
  } finally {
    await page.close();
  }
});

test("R2-D5: a chip switched from is empty back to is and closed without a value is dropped", async () => {
  const filters = {
    id: "root",
    join: "and",
    children: [{ id: "p", field: "priority", op: "is", values: ["High"] }],
  };
  const page = await open("", {
    setup: `if(!sessionStorage.seeded){sessionStorage.seeded=1;localStorage.setItem(${JSON.stringify(PREFS_KEY)},${JSON.stringify(JSON.stringify({ 1: { filters } }))})}`,
  });
  try {
    await page.click("text=Priority is High");
    await page.click('[aria-label="Priority operator"] button:nth-child(3)'); // is empty
    await page.waitFor(`${chips}.includes("Priority is empty")`);
    await page.click('[aria-label="Priority operator"] button:nth-child(1)'); // is
    await page.waitFor(`${chips}.includes("Priority is ")`);
    await page.key("Escape");
    await page.waitFor(`!${chips}.some(c=>c.startsWith("Priority"))`);
    expect(await page.eval(`${stored}?.filters?.children?.length ?? 0`)).toBe(0);
  } finally {
    await page.close();
  }
});

test("R2-D6: the first F after load opens the filter menu without a loading step", async () => {
  const page = await open();
  try {
    await Bun.sleep(800); // the menu preloads once the browser is idle
    await page.eval(
      `window.sawLoading=false;new MutationObserver(()=>{if(document.body.textContent.includes("Opening filters…"))window.sawLoading=true}).observe(document.body,{childList:true,subtree:true,characterData:true})`,
    );
    await page.eval(`document.activeElement?.blur()`);
    await page.key("f");
    await page.waitFor(`!!${root}`);
    expect(await page.eval(`window.sawLoading`)).toBe(false);
  } finally {
    await page.close();
  }
});
