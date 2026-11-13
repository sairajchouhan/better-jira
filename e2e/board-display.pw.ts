/** QA round 1, group G7: board, filters and display. */
import { expect, test, PREFS_KEY, fixture, type App as Page } from "./app";

const seed = (prefs: object, extra = "") =>
  `if(!sessionStorage.seeded){sessionStorage.seeded=1;localStorage.setItem(${JSON.stringify(PREFS_KEY)},${JSON.stringify(JSON.stringify(prefs))});${extra}}`;
const chips = `[...document.querySelectorAll(".view-filter-chip")].map(b=>b.textContent)`;
const cards = `document.querySelectorAll("[data-key]").length`;
/** Reloads the page with these view preferences. A view that shows no cards (`empty`) is waited for by its filter bar,
 *  since `reload` waits for a card. */
async function show(page: Page, prefs: object, empty = false) {
  await page.eval(
    `localStorage.setItem(${JSON.stringify(PREFS_KEY)},${JSON.stringify(JSON.stringify(prefs))})`,
  );
  if (!empty) return page.reload();
  await page.page.reload();
  await page.waitFor(
    `!!document.querySelector('[aria-label="Add another filter"]')&&!document.querySelector("[data-key]")`,
  );
}

test("the default board: My issues, board details, saved views and a fast layout switch", async ({
  open,
}) => {
  const page = await open();
  await page.waitFor(`${cards}===6`);
  await test.step("R1-D56: My issues lives in the URL, survives reload, and names itself in the breadcrumb", async () => {
    await page.eval(
      `[...document.querySelectorAll("nav a")].find(b=>b.textContent.includes("My issues")).click()`,
    );
    await page.waitFor(`location.pathname==="/my-issues"`);
    await page.eval("location.reload()");
    await page.waitFor(
      `!!document.querySelector('[aria-label="Breadcrumb"] [aria-label="My issues"]')`,
    );
    expect(await page.eval(cards)).toBe(0); // no fixture issue is assigned to the user
    await page.eval("history.back()");
    await page.waitFor(`${cards}===6`);
    expect(await page.eval(`new URLSearchParams(location.search).has("mine")`)).toBe(false);
  });
  await test.step("R1-D89: a board-details bucket shows as active and toggles its filter off", async () => {
    await page.click('button[aria-label="Board details"]');
    await page.click("text=Alex1");
    await page.waitFor(`${cards}===1`);
    expect(
      await page.eval(
        `document.querySelector('[aria-label="Board details"] [aria-pressed=true]')?.textContent`,
      ),
    ).toBe("Alex1");
    await page.click("text=Alex1");
    await page.waitFor(`${cards}===6`);
  });
  await test.step("saved custom views are listed in the sidebar's Views section", async () => {
    const view = { id: "v1", board: 1, name: "Mine", mine: false, preferences: {} };
    const key = PREFS_KEY.replace("views:v1", "saved-views:v1");
    await page.eval(`localStorage.removeItem(${JSON.stringify(key + ":imported")});localStorage.setItem(${JSON.stringify(key)},${JSON.stringify(JSON.stringify([view]))})`);
    await page.reload();
    const row = page.page.getByRole("navigation", { name: "Main navigation" }).getByRole("link", { name: "Mine", exact: true });
    await row.click({ button: "right" });
    await page.click("text=Delete");
    expect(await page.eval(`document.querySelector('[role=dialog]')?.textContent.includes('Delete the view "Mine"?')`)).toBe(true);
    await page.click("text=Cancel");
    expect(await row.count()).toBe(1);
    await row.click();
    await page.waitFor(`location.pathname === '/view/mine-v1'`);
    await page.click('[aria-label="Breadcrumb"] a[aria-label="Browser audit"]');
  });
  await test.step("R1-D95/D96, BJ-111: a layout switch paints only the first screenful; the rest stays windowed", async () => {
    await fixture.reset({ bulk: 90 });
    await page.reload();
    await page.waitFor(`!!document.querySelector("[data-virtual-items]")&&${cards}>0`);
    // Count the cards the keypress commits, before the follow-up task fills the rest.
    await page.eval(
      `new MutationObserver((_,o)=>{if(document.querySelector("[data-layout=list]")){window.firstPaint=document.querySelectorAll("[data-key]").length;o.disconnect()}}).observe(document.querySelector("main"),{subtree:true,attributes:true,attributeFilter:["data-layout"]})`,
    );
    await page.key("b", "meta");
    await page.waitFor(
      `document.querySelector("[data-layout]").dataset.layout==="list"&&!!document.querySelector("[data-virtual-items]")`,
    );
    expect(await page.eval<number>(`window.firstPaint`)).toBeLessThanOrEqual(30);
  });
});

test("display preferences: card dates, filter chips, empty views and pill menus", async ({
  open,
}) => {
  const page = await open();
  await test.step("R1-D50/D94: cards show Linear's short dates and no PR placeholder", async () => {
    await show(page, { 1: { display: { properties: ["id", "updated", "due", "pullRequests"] } } });
    await page.waitFor(`${cards}===6`);
    const text = await page.eval<string>(
      `document.querySelector('[data-key="TEST-1"]').textContent`,
    );
    expect(text).toContain("Updated Nov 6");
    expect(text).not.toContain("2026");
    expect(text).not.toContain("PRs");
  });
  await test.step("R1-D93: Done returns focus to the filter button; pill menus open on the current choice", async () => {
    await show(page, { 1: { display: { layout: "list", columns: "priority" } } });
    await page.waitFor(`${cards}===6`);
    await page.eval(`machines.ui.send({type:"toolbar.open",toolbar:"advanced"})`);
    await page.click("text=Done");
    await page.waitFor(`document.activeElement?.getAttribute("aria-label")==="Add filter"`);
    await page.click('[aria-label="Display options"]');
    await page.click('[aria-label="Grouping: Priority"]');
    await page.waitFor(`!!document.querySelector("[cmdk-item][data-selected=true]")`);
    expect(
      await page.eval(`document.querySelector("[cmdk-item][data-selected=true]").textContent`),
    ).toBe("Priority");
    await page.key("Escape");
  });
  await test.step("R1-D40/D87/D93: chip text reads naturally, empty groups get no chip, and is empty drops stale values", async () => {
    const filters = {
      id: "root",
      join: "and",
      children: [
        { id: "a", field: "due", op: "within", values: ["3"] },
        { id: "b", field: "statusAge", op: "lt", values: ["1"] },
        { id: "c", field: "created", op: "before", values: ["2026-11-08"] },
        { id: "d", field: "priority", op: "is", values: ["High"] },
        { id: "e", join: "or", children: [] },
        { id: "f", join: "or", children: [{ id: "g", field: "labels", op: "is", values: ["ui"] }] },
      ],
    };
    await show(page, { 1: { filters } }, true);
    await page.waitFor(`document.querySelectorAll(".view-filter-chip").length===5`);
    expect(await page.eval(chips)).toEqual([
      "Due datein the last3 days",
      "Time in current statusless than1 day",
      "Created datebeforeNov 8",
      "PriorityisHigh",
      "OR group · 1 rule",
    ]);
    await page.click('[aria-label="priority operator"]');
    await page.click('[cmdk-item][data-value="empty"]');
    await page.waitFor(`${chips}.includes("Priorityis empty")`);
    await page.key("Escape");
  });
  await test.step("R1-D92: an empty view counts the issues filters hide and clears them", async () => {
    const filters = {
      id: "root",
      join: "and",
      children: [{ id: "a", field: "labels", op: "is", values: ["none-such"] }],
    };
    await show(page, { 1: { filters } }, true);
    await page.waitFor(
      `document.querySelector("[role=status]")?.textContent.includes("No issues matching the filters")`,
    );
    await page.click("text=Clear Filters");
    await page.waitFor(`${cards}===6`);
  });
  await test.step("R1-D58/D59: swimlane titles stay pinned left, and the lane + prefills the lane's property", async () => {
    const page = await open("", {
      setup: seed({ 1: { display: { rows: "priority" } } }),
      width: 800,
    });
    await page.waitFor(`${cards}===6`);
    const title = `[...document.querySelectorAll(".sticky.left-0")].find(n=>n.textContent.startsWith("High"))`;
    const left = await page.eval<number>(`${title}.getBoundingClientRect().left`);
    const scroller = `document.querySelector("h2").closest(".overflow-auto")`;
    expect(
      await page.eval<number>(`(${scroller}.scrollLeft=1e5,${scroller}.scrollLeft)`),
    ).toBeGreaterThan(100);
    expect(await page.eval<number>(`${title}.getBoundingClientRect().left`)).toBe(left);
    await page.click('[aria-label="New issue in High"]');
    await page.waitFor(`machines.ui.getSnapshot().context.overlay==="create"`);
    expect(await page.eval(`machines.ui.getSnapshot().context.draft`)).toMatchObject({
      status: "todo",
      priority: "High",
    });
  });
});

test("BJ-194: list and board date tooltips share the absolute timestamp formatter", async ({ open }) => {
  const page = await open();
  for (const layout of ["board", "list"]) {
    await show(page, { 1: { display: { layout, properties: ["id", "created", "updated"] } } });
    const titles = await page.eval<string[]>(`[...document.querySelector('[data-key="TEST-1"]').querySelectorAll('[title]')].map(n=>n.title).filter(t=>/^(Created|Updated) /.test(t))`);
    expect(titles).toHaveLength(2);
    for (const title of titles) {
      expect(title).toMatch(/^(Created|Updated) [A-Z][a-z]{2} [A-Z][a-z]{2} \d+, \d{4}.*\d{2}:\d{2}:\d{2}$/);
      expect(title).not.toContain("T10:00:00");
    }
  }
});

test("1.8: a list row leads with the priority icon, left of the ID and status; a card keeps its priority chip", async ({ open }) => {
  const page = await open();
  await show(page, { 1: { display: { layout: "list", properties: ["id", "status", "priority", "labels"] } } });
  await page.waitFor(`!!document.querySelector('[data-key="TEST-1"] [title="Normal"]')`);
  const order = await page.eval<string[]>(
    `(()=>{const row=document.querySelector('[data-key="TEST-1"]');const pick=row.querySelector('[title="Normal"]');const id=[...row.querySelectorAll("*")].find(n=>n.childElementCount===0&&n.textContent.trim()==="TEST-1");const title=[...row.querySelectorAll("span")].find(n=>n.classList.contains("flex-1"));return [pick,id,title].sort((a,b)=>a.getBoundingClientRect().left-b.getBoundingClientRect().left).map(n=>n===pick?"priority":n===id?"id":"title")})()`,
  );
  expect(order).toEqual(["priority", "id", "title"]);
  await show(page, { 1: { display: { layout: "board", properties: ["id", "priority"] } } });
  const chip = await page.eval<number>(
    `(()=>{const card=document.querySelector('[data-key="TEST-1"]');const pick=card.querySelector('[title="Normal"]');return pick.getBoundingClientRect().top-card.getBoundingClientRect().top})()`,
  );
  expect(chip).toBeGreaterThan(20);
});

// Linear: clicking a card's label chip opens the issue's label menu ("Change or add labels…", Workspace labels) beside the
// chip; the card does not open. Picking a label in that menu changes the issue, still without opening it.
test("a card's label chip opens the label picker beside it, not the issue", async ({ open }) => {
  const page = await open();
  const chip = '[data-key] [aria-label^="Labels on "]';
  await page.waitFor(`!!document.querySelector('${chip}')`);
  const key = await page.eval<string>(`document.querySelector('${chip}').closest("[data-key]").dataset.key`);
  const labels = () => page.eval<string[]>(`[...document.querySelectorAll('[data-key="${key}"] [aria-label^="Labels on "]')].map(b=>b.textContent)`);
  const before = await labels();
  const url = await page.eval<string>("location.href");
  await page.click(chip);
  const menu = `[role="dialog"][aria-label="Change labels"]`;
  await page.waitFor(`!!document.querySelector('${menu}')`);
  expect(await page.eval(`document.activeElement.placeholder`)).toBe("Change or add labels…");
  expect(await page.eval("location.href")).toBe(url);
  // Pick a label that isn't on the issue: Enter in the menu must not open the card either.
  await page.key("ArrowDown");
  await page.key("Enter");
  const list = `[...document.querySelectorAll('[data-key="${key}"] [aria-label^="Labels on "]')].map(b=>b.textContent).join()`;
  await page.waitFor(`${list}!==${JSON.stringify(before.join())}`);
  await page.key("Escape");
  await page.waitFor(`!document.querySelector('${menu}')`);
  expect(await page.eval("location.href")).toBe(url);
  expect(await labels()).not.toEqual(before);
});

// Linear's ViewOptions panel in its popover (startup-root.CnUSfl4j.js `qxr`, `sq`, `gw`, `gy`; ViewOptions.2m5-Tfth.js `Y`),
// every value read from live linear.app with getComputedStyle, 2026-11-13 (.raj/qa/display-menu.md). The popover is
// Linear's elevated theme, so each control inside paints elevated tokens; a Select's list elevates once more in dark.
const DISPLAY = '[role=dialog][aria-label="Display options"]';
const LINEAR_DISPLAY = {
  dark: {
    surface: { bg: "lch(12.72 0.85 272)", border: "lch(25.68 1.93 272)", shadow: "lch(0 0 0 / 0.125) 0px 3px 8px 0px, lch(0 0 0 / 0.125) 0px 2px 5px 0px, lch(0 0 0 / 0.125) 0px 1px 1px 0px" },
    divider: "lch(20.28 1.93 272)",
    tab: { off: ["lch(17.349 1.043 272)", "lch(64.714 1.425 272)"], hover: ["lch(21.206 1.043 272)", "lch(91.178 1.425 272)"], on: ["lch(23.906 1.429 272)", "lch(100 0 272)"] },
    label: "lch(64.714 1.425 272)",
    heading: "lch(91.178 1.425 272)",
    select: { rest: ["lch(17.349 1.139 272)", "lch(91.178 1.425 272)"], hover: ["lch(21.977 1.525 272)", "lch(100 0 272)"] },
    // gw: mix(bgBase, labelBase, .2 / .3) in linear sRGB = lch(48.247) / lch(56.807) live.
    switch: { off: "color(srgb-linear 0.168276 0.169979 0.174897)", hover: "color(srgb-linear 0.244973 0.247373 0.254295)", on: "lch(47.918 59.303 288.421)" },
    chip: { on: ["lch(25.834 1.525 272)", "lch(100 0 272)"], off: ["lch(17.349 1.043 272)", "lch(64.714 1.425 272)"], hover: ["lch(21.206 1.043 272)", "lch(91.178 1.425 272)"] },
    footer: { border: "lch(21.36 1.93 272)", link: "lch(60.303 70 288.421)" },
    list: { bg: "lch(16.432 1.3 272)", ring: "lch(38.032 2.38 272) 0px 0px 0px 0.5px", highlight: "lch(25.689 1.975 272)", check: "lch(66.215 1.65 272)" },
  },
  light: {
    surface: { bg: "lch(100 0 282)", border: "lch(91.9 0 282)", shadow: "lch(0 0 0 / 0.02) 0px 6px 18px 0px, lch(0 0 0 / 0.04) 0px 3px 9px 0px, lch(0 0 0 / 0.04) 0px 1px 1px 0px" },
    divider: "lch(91.9 0 282)",
    tab: { off: ["lch(100 0 282)", "lch(40 1 282)"], hover: ["lch(96.914 0 282)", "lch(20 1 282)"], on: ["lch(95.543 0 282)", "lch(10 0 282)"] },
    label: "lch(40 1 282)",
    heading: "lch(20 1 282)",
    select: { rest: ["lch(100 0 282)", "lch(20 1 282)"], hover: ["lch(95.886 0 282)", "lch(10 0 282)"] },
    // .4 / .5 in light = lch(82.484) / lch(76.978) live.
    switch: { off: "color(srgb-linear 0.611684 0.61201 0.612628)", hover: "color(srgb-linear 0.51468 0.514978 0.515784)", on: "lch(53 52.26 286.91)" },
    chip: { on: ["lch(94.857 0 282)", "lch(10 0 282)"], off: ["lch(100 0 282)", "lch(40 1 282)"], hover: ["lch(96.914 0 282)", "lch(20 1 282)"] },
    footer: { border: "lch(90.55 0 282)", link: "lch(45 70 286.91)" },
    list: { bg: "lch(100 0 282)", ring: "lch(86.5 0 282) 0px 0px 0px 0.5px", highlight: "lch(95.886 0 282)", check: "lch(40 1 282)" },
  },
} as const;
const paint = (selector: string, pseudo = "") =>
  `(()=>{const n=document.querySelector(${JSON.stringify(selector)}),s=getComputedStyle(n${pseudo && `,${JSON.stringify(pseudo)}`});return [s.backgroundColor,s.color]})()`;

for (const scheme of ["dark", "light"] as const) {
  test(`Display options is Linear's ViewOptions popover, state for state (${scheme})`, async ({ open }) => {
    const page = await open();
    await page.page.emulateMedia({ colorScheme: scheme });
    const L = LINEAR_DISPLAY[scheme];
    const hover = async (selector: string) => {
      await page.page.hover(selector);
      await page.page.waitForTimeout(300); // past the 0.15s colour transitions
    };
    await page.click('[aria-label="Display options"]');
    await page.waitFor(`!!document.querySelector('${DISPLAY} .ui-vo-select')`);
    await test.step("the popover: Y's elevated bgBase, bgBorderThin border, radius 12, shadowMedium, 300 inside", async () => {
      const s = await page.eval<Record<string, unknown>>(
        `(()=>{const p=document.querySelector('${DISPLAY}'),s=getComputedStyle(p);return {width:p.clientWidth,bg:s.backgroundColor,border:s.borderTopColor,radius:s.borderRadius,shadow:s.boxShadow.split(/,(?![^(]*\\))/).map(x=>x.trim()).filter(x=>!x.startsWith("rgba(0, 0, 0, 0)")).join(", "),paddingTop:s.paddingTop}})()`,
      );
      expect(s).toEqual({ width: 300, bg: L.surface.bg, border: L.surface.border, radius: "12px", shadow: L.surface.shadow, paddingTop: "8px" });
    });
    await test.step("sections: 8px 16px, divided by bgBorderFaintThin, the first undivided", async () => {
      expect(
        await page.eval(
          `[...document.querySelectorAll('${DISPLAY} .ui-vo-content')].map(n=>{const s=getComputedStyle(n);return [s.padding,s.borderTopStyle,s.borderTopColor]}).slice(0,2)`,
        ),
      ).toEqual([
        ["8px 16px", "none", expect.any(String)],
        ["8px 16px", "solid", L.divider],
      ]);
    });
    await test.step("layout tabs: sq fullWidth, 137 x 28 each on a bgBase track, tertiary off / hover / selected", async () => {
      expect(
        await page.eval(
          `(()=>{const l=document.querySelector('${DISPLAY} [role=tablist]');return [getComputedStyle(l).backgroundColor,getComputedStyle(l).borderRadius,...[...l.children].map(t=>[t.getBoundingClientRect().width,t.getBoundingClientRect().height])]})()`,
        ),
      ).toEqual([L.surface.bg, "5px", [137, 28], [137, 28]]);
      expect(await page.eval(paint(`${DISPLAY} [role=tab][aria-selected=false]`))).toEqual(L.tab.off);
      expect(await page.eval(paint(`${DISPLAY} [role=tab][aria-selected=true]`))).toEqual(L.tab.on);
      await hover(`${DISPLAY} [role=tab][aria-selected=false]`);
      expect(await page.eval(paint(`${DISPLAY} [role=tab][aria-selected=false]`))).toEqual(L.tab.hover);
    });
    await test.step("rows: 32px, miniPlus labelMuted labels on one line, a labelBase section heading", async () => {
      expect(
        await page.eval(
          `(()=>{const r=document.querySelector('${DISPLAY} .ui-vo-row'),l=r.querySelector('.ui-vo-label'),s=getComputedStyle(l),h=getComputedStyle(document.querySelector('${DISPLAY} .ui-vo-section-label'));return [getComputedStyle(r).minHeight,s.fontSize,s.fontWeight,s.color,s.whiteSpace,h.color,h.fontWeight,h.marginTop,h.marginBottom]})()`,
        ),
      ).toEqual(["32px", "12px", "500", L.label, "nowrap", L.heading, "500", "8px", "2px"]);
    });
    await test.step("selects: Rxr's 160 x 24 controlSecondary field, controlSecondaryHover + labelTitle on hover", async () => {
      expect(
        await page.eval(
          `[...document.querySelectorAll('${DISPLAY} .ui-vo-select')].map(n=>[n.getBoundingClientRect().width,n.getBoundingClientRect().height])`,
        ),
      ).toEqual(Array.from({ length: 5 }, () => [160, 24]));
      expect(await page.eval(paint(`${DISPLAY} .ui-vo-select`))).toEqual(L.select.rest);
      await hover(`${DISPLAY} .ui-vo-select`);
      expect(await page.eval(paint(`${DISPLAY} .ui-vo-select`))).toEqual(L.select.hover);
    });
    await test.step("switches: gw's track mixed in linear sRGB over the elevated bgBase", async () => {
      const track = (state: string) =>
        page.eval(`getComputedStyle(document.querySelector('${DISPLAY} [role=switch]${state}')).backgroundColor`);
      expect(await track(":checked")).toBe(L.switch.on);
      expect(await track(":not(:checked)")).toBe(L.switch.off);
      await hover(`${DISPLAY} [role=switch]:not(:checked)`);
      expect(await track(":not(:checked)")).toBe(L.switch.hover);
    });
    await test.step("property chips: Nxr tab/small, controlSecondarySelected when on, tertiary hover when off; a click keeps the popover", async () => {
      const on = `${DISPLAY} .ui-vo-chip[aria-pressed=true]`,
        off = `${DISPLAY} .ui-vo-chip[aria-pressed=false]`;
      expect(await page.eval(paint(on))).toEqual(L.chip.on);
      expect(await page.eval(paint(off))).toEqual(L.chip.off);
      await hover(on);
      expect(await page.eval(paint(on))).toEqual(L.chip.on);
      await hover(off);
      expect(await page.eval(paint(off))).toEqual(L.chip.hover);
      const name = await page.eval<string>(`document.querySelector('${off}').textContent`);
      await page.click(off);
      await page.waitFor(
        `[...document.querySelectorAll('${DISPLAY} .ui-vo-chip')].find(n=>n.textContent===${JSON.stringify(name)})?.getAttribute('aria-pressed')==='true'`,
      );
    });
    await test.step("the footer shows only while the display differs from its default: bgBorder line, Reset, a labelLink save", async () => {
      // The chip pressed above leaves a changed display.
      await page.waitFor(`!!document.querySelector('${DISPLAY} .ui-vo-footer')`);
      await page.page.waitForTimeout(300); // GS's collapse opens it
      expect(
        await page.eval(
          `(()=>{const f=document.querySelector('${DISPLAY} .ui-vo-footer'),s=getComputedStyle(f);return [f.getBoundingClientRect().height,s.borderTopColor,Math.round(f.getBoundingClientRect().right-f.lastElementChild.getBoundingClientRect().right),[...f.querySelectorAll('button')].map(b=>[b.dataset.variant,b.textContent]),getComputedStyle(f.querySelector('.ui-vo-footer-link')).color]})()`,
        ),
      ).toEqual([36, L.footer.border, 8, [["borderless", "Reset"], ["borderless", "Save my default"]], L.footer.link]);
      await page.eval(`[...document.querySelectorAll('${DISPLAY} .ui-vo-footer button')].find(b=>b.textContent==="Reset").click()`);
      await page.waitFor(`!document.querySelector('${DISPLAY} .ui-vo-footer')`);
    });
    await test.step("a select's list: gy, one elevation up, 24px rows, end-aligned 5px below; Escape closes only the list", async () => {
      await page.click(`${DISPLAY} .ui-vo-select`);
      await page.waitFor(`!!document.querySelector('[data-surface=select] [cmdk-item][data-selected=true]')`);
      expect(
        await page.eval(
          `(()=>{const s=document.querySelector('[data-surface=select]'),row=s.querySelector('[cmdk-item][data-selected=true]'),t=document.querySelector('${DISPLAY} .ui-vo-select').getBoundingClientRect(),b=s.getBoundingClientRect();return {bg:getComputedStyle(s).backgroundColor,ring:getComputedStyle(s).boxShadow.split(/,(?![^(]*\\))/)[0],height:row.getBoundingClientRect().height,font:getComputedStyle(row).fontSize,padding:getComputedStyle(row).padding,highlight:getComputedStyle(row,'::before').backgroundColor,inset:getComputedStyle(row,'::before').left,check:getComputedStyle(s.querySelector('.menu-checkmark')).color,right:Math.round(t.right-b.right),top:Math.round(b.top-t.bottom)}})()`,
        ),
      ).toEqual({ bg: L.list.bg, ring: L.list.ring, height: 24, font: "12px", padding: "0px 35px 0px 12px", highlight: L.list.highlight, inset: "4px", check: L.list.check, right: 0, top: 5 });
      await page.key("Escape");
      await page.waitFor(`!document.querySelector('[data-surface=select]')`);
      expect(await page.eval(`!!document.querySelector('${DISPLAY}')`)).toBe(true);
      expect(await page.eval(`document.activeElement?.classList.contains('ui-vo-select')`)).toBe(true);
    });
  });
}

// Review fixes on the ViewOptions popover (dark, where Linear's levels differ). Values: live linear.app theme objects
// and computed styles, 2026-11-13 (.raj/qa/display-menu.md "Review fixes").
const DARK = LINEAR_DISPLAY.dark;
const RING = "lch(100 0 0 / 0.148) 0px 0px 0px 0.5px"; // menu theme bgBorderAlphaThin
const SOLID_RING = "lch(100 0 0 / 0.247) 0px 0px 0px 0.5px"; // menu theme bgBorderSolidAlphaThin
const SHADOW_LOW = "lch(0 0 0 / 0.3) 0px 0.5px 1px 1px";
/** A popup's shell, compared with the board's Display options popover. */
const shell = (selector: string) =>
  `(()=>{const p=document.querySelector(${JSON.stringify(selector)}),s=getComputedStyle(p);return {width:p.clientWidth,bg:s.backgroundColor,border:s.borderTopColor,borderStyle:s.borderTopStyle,radius:s.borderRadius,shadow:s.boxShadow.split(/,(?![^(]*\\))/).map(x=>x.trim()).filter(x=>!x.startsWith("rgba(0, 0, 0, 0)")).join(", "),paddingTop:s.paddingTop}})()`;
const SHELL = { width: 300, bg: DARK.surface.bg, border: DARK.surface.border, borderStyle: "solid", radius: "12px", shadow: DARK.surface.shadow, paddingTop: "8px" };

test("Display options in list layout: Linear's list rows, its tab, chip and select rings, and Group ordering's state", async ({ open }) => {
  const page = await open();
  await page.page.emulateMedia({ colorScheme: "dark" });
  await show(page, { 1: { display: { layout: "list" } } });
  await page.click('[aria-label="Display options"]');
  await page.waitFor(`!!document.querySelector('${DISPLAY} .ui-vo-select')`);
  await test.step("list rows: Grouping, Sub-grouping, Nested sub-issues and Show empty groups are 32px rows of labelMuted labels", async () => {
    expect(
      await page.eval(
        `[...document.querySelectorAll('${DISPLAY} .ui-vo-row')].map(r=>{const l=r.querySelector('.ui-vo-label'),c=r.querySelector('.ui-vo-select,[role=switch]');return [l.textContent,r.getBoundingClientRect().height,getComputedStyle(l).color,c.matches('.ui-vo-select')?[c.getBoundingClientRect().width,c.getBoundingClientRect().height]:'switch']}).filter(([name])=>["Grouping","Sub-grouping","Nested sub-issues","Show empty groups"].includes(name))`,
      ),
    ).toEqual([
      ["Grouping", 32, DARK.label, [160, 24]],
      ["Sub-grouping", 32, DARK.label, [160, 24]],
      ["Nested sub-issues", 32, DARK.label, [160, 24]],
      ["Show empty groups", 32, DARK.label, "switch"],
    ]);
    expect(await page.eval(`document.querySelector('${DISPLAY} .ui-vo-section-label').textContent`)).toBe("List options");
  });
  await test.step("rings: options tabs, chips and select triggers ring with the popover's elevated alphas", async () => {
    expect(
      await page.eval(
        `(()=>{const q=s=>getComputedStyle(document.querySelector('${DISPLAY} '+s)).boxShadow;return {tabOff:q('[role=tab][aria-selected=false]'),tabOn:q('[role=tab][aria-selected=true]'),chipOff:q('.ui-vo-chip[aria-pressed=false]'),chipOn:q('.ui-vo-chip[aria-pressed=true]'),select:getComputedStyle(document.querySelector('${DISPLAY} .ui-vo-select'),'::after').boxShadow}})()`,
      ),
    ).toEqual({
      tabOff: `${RING}, ${SHADOW_LOW}`,
      tabOn: SOLID_RING,
      chipOff: `${RING}, ${SHADOW_LOW}`,
      chipOn: RING,
      select: `${RING}, ${SHADOW_LOW}`,
    });
  });
  await test.step("Group ordering: Linear's label and fixed glyph; reversed groups show as pressed", async () => {
    const button = `${DISPLAY} [aria-label="Group ordering"]`;
    expect(await page.eval(`document.querySelector('${button}').getAttribute('aria-pressed')`)).toBe("false");
    await page.click(button);
    await page.waitFor(`document.querySelector('${button}').getAttribute('aria-pressed')==="true"`);
    // jv's pressed fill: the popover's bgFocus.
    expect(await page.eval(`getComputedStyle(document.querySelector('${button}')).backgroundColor`)).toBe("lch(20.82 1.3 272)");
    await page.click(button);
    await page.waitFor(`document.querySelector('${button}').getAttribute('aria-pressed')==="false"`);
  });
});

test("every ViewOptions panel opens in the same popover: inbox and sub-issue display options match the board's", async ({ open }) => {
  const page = await open("?inbox=1");
  await page.page.emulateMedia({ colorScheme: "dark" });
  await page.click('#inbox-display');
  await page.waitFor(`!!document.querySelector('${DISPLAY} .ui-vo-row')`);
  expect(await page.eval(shell(DISPLAY))).toEqual(SHELL);
  // Linear's list pane with a right slot opens it under the button's start edge.
  const [trigger, popup] = [await page.rect("#inbox-display"), await page.rect(DISPLAY)];
  expect(Math.round(popup.x - trigger.x)).toBe(0);
  expect(popup.y).toBe(Math.round(trigger.y + trigger.height + 4));
  await page.key("Escape");
  await page.waitFor(`!document.querySelector('${DISPLAY}')`);

  // TEST-3 becomes TEST-2's sub-issue, so its Sub-issues section renders.
  const child = `const read=fetch;window.fetch=async(...args)=>{const response=await read(...args);if(new URL(String(args[0]),location.href).pathname!=='/api/issues')return response;const issues=await response.json();issues.find(i=>i.key==='TEST-3').parent='TEST-2';return Response.json(issues)}`;
  const issue = await open("?issue=TEST-2&view=page", { setup: child });
  await issue.page.emulateMedia({ colorScheme: "dark" });
  const SUB = '[role=dialog][aria-label="Sub-issue display options"]';
  await issue.click('[aria-label="Sub-issue display options"]');
  await issue.waitFor(`!!document.querySelector('${SUB} .ui-vo-row')`);
  expect(await issue.eval(shell(SUB))).toEqual(SHELL);
  expect(await issue.eval(`document.querySelector('[aria-label="Sub-issue display options"]').getAttribute('aria-expanded')`)).toBe("true");
});

test("popup elevation: a Select lists one level up, a menu or submenu over another surface stays at the menu theme", async ({ open }) => {
  const page = await open();
  await page.page.emulateMedia({ colorScheme: "dark" });
  await test.step("Advanced filter's medium Select lists at level 2 with gy's 30px medium rows", async () => {
    await page.eval(`machines.ui.send({type:"toolbar.open",toolbar:"advanced"})`);
    await page.waitFor(`!!document.querySelector('[aria-label="Advanced filter"] .ui-select[data-size=medium]')`);
    await page.click('[aria-label="Advanced filter"] .ui-select[data-size=medium]');
    await page.waitFor(`!!document.querySelector('[data-surface=select] [cmdk-item]')`);
    expect(
      await page.eval(
        `(()=>{const s=document.querySelector('[data-surface=select]'),row=s.querySelector('[cmdk-item]:not([data-selected=true])');return [s.dataset.elevation,getComputedStyle(s).backgroundColor,getComputedStyle(row).color,row.getBoundingClientRect().height,getComputedStyle(row).fontSize]})()`,
      ),
    ).toEqual(["2", DARK.list.bg, "lch(91.554 1.65 272)", 30, "12px"]);
    await page.key("Escape");
    await page.key("Escape");
  });
  await test.step("Create issue's More actions, a menu inside a dialog, paints the level-1 menu theme as Linear's does", async () => {
    await page.key("c");
    await page.click('[role=dialog][aria-label="Create issue"] [aria-label="More actions"]');
    const MORE = '[role=dialog][aria-label="More actions"]';
    await page.waitFor(`!!document.querySelector('${MORE} [cmdk-item]')`);
    expect(
      await page.eval(
        `(()=>{const s=document.querySelector('${MORE}');return [s.dataset.elevation,getComputedStyle(s).backgroundColor,getComputedStyle(s.querySelector('[cmdk-item]:not([data-selected=true])')).color]})()`,
      ),
    ).toEqual(["1", DARK.surface.bg, "lch(91.178 1.425 272)"]);
    await page.key("Escape");
  });
  await test.step("a menu opened from a menu, and its submenu, paint the level-1 menu theme (Linear: 12.72, labelBase 91.178)", async () => {
    const p = await open("?issue=TEST-2&view=page");
    await p.page.emulateMedia({ colorScheme: "dark" });
    await p.hover("#summary");
    await p.eval("document.activeElement?.blur()");
    await p.keys("mr");
    await p.type("TEST-1");
    await p.waitFor(`document.querySelector('[cmdk-item][data-selected=true]')?.dataset.value==="TEST-1"`);
    await p.key("Enter", "alt");
    const MORE = '[role="dialog"][aria-label="More actions"]';
    await p.waitFor(`!!document.querySelector('${MORE}')`);
    const paintOf = (selector: string) =>
      `(()=>{const s=document.querySelector(${JSON.stringify(selector)});return [s.closest('[data-elevation]').dataset.elevation,getComputedStyle(s).backgroundColor,getComputedStyle(s.querySelector('[cmdk-item]:not([data-selected=true])')).color]})()`;
    expect(await p.eval(paintOf(MORE))).toEqual(["1", DARK.surface.bg, "lch(91.178 1.425 272)"]);
    const row = await p.eval<string>(`document.querySelector('${MORE} [cmdk-item][aria-haspopup]')?.dataset.value ?? ""`);
    expect(row).not.toBe("");
    await p.hover(`${MORE} [cmdk-item][data-value=${JSON.stringify(row)}]`);
    const id = await p.waitFor<string>(`document.querySelector('${MORE} [cmdk-item][aria-expanded=true]')?.getAttribute('aria-controls')`);
    const SUBMENU = `[id="${id}"] [cmdk-root]`;
    await p.waitFor(`!!document.querySelector(${JSON.stringify(SUBMENU)})?.querySelector('[cmdk-item]')`);
    expect(await p.eval(paintOf(SUBMENU))).toEqual(["1", DARK.surface.bg, "lch(91.178 1.425 272)"]);
  });
});
