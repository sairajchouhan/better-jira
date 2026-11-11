import { expect, test, PREFS_KEY } from "./app";

// Shipped Linear IssueList.CUOYX8Am.js (qu/Xd) -> startup-root.CnUSfl4j.js
// (FI -> IB/B3e, Vw, fT, S3e), style-kMXsq6uH.css; see docs/column-menu-parity.md.
for (const scheme of ["dark", "light"] as const) {
  test(`column menu matches Linear action-menu geometry and keys (${scheme})`, async ({
    open,
  }) => {
    const page = await open();
    await page.page.emulateMedia({ colorScheme: scheme });
    await page.click('[aria-label="Options for Todo"]');
    const menu = '[role="dialog"][aria-label="Column Todo"]';
    await page.waitFor(`!!document.querySelector('${menu} [cmdk-item]')`);
    expect(
      await page.eval(
        `(()=>{const p=document.querySelector('${menu}'),list=p.querySelector('[cmdk-list]'),row=p.querySelector('[cmdk-item]'),s=getComputedStyle(p),l=getComputedStyle(list),r=getComputedStyle(row),h=getComputedStyle(row,'::before'),b=p.getBoundingClientRect(),t=document.querySelector('[aria-label="Options for Todo"]').getBoundingClientRect();return {padding:s.padding,radius:s.borderRadius,listPadding:l.padding,height:row.getBoundingClientRect().height,rowPadding:r.padding,font:r.fontSize,weight:getComputedStyle(row.querySelector('.menu-name')).fontWeight,family:r.fontFamily,gap:getComputedStyle(row.querySelector('.menu-label')).gap,highlightRadius:h.borderRadius,highlightLeft:h.left,highlightRight:h.right,left:b.left-Math.round(t.left),top:b.top-Math.round(t.bottom),items:[...p.querySelectorAll('[cmdk-item]')].map(n=>n.textContent),color:getComputedStyle(row.querySelector('span span')).color,background:s.backgroundColor,border:s.borderColor}})()`,
      ),
    ).toEqual({
      padding: "0px",
      radius: "12px",
      listPadding: "6px 0px",
      height: 32,
      rowPadding: "0px 18px 0px 14px",
      font: "13px",
      weight: "450", // the label's text variant `small` (sx-1nzvdvg)
      family: '"Inter Variable", ui-sans-serif, system-ui, sans-serif',
      gap: "8px",
      highlightRadius: "8px",
      highlightLeft: "6px",
      highlightRight: "6px",
      left: 0,
      top: 4,
      items: ["Select all in column", "Hide column"],
      color: scheme === "dark" ? "lch(91.178 1.425 272)" : "lch(20 1 282)",
      background: scheme === "dark" ? "lch(12.72 0.85 272)" : "lch(100 0 282)",
      border: scheme === "dark" ? "lch(21.36 1.93 272)" : "lch(91.9 0 282)",
    });
    // Pointer-open starts without a selection; typing filters, arrows select, Escape restores focus.
    await page.key("Enter");
    expect(await page.eval(`!!document.querySelector('${menu}')`)).toBe(true);
    await page.type("Hide");
    expect(
      await page.eval(
        `document.querySelector('${menu} [cmdk-item]').textContent`,
      ),
    ).toBe("Hide column");
    await page.key("Escape");
    await page.waitFor(
      `document.activeElement?.getAttribute('aria-label')==='Options for Todo'`,
    );
    await page.key("Enter");
    await page.key("Enter");
    await page.waitFor(
      `document.querySelectorAll('[data-selected]').length===5`,
    );
    await page.key("Escape");
    await page.waitFor(
      `document.querySelectorAll('[data-selected]').length===0`,
    );
    await page.click('[aria-label="Options for Todo"]');
    await page.key("ArrowUp");
    await page.key("Enter");
    await page.waitFor(
      `!document.querySelector('[aria-label="Options for Todo"]')`,
    );
  });
}

test("completed column has Linear's recency action, including in swimlane headers", async ({
  open,
}) => {
  const setup = `localStorage.setItem(${JSON.stringify(PREFS_KEY)},JSON.stringify({1:{display:{rows:'assignee'},hidden:[]}}))`;
  const page = await open("", { setup });
  await page.click("text=All issues");
  // Reveal the fixture's empty completed column if the default view hides it.
  if (await page.eval(`!!document.querySelector('[aria-label="Show Done"]')`))
    await page.click('[aria-label="Show Done"]');
  await page.click('[aria-label="Options for Done"]');
  expect(
    await page.eval(
      `[...document.querySelectorAll('[aria-label="Column Done"] [cmdk-item]')].map(n=>n.textContent)`,
    ),
  ).toEqual(["Hide column", "Order completed by recency"]);
  await page.click("text=Order completed by recency");
  await page.click('[aria-label="Options for Done"]');
  expect(
    await page.eval(
      `!!document.querySelector('[aria-label="Column Done"] [cmdk-item]:last-child svg')`,
    ),
  ).toBe(true);
});
