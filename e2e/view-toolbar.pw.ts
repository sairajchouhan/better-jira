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
    await page.waitFor(`!!document.querySelector('.ui-filter-block')`);
    expect(
      await page.eval(
        `document.querySelector('[aria-label="Add another filter"]').textContent.trim()`,
      ),
    ).toBe("");
    expect(
      await page.eval(
        `getComputedStyle(document.querySelector('.ui-filter-block')).height`,
      ),
    ).toBe("24px");
    // Linear's AddFilterButton: the menu opens bottom-left under the +, 4px below it, even when the toolbar Filter menu is open.
    // FILTER-4: a press outside an open menu only closes it, so the + takes a second press; a press on the + itself closes it too.
    const press = async (selector: string) => {
      const r = await page.rect(selector);
      await page.clickAt(r.x + r.width / 2, r.y + r.height / 2);
    };
    for (const first of [null, '[aria-label="Add filter"],[title="Filter (F)"],header [aria-label="Add another filter"]:not(.ui-filter-add)']) {
      if (first) {
        await page.click(first);
        await press(".ui-filter-add");
        await page.waitFor(`!document.querySelector('[data-popover]')`);
      }
      await page.click(".ui-filter-add");
      await page.waitFor(`!!document.querySelector('input[placeholder^="Add Filter"],input[placeholder^="Filter"]')`);
      await page.waitFor(`(()=>{const a=document.querySelector('.ui-filter-add').getBoundingClientRect();const m=document.querySelector('[data-popover]');return m&&m.style.left===Math.round(a.left)+'px'&&m.style.top===Math.round(a.bottom+4)+'px'})()`);
      expect(await page.eval(`document.querySelector('.ui-filter-add').getAttribute('aria-expanded')`)).toBe("true");
      await press(".ui-filter-add");
      await page.waitFor(`!document.querySelector('[data-popover]')`);
    }
    await page.click('[aria-label="priority operator"]');
    await page.click('[role^=menuitem][data-value="isNot"]');
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
    await page.waitFor(`!document.querySelector('.ui-filter-bar')`);
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
    await page.waitFor(`!!document.querySelector('.ui-filter-block')`);
    await page.click('[aria-label="Display options"]');
    expect(await page.eval(`document.querySelector('[aria-label="Display options"][role=dialog]').textContent`)).not.toContain("Save my default");
    await page.key("Escape");
    await page.eval(`document.body.dispatchEvent(new KeyboardEvent('keydown',{key:'ß',code:'KeyS',altKey:true,bubbles:true}))`);
    await page.waitFor(`!document.querySelector('.ui-filter-block')`);
    const views = await page.eval<any[]>(`fetch('/api/views').then(r=>r.json())`);
    expect(views.find(v => path.endsWith(v.id)).filters.children.length).toBe(1);
    await page.reload();
    expect(await page.eval(`!!document.querySelector('.ui-filter-block')`)).toBe(false);
    await page.goto(`${path}?filter=${encoded}`);
    await page.waitFor(`!!document.querySelector('.ui-filter-block')`);
    await page.click("text=Clear");
    await page.waitFor(`!document.querySelector('.ui-filter-block')`);
    const after = await page.eval<any[]>(`fetch('/api/views').then(r=>r.json())`);
    expect(after.find(v => path.endsWith(v.id)).filters.children.length).toBe(1);
  } finally { await page.close(); }
});
