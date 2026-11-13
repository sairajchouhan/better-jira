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

    // Display options' selects list through Linear's Select (`gy`, base-ui), not this menu: 24px rows at 12px, measured
    // live 2026-11-13. e2e/board-display.pw.ts checks them.

    await page.page.getByRole("navigation", { name: "Main navigation" }).getByRole("link", { name: "Mine", exact: true }).click({ button: "right" });
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

// Records what the sidebar's Help menu paints on every frame from the click until it settles. A ResizeObserver made after the
// popup's own (floating-ui's) runs after it in the same frame, before paint, so its first callback sees the first painted box.
const recordOpen = `(()=>{
  const box=(n)=>{if(!n)return null;const r=n.getBoundingClientRect();return [r.x,r.y,r.width,r.height].map(v=>Math.round(v*100)/100).join()};
  const out=window.__open={painted:null,frames:[]};
  const popup=()=>document.querySelector('[role=dialog][aria-label="Help"]');
  const still=()=>({help:box(document.getElementById('help-menu')),nav:box(document.getElementById('help-menu')?.parentElement),main:box(document.querySelector('main')),page:document.documentElement.clientWidth+'x'+document.documentElement.scrollHeight});
  new MutationObserver(()=>{
    const node=popup();
    if(node&&!out.painted){out.painted='pending';new ResizeObserver((_,ro)=>{out.painted=box(node);ro.disconnect()}).observe(node)}
  }).observe(document.body,{childList:true,subtree:true});
  let n=0;const frame=()=>{out.frames.push({popup:box(popup()),...still()});if(++n<30)requestAnimationFrame(frame)};
  requestAnimationFrame(frame);
})()`;

test("the sidebar Help menu opens in place: nothing grows, shrinks or moves, cold or warm", async ({ open }) => {
  const p = await open();
  for (const pass of ["cold", "warm"] as const) {
    await test.step(pass, async () => {
      if (pass === "cold") await p.reload();
      await p.waitFor(`!!document.getElementById('help-menu')`);
      await p.eval(recordOpen);
      await p.click("#help-menu");
      await p.waitFor(`window.__open.frames.length===30`);
      const { painted, frames } = await p.eval<{
        painted: string;
        frames: { popup: string | null; help: string; nav: string; main: string; page: string }[];
      }>("window.__open");
      const shown = frames.filter((f) => f.popup);
      expect(shown.length).toBeGreaterThan(20);
      // The first painted box is the final one (a transient "No matching actions" row once made it 42px too tall), on every frame after it too: 4px above the Help row, left at the window's 12px inset.
      const help = frames[0]!.help.split(",").map(Number);
      const [x, y, , h] = painted.split(",").map(Number);
      expect(x).toBe(12);
      expect(y! + h!).toBe(help[1]! - 4);
      expect(new Set(shown.map((f) => f.popup))).toEqual(new Set([painted]));
      // The trigger, the sidebar, the main column and the page never move.
      const { popup: _, ...first } = frames[0]!;
      for (const { popup: __, ...rest } of frames) expect(rest).toEqual(first);
      await p.key("Escape");
      await p.waitFor(`!document.querySelector('[role=dialog][aria-label="Help"]')`);
    });
  }
});

test("a popup whose content resizes re-places before the browser paints that frame", async ({ open }) => {
  const p = await open();
  await p.click("#help-menu");
  await p.waitFor(`!!document.querySelector('[role=dialog][aria-label="Help"] .menu-item')`);
  // Grow the menu by a row; the popup opens upward, so its bottom must stay 4px above the Help row in the very frame it grows.
  const result = await p.eval<{ bottom: number; anchor: number; height: number }>(`new Promise((done)=>{
    const node=document.querySelector('[role=dialog][aria-label="Help"]');
    new ResizeObserver((_,ro)=>{const r=node.getBoundingClientRect();ro.disconnect();done({bottom:r.bottom,height:r.height,anchor:document.getElementById('help-menu').getBoundingClientRect().top})}).observe(node);
    const row=document.createElement('div');row.style.height='42px';node.querySelector('.menu-list').append(row);
  })`);
  expect(result.height).toBe(88);
  expect(result.bottom).toBe(result.anchor - 4);
});
