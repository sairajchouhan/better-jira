import { expect, test, PREFS_KEY } from "./app";

test("segmented chips edit operators and values independently, Save offers creation, and Clear empties filters", async ({
  open,
}) => {
  const filters = {
    id: "root",
    join: "and",
    children: [{ id: "p", field: "priority", op: "is", values: ["High"] }],
  };
  const page = await open("", {
    setup: `if(!sessionStorage.seeded){sessionStorage.seeded=1;localStorage.setItem(${JSON.stringify(PREFS_KEY)},${JSON.stringify(JSON.stringify({ 1: { filters } }))})}`,
  });
  try {
    await page.waitFor(`!!document.querySelector('.view-filter-chip')`);
    expect(
      await page.eval(
        `document.querySelector('[aria-label="Add another filter"]').textContent.trim()`,
      ),
    ).toBe("");
    expect(
      await page.eval(
        `getComputedStyle(document.querySelector('.view-filter-chip')).height`,
      ),
    ).toBe("24px");
    await page.click('[aria-label="priority operator"]');
    await page.click('[cmdk-item][data-value="isNot"]');
    await page.click('[aria-label="priority value"]');
    await page.waitFor(
      `!!document.querySelector('input[aria-label="Filter Priority"]')`,
    );
    await page.key("Escape");
    await page.click("text=Save");
    await page.waitFor(
      `!!document.querySelector('[aria-label="Save filters"]')`,
    );
    expect(
      await page.eval(
        `document.querySelector('[aria-label="Save filters"]').textContent`,
      ),
    ).toContain("Create new view…");
    expect(
      await page.eval(
        `document.querySelector('[aria-label="Save filters"]').textContent`,
      ),
    ).not.toContain("Save to this view");
    await page.key("Escape");
    await page.click("text=Clear");
    await page.waitFor(`!document.querySelector('.view-filter-row')`);
  } finally {
    await page.close();
  }
});

test("active views hide base chips, keep base on Clear, scope Display, and handle physical Option shortcuts", async ({ open }) => {
  const page = await open();
  try {
    await page.eval(`document.body.dispatchEvent(new KeyboardEvent('keydown',{key:'√',code:'KeyV',altKey:true,bubbles:true}))`);
    await expect(page.page).toHaveURL(/\/view\/new/);
    await page.click('[aria-label="View name"]');
    await page.type("Toolbar view");
    await page.click("text=Create view");
    await page.waitFor(`location.pathname.startsWith('/view/') && location.pathname !== '/view/new'`);
    const path = await page.eval<string>("location.pathname");
    const overlay = { id: "temporary", join: "and", children: [{ id: "p", field: "priority", op: "is", values: ["High"] }] };
    const encoded = Buffer.from(JSON.stringify({ v: 1, filters: overlay })).toString("base64url");
    const favorite = `Object.entries(localStorage).filter(([key])=>key.includes('favorites')).map(([,value])=>value).join('')`;
    await page.eval(`document.body.dispatchEvent(new KeyboardEvent('keydown',{key:'ƒ',code:'KeyF',altKey:true,bubbles:true}))`);
    await page.waitFor(`${favorite}.includes('view:')`);
    const beforeFavorite = await page.eval(favorite);
    await page.eval(`const input=document.createElement('input');document.body.append(input);input.focus();input.dispatchEvent(new KeyboardEvent('keydown',{key:'ƒ',code:'KeyF',altKey:true,bubbles:true}));input.remove()`);
    expect(await page.eval(favorite)).toBe(beforeFavorite);
    await page.eval(`document.body.dispatchEvent(new KeyboardEvent('keydown',{key:'ƒ',code:'KeyF',altKey:true,bubbles:true}))`);
    await page.waitFor(`!${favorite}.includes('view:')`);
    await page.goto(`${path}?filter=${encoded}`);
    await page.waitFor(`!!document.querySelector('.view-filter-chip')`);
    await page.click('[aria-label="Display options"]');
    expect(await page.eval(`document.querySelector('[aria-label="Display options"][role=dialog]').textContent`)).not.toContain("Save my default");
    await page.key("Escape");
    await page.eval(`document.body.dispatchEvent(new KeyboardEvent('keydown',{key:'ß',code:'KeyS',altKey:true,bubbles:true}))`);
    await page.waitFor(`!document.querySelector('.view-filter-chip')`);
    const views = await page.eval<any[]>(`fetch('/api/views').then(r=>r.json())`);
    expect(views.find(v => path.endsWith(v.id)).filters.children.length).toBe(1);
    await page.reload();
    expect(await page.eval(`!!document.querySelector('.view-filter-chip')`)).toBe(false);
    await page.goto(`${path}?filter=${encoded}`);
    await page.waitFor(`!!document.querySelector('.view-filter-chip')`);
    await page.click("text=Clear");
    await page.waitFor(`!document.querySelector('.view-filter-chip')`);
    const after = await page.eval<any[]>(`fetch('/api/views').then(r=>r.json())`);
    expect(after.find(v => path.endsWith(v.id)).filters.children.length).toBe(1);
  } finally { await page.close(); }
});
