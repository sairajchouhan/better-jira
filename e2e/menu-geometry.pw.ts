import { expect, test, PREFS_KEY, type App } from "./app";

// Every dropdown renders through src/client/components/menu.tsx, Linear's one menu primitive (startup-root.CnUSfl4j.js: IB/B3e, Vw, fT).
// One geometry for all of them, so a per-menu drift fails here.
const probe = `(()=>{const m=[...document.querySelectorAll('.menu')].at(-1),list=m.querySelector('.menu-list'),items=[...m.querySelectorAll('[cmdk-item]')],row=items.find(n=>!n.querySelector('.menu-checkbox'))??items[0],r=getComputedStyle(row),h=getComputedStyle(row,'::before'),hovered=items.find(n=>n.matches('[data-selected=true]'));return {list:getComputedStyle(list).padding,height:row.getBoundingClientRect().height,padding:r.padding,font:r.fontSize,highlight:[h.left,h.right,h.borderRadius],selected:hovered?getComputedStyle(hovered,'::before').backgroundColor:null,shared:items.every(n=>n.classList.contains('menu-item'))}})()`;

const expected = (scheme: "dark" | "light") => ({
  list: "6px 0px",
  height: 32,
  padding: "0px 18px 0px 14px",
  font: "13px",
  highlight: ["6px", "6px", "8px"],
  selected: scheme === "dark" ? "lch(20.82 1.3 272)" : "lch(95 0 282)",
  shared: true,
});

/** Hovers the menu's first plain row (cmdk highlights it), then reads the shared geometry. */
async function measure(page: App) {
  await page.waitFor(`!!document.querySelector('.menu .menu-item')`);
  await page.page
    .locator(".menu")
    .last()
    .locator(".menu-item:not(:has(.menu-checkbox))")
    .first()
    .hover();
  return page.eval(probe);
}

for (const scheme of ["dark", "light"] as const) {
  test(`every menu shares Linear's menu geometry (${scheme})`, async ({ open }) => {
    const view = { id: "v1", board: 1, name: "Mine", mine: false, preferences: {} };
    const key = PREFS_KEY.replace("views:v1", "saved-views:v1");
    const page = await open("", {
      setup: `localStorage.setItem(${JSON.stringify(key)},${JSON.stringify(JSON.stringify([view]))})`,
    });
    await page.page.emulateMedia({ colorScheme: scheme });
    const menus: Record<string, unknown> = {};

    await page.click('[aria-label="Options for Todo"]');
    menus["column ⋯"] = await measure(page);
    await page.key("Escape");

    await page.click('[aria-label="Add filter"]');
    menus.filter = await measure(page);
    await page.key("Escape");

    await page.click('[aria-label="Display options"]');
    await page.click('[aria-label^="Columns:"]');
    menus.display = await measure(page);
    await page.key("Escape");
    await page.key("Escape");

    await page.page.getByRole("navigation", { name: "Main navigation" }).getByRole("button", { name: "Mine", exact: true }).click({ button: "right" });
    menus.view = await measure(page);
    await page.key("Escape");

    await page.goto("?issue=TEST-2&view=page");
    await page.waitFor(`!!document.getElementById('comment')`);
    await page.click("#issue-options");
    menus["action ⋯"] = await measure(page);
    await page.key("Escape");

    await page.click("#prop-priority");
    menus["property picker"] = await measure(page);
    await page.key("Escape");

    await page.goto("?inbox=1");
    await page.waitFor(`document.querySelectorAll('[data-inbox-row]').length>0`);
    await page.key("j");
    await page.key("h");
    menus["inbox snooze"] = await measure(page);
    await page.key("Escape");

    const all = expected(scheme);
    expect(menus).toEqual(Object.fromEntries(Object.keys(menus).map((name) => [name, all])));
  });
}
