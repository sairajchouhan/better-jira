import { expect, fixture, test, sleep, type App } from "./app";

/** Regressions for action menus (action-menu.tsx and Issue options): one test per audit finding, each fails with its fix removed. */

const dialog = (label: string) => `[role=dialog][aria-label="${label}"]`;
const MENU = dialog("Issue options");
const CARD = '[data-key="TEST-2"]';
const exists = (selector: string) => `!!document.querySelector(${JSON.stringify(selector)})`;
const gone = (selector: string) => `!document.querySelector(${JSON.stringify(selector)})`;
const selected = (page: App, scope: string) =>
  page.eval<string>(`document.querySelector('${scope} [cmdk-item][data-selected=true]')?.dataset.value ?? ""`);
const pristine = (scope: string) => `!!document.querySelector('${scope} [cmdk-root]')?.hasAttribute("data-pristine")`;

/** A writable site faked in the page, so edits apply and land in `window.__ops`. */
const writable = `(()=>{const real=fetch;window.__ops=[];
window.fetch=async(input,init)=>{const path=new URL(String(input),location.href).pathname;
 if(path==='/api/client'){const client=await (await real(input,init)).json();return Response.json({...client,writable:true});}
 const m=path.match(/^\\/api\\/issues\\/([^/]+)\\/ops$/);if(!m)return real(input,init);
 window.__ops.push({key:m[1],ops:JSON.parse(init.body).ops});
 return Response.json({key:m[1],created:{},others:[]});
};})()`;

async function rightClick(page: App, selector = CARD) {
  const r = await page.rect(selector);
  const at = { x: r.x + r.width / 2, y: r.y + r.height / 2 };
  await page.page.mouse.click(at.x, at.y, { button: "right" });
  await page.waitFor(exists(MENU));
  return at;
}
/** Opens Issue options on TEST-2 from the pointer, then walks to the root row `n` (1-based) and into its submenu by keyboard. */
async function intoSubmenu(page: App, n: number, label: string) {
  await rightClick(page);
  for (let i = 0; i < n; i++) await page.key("ArrowDown");
  await page.key("ArrowRight");
  await page.waitFor(`!!document.activeElement?.closest('${dialog(label)}')`);
}

test("ISSUE-1 / ISSUE-13: Issue options › Labels is the L picker's checkbox rows; a checkbox or Space keeps the menu open", async ({
  open,
}) => {
  const page = await open("", { setup: writable });
  const LABELS = dialog("Labels");
  await rightClick(page);
  await page.hover(`${MENU} [cmdk-item][data-value="Labels"]`);
  await page.waitFor(exists(LABELS));
  // The issue's own label first, checked, then the workspace's, each with a leading checkbox (the L picker's rows).
  expect(
    await page.eval(
      `[...document.querySelectorAll('${LABELS} [data-label]')].map(n=>[n.dataset.label,n.querySelector('input.menu-checkbox')?.checked])`,
    ),
  ).toEqual(expect.arrayContaining([["test", true], ["ui", false]]));
  await page.click(`${LABELS} [aria-label="Add label ui"]`);
  await page.waitFor(`window.__ops.some(w=>w.key==='TEST-2'&&JSON.stringify(w.ops).includes('"ui"'))`);
  // Still open, and the checkbox follows the issue. The edit adds no row under the pointer (Restore mirrored Jira version), so the
  // hover stays on Labels.
  await page.waitFor(exists(`${LABELS} [aria-label="Remove label ui"]`));
  await sleep(300);
  expect(await page.eval(exists(LABELS))).toBe(true);
  // ISSUE-13: Space on the highlighted row toggles it in place; the search stays empty. The pointer rests on the search, which
  // stays put as typing narrows the rows below it.
  await page.hover(`${LABELS} input:not(.menu-checkbox)`);
  await page.page.focus(`${LABELS} input:not(.menu-checkbox)`);
  await page.key("ArrowDown");
  expect(await selected(page, LABELS)).not.toBe("");
  await page.key(" ");
  await page.waitFor(`window.__ops.length >= 2`);
  expect(await page.eval(exists(LABELS))).toBe(true);
  expect(await page.eval(`document.querySelector('${LABELS} input:not(.menu-checkbox)').value`)).toBe("");
  // A new name offers Linear's "Create new label".
  await page.type("fresh one");
  await page.waitFor(exists(`${LABELS} [cmdk-item][data-value="Create fresh one"]`));
  expect(await page.eval(`document.querySelector('${LABELS} [cmdk-item][data-value="Create fresh one"]').textContent`)).toBe(
    'Create new label: "fresh-one"',
  );
});

test("k3e: Issue options › Labels is as wide as the labels on screen, 400px at most for the whole row, and never shrinks", async ({
  open,
}) => {
  // A board with hundreds of short labels and one very long one at the very end, far below the window (made-up names).
  const long = `zz-${"very-long-made-up-label-".repeat(8)}end`;
  const labels = [...Array.from({ length: 300 }, (_, i) => `label-${String(i).padStart(3, "0")}`), long];
  await fixture.reset({ catalog: { priorities: [], labels, users: [] } });
  const page = await open("", { setup: writable, height: 800 });
  const LABELS = dialog("Labels");
  const width = (selector: string) => page.eval<number>(`document.querySelector('${selector}').getBoundingClientRect().width`);
  await rightClick(page);
  await page.hover(`${MENU} [cmdk-item][data-value="Labels"]`);
  await page.waitFor(exists(`${LABELS} [data-label="${long}"]`));
  await sleep(200); // past k3e's 150ms trailing measure
  // Every label is listed, but only the rows on screen (and ten past them) size the menu: the long label far down doesn't.
  const opened = await width(LABELS);
  expect(opened).toBeGreaterThanOrEqual(175);
  expect(opened).toBeLessThan(260);
  // A search that lists the long label grows the menu to Vw.ITEM_MAX_WIDTH for the whole row, the label truncated inside it.
  await page.page.focus(`${LABELS} input:not(.menu-checkbox)`);
  await page.type("zz-very");
  await page.waitFor(`document.querySelectorAll('${LABELS} [data-label]').length === 1`);
  await sleep(200);
  expect(await width(LABELS)).toBeCloseTo(400, 0);
  expect(await width(`${LABELS} [data-label="${long}"]`)).toBeLessThanOrEqual(400);
  expect(
    await page.eval(`(()=>{const n=document.querySelector('${LABELS} [data-label="${long}"] .menu-name');return n.scrollWidth>n.clientWidth})()`),
  ).toBe(true);
  // Clearing the search brings the short labels back; the menu keeps its width while open.
  await page.page.fill(`${LABELS} input:not(.menu-checkbox)`, "");
  await page.waitFor(`document.querySelectorAll('${LABELS} [data-label]').length > 100`);
  await sleep(200);
  expect(await width(LABELS)).toBeCloseTo(400, 0);
});

/** The list of the menu in `scope` (its own, not a submenu's) and the boxes _3e sizes: the popup, its search and its list. */
const heightOf = (page: App, scope: string) =>
  page.eval<{ popup: DOMRect; input: DOMRect; list: DOMRect; scrolls: boolean; popupScrolls: boolean; lastShown: number }>(
    `(()=>{const d=document.querySelector('${scope}'),root=d.querySelector('[cmdk-root]'),l=[...root.querySelectorAll('[cmdk-list]')].find(n=>n.closest('[cmdk-root]')===root),
      lb=l.getBoundingClientRect(),rows=[...l.querySelectorAll('[cmdk-item]')].map(n=>n.getBoundingClientRect()).filter(r=>r.bottom>lb.top&&r.top<lb.bottom),last=rows.at(-1);
      return {popup:d.getBoundingClientRect().toJSON(),input:root.querySelector('.menu-input').getBoundingClientRect().toJSON(),list:lb.toJSON(),
        scrolls:l.scrollHeight>l.clientHeight,popupScrolls:d.scrollHeight>d.clientHeight+1,lastShown:last?(Math.min(last.bottom,lb.bottom)-last.top)/last.height:1}})()`,
  );

test("_3e: Issue options › Labels on a 1044-label board stays 16px inside the window, its search fixed and its list scrolling", async ({
  open,
}) => {
  // Made-up names in the shape of a large Jira site's labels, one very long one last (k3e must still see it once scrolled to).
  const long = `zz-${"very-long-made-up-label-".repeat(8)}end`;
  const labels = [...Array.from({ length: 1043 }, (_, i) => `label-${String(i).padStart(4, "0")}`), long];
  await fixture.reset({ catalog: { priorities: [], labels, users: [] } });
  const page = await open("", { setup: writable, width: 1440, height: 969 });
  const LABELS = dialog("Labels");
  await rightClick(page);
  await page.hover(`${MENU} [cmdk-item][data-value="Labels"]`);
  await page.waitFor(exists(`${LABELS} [data-label="${long}"]`));
  await sleep(200);
  const opened = await heightOf(page, LABELS);
  // Linear's _3e: the window less Vw.VIEWPORT_PADDING (16) each end at most, and S3e keeps it 10px inside the window.
  expect(opened.popup.height).toBeLessThanOrEqual(969 - 32 + 1);
  expect(opened.popup.top).toBeGreaterThanOrEqual(10 - 0.5);
  expect(opened.popup.bottom).toBeLessThanOrEqual(969 - 10 + 0.5);
  // Only the list scrolls, cut where the last row in view shows at least 55% of itself (v3e).
  expect(opened.scrolls).toBe(true);
  expect(opened.popupScrolls).toBe(false);
  expect(opened.lastShown).toBeGreaterThanOrEqual(0.55);
  expect(opened.input.top).toBeGreaterThanOrEqual(opened.popup.top);
  // Scrolled to its end, the search stays where it was, the long label is reachable, and k3e grows the menu to fit it (400px).
  const width = await page.eval<number>(`document.querySelector('${LABELS}').getBoundingClientRect().width`);
  expect(width).toBeLessThan(260);
  await page.eval(
    `(()=>{const root=document.querySelector('${LABELS} [cmdk-root]');[...root.querySelectorAll('[cmdk-list]')].find(n=>n.closest('[cmdk-root]')===root).scrollTop=1e9})()`,
  );
  await sleep(200);
  const scrolled = await heightOf(page, LABELS);
  expect(scrolled.input.top).toBeCloseTo(opened.input.top, 0);
  expect(await page.eval(`(()=>{const r=document.querySelector('${LABELS} [data-label="${long}"]').getBoundingClientRect(),l=document.querySelector('${LABELS} [cmdk-list]').getBoundingClientRect();return r.top>=l.top&&r.bottom<=l.bottom})()`)).toBe(true);
  expect(await page.eval<number>(`document.querySelector('${LABELS}').getBoundingClientRect().width`)).toBeCloseTo(400, 0);
  await page.key("Escape");
});

test("_3e: a submenu's keyboard highlight scrolls into view with ITEM_SCROLL_MARGIN (24px) of rows past it", async ({ open }) => {
  const labels = Array.from({ length: 200 }, (_, i) => `label-${String(i).padStart(3, "0")}`);
  await fixture.reset({ catalog: { priorities: [], labels, users: [] } });
  const page = await open("", { setup: writable, width: 1440, height: 600 });
  const LABELS = dialog("Labels");
  await rightClick(page);
  await page.hover(`${MENU} [cmdk-item][data-value="Labels"]`);
  await page.waitFor(exists(`${LABELS} [data-label="label-199"]`));
  await page.page.focus(`${LABELS} input:not(.menu-checkbox)`);
  const rows = Math.ceil((await heightOf(page, LABELS)).list.height / 32) + 3;
  for (let i = 0; i < rows; i++) await page.key("ArrowDown");
  await sleep(100);
  const gap = await page.eval<number>(
    `(()=>{const l=document.querySelector('${LABELS} [cmdk-list]').getBoundingClientRect(),r=document.querySelector('${LABELS} [cmdk-item][data-selected=true]').getBoundingClientRect();return l.bottom-r.bottom})()`,
  );
  expect(gap).toBeGreaterThanOrEqual(24 - 1);
  expect(gap).toBeLessThanOrEqual(24 + 32);
  await page.key("Escape");
});

test("_3e: a picker taller than its room keeps its search and scrolls its list, and grows back with the window", async ({ open }) => {
  const labels = Array.from({ length: 300 }, (_, i) => `label-${String(i).padStart(3, "0")}`);
  await fixture.reset({ catalog: { priorities: [], labels, users: [] } });
  const page = await open("?issue=TEST-2&view=page", { setup: writable, width: 1440, height: 300 });
  const PICKER = dialog("Change labels");
  await page.waitFor(exists("#prop-labels"));
  await page.clickAt(5, 200);
  await page.key("l");
  await page.waitFor(exists(`${PICKER} .menu`));
  await sleep(100);
  const small = await heightOf(page, PICKER);
  expect(small.scrolls).toBe(true);
  expect(small.popupScrolls).toBe(false);
  expect(small.popup.bottom).toBeLessThanOrEqual(300);
  expect(small.lastShown).toBeGreaterThanOrEqual(0.55);
  // A taller window gives the list its room back (the popup's cap comes from the window, not from the cut menu).
  await page.page.setViewportSize({ width: 1440, height: 900 });
  await sleep(200);
  const tall = await heightOf(page, PICKER);
  expect(tall.list.height).toBeGreaterThan(small.list.height + 100);
  expect(tall.popupScrolls).toBe(false);
  await page.key("Escape");
});

test("CORE-7: the inbox filter's values are checkbox rows that keep the menu open", async ({ open }) => {
  const page = await open();
  await page.click("nav a:has([data-inbox-badge])");
  await page.waitFor(`document.querySelectorAll('[data-inbox-row]').length === 7`);
  await page.click("#inbox-filter");
  await page.hover(`${dialog("Filter")} [cmdk-item][data-value="Notification type"]`);
  const TYPE = dialog("Notification type");
  await page.waitFor(exists(`${TYPE} [cmdk-item][data-value="Mentions"] input.menu-checkbox`));
  await page.click(`${TYPE} [aria-label="Add Mentions"]`);
  await page.waitFor(`document.querySelectorAll('[data-inbox-row]').length === 1`);
  expect(await page.eval(exists(TYPE))).toBe(true);
  await page.waitFor(`document.querySelector('${TYPE} [aria-label="Remove Mentions"]')?.checked === true`);
});

test("ISSUE-2 / ISSUE-4 / ISSUE-5: a property submenu shows its search with Linear's placeholder, starts on the current value, and digits pick", async ({
  open,
}) => {
  const page = await open("", { setup: writable });
  const PRIORITY = dialog("Priority");
  await intoSubmenu(page, 2, "Priority");
  const input = await page.eval<[string, boolean]>(
    `(i=>[i.placeholder,!!i.closest(".sr-only")])(document.querySelector('${PRIORITY} input:not(.menu-checkbox)'))`,
  );
  expect(input[0]).toMatch(/^(Set|Change) priority to…$/);
  expect(input[1]).toBe(false);
  // Keyboard-opened, the highlight starts on the issue's priority (the checked row), not the first row.
  const current = await page.eval<string>(
    `document.querySelector('${PRIORITY} [cmdk-item]:has(.menu-checkmark)')?.dataset.value ?? ""`,
  );
  expect(current).not.toBe("");
  expect(await selected(page, PRIORITY)).toBe(current);
  expect(await page.eval(pristine(PRIORITY))).toBe(false);
  await page.key("Escape");
  await page.waitFor(gone(MENU));

  const STATUS = dialog("Status");
  await intoSubmenu(page, 1, "Status");
  expect(await page.eval(`document.querySelector('${STATUS} input:not(.menu-checkbox)').placeholder`)).toBe("Change status…");
  expect(
    await page.eval(`[...document.querySelectorAll('${STATUS} [cmdk-item]')].slice(0,2).map(n=>n.dataset.number)`),
  ).toEqual(["1", "2"]);
  // A digit picks the row showing it: any row but the current status, so the pick is a change.
  const digit = await page.eval<string>(
    `[...document.querySelectorAll('${STATUS} [cmdk-item]')].find(n=>!n.querySelector('.menu-checkmark')).dataset.number`,
  );
  await page.key(digit);
  await page.waitFor(gone(MENU));
  await page.waitFor(`window.__ops.some(w=>w.key==='TEST-2'&&w.ops.some(o=>o.op==='status'))`);
});

test("ISSUE-3: Due date and Remind me read a typed time, like their pickers", async ({ open }) => {
  const page = await open("", { setup: writable });
  const DUE = dialog("Due date");
  await intoSubmenu(page, 4, "Due date");
  expect(await page.eval(`document.querySelector('${DUE} input').placeholder`)).toBe("Try: 24h, 7 days, Feb 9");
  await page.type("24h");
  await page.waitFor(exists(`${DUE} [cmdk-item][data-value="Due 24h"]`));
  await page.key("Enter");
  await page.waitFor(gone(MENU));
  await page.waitFor(`window.__ops.some(w=>w.key==='TEST-2'&&JSON.stringify(w.ops).includes('due'))`);

  await rightClick(page);
  await page.type("remind");
  await page.waitFor(`document.querySelector('${MENU} [cmdk-item][data-selected=true]')?.dataset.value === "Remind me"`);
  await page.key("Enter");
  const REMIND = dialog("Remind me");
  await page.waitFor(`!!document.activeElement?.closest('${REMIND}')`);
  await page.type("in 2 days");
  // The typed time is the first row, valued by its ISO time, ahead of Custom….
  await page.waitFor(
    `/^\\d{4}-\\d\\d-\\d\\dT/.test(document.querySelector('${REMIND} [cmdk-item]')?.dataset.value ?? "")`,
  );
});

test("ISSUE-9 / CORE-16: a long root menu fills the window less its margins, not 60vh", async ({ open }) => {
  const page = await open("", { width: 900, height: 520 });
  await rightClick(page);
  const height = await page.eval<number>(`document.querySelector('${MENU}').getBoundingClientRect().height`);
  expect(height).toBeGreaterThan(520 * 0.6 + 20);
  expect(height).toBeLessThanOrEqual(500);
});

test("ISSUE-15 / CORE-6: a pointer open is pristine, a key open highlights; the first key from pristine previews", async ({
  open,
}) => {
  const page = await open();
  await test.step("ISSUE-15: a submenu the pointer opens has no highlight", async () => {
    await rightClick(page);
    await page.hover(`${MENU} [cmdk-item][data-value="Status"]`);
    await page.waitFor(exists(dialog("Status")));
    expect(await page.eval(pristine(dialog("Status")))).toBe(true);
    await page.key("Escape");
    await page.waitFor(gone(MENU));
  });
  await test.step("CORE-6: Enter on a column's ⋯ opens its menu with the first row highlighted", async () => {
    await page.page.focus('[aria-label^="Options for "]');
    await page.key("Enter");
    const COLUMN = '[role=dialog][aria-label^="Column "]';
    await page.waitFor(exists(COLUMN));
    expect(await page.eval(pristine(COLUMN))).toBe(false);
    expect(await selected(page, COLUMN)).toBe(
      await page.eval<string>(`document.querySelector('${COLUMN} [cmdk-item]').dataset.value`),
    );
    await page.key("Escape");
    await page.waitFor(gone(COLUMN));
  });
  for (const key of ["ArrowDown", "Tab", "PageDown", " "])
    await test.step(`P1 note: from a pristine menu, ${key} highlights Status and previews its submenu`, async () => {
      await rightClick(page);
      expect(await page.eval(pristine(MENU))).toBe(true);
      await page.key(key);
      await page.waitFor(`document.querySelector('${MENU} [cmdk-item][data-selected=true]')?.dataset.value === "Status"`);
      expect(await page.eval(pristine(MENU))).toBe(false);
      if (key !== " ") await page.waitFor(exists(dialog("Status")), 2000);
      await page.key("Escape");
      await page.waitFor(gone(MENU));
    });
});

test("ISSUE-17: hoisted rows read Linear's parent names with a chevron; nothing found reads No matching actions", async ({
  open,
}) => {
  const page = await open();
  await rightClick(page);
  await page.type("tes");
  const row = `${MENU} [cmdk-item][data-value="Change label › test"]`;
  await page.waitFor(exists(row));
  expect(await page.eval(exists(`${row} svg`))).toBe(true);
  await page.type("zzz");
  await page.waitFor(`document.querySelector('${MENU} .menu-empty')?.textContent === "No matching actions"`);
});

test("CORE-18 / CORE-26: a context menu opens 4px right of and 1px above the pointer, and its row stays lit", async ({ open }) => {
  const page = await open("", { height: 1400 });
  await test.step("CORE-18: a card's menu", async () => {
    const at = await rightClick(page);
    const box = await page.rect(MENU);
    expect([Math.round(box.left - at.x), Math.round(box.top - at.y)]).toEqual([4, -1]);
    await page.key("Escape");
  });
  await test.step("CORE-26: a sidebar board row keeps its hover background (sidebarLinkBg) while its menu is open", async () => {
    await page.click("nav a:has([data-inbox-badge])");
    await page.waitFor(`location.pathname === "/inbox"`);
    const row = `[...document.querySelectorAll('nav[aria-label="Main navigation"] a')].find(b=>b.textContent.includes('Browser audit'))`;
    const r = await page.eval<{ x: number; y: number }>(`(r=>({x:r.x+20,y:r.y+10}))(${row}.getBoundingClientRect())`);
    await page.page.mouse.click(r.x, r.y, { button: "right" });
    await page.waitFor(exists(dialog("Space options")));
    await page.page.mouse.move(r.x + 400, r.y + 300);
    await sleep(100);
    const hover = await page.eval<string>(
      `(()=>{const d=document.createElement("div");d.style.background="var(--sidebar-hover)";document.body.append(d);const c=getComputedStyle(d).backgroundColor;d.remove();return c})()`,
    );
    expect(await page.eval<string>(`getComputedStyle(${row}).backgroundColor`)).toBe(hover);
  });
});

test("C3: every property picker searches with Linear's one action score: statuses a query starts in workflow order, rows by Linear's keywords", async ({
  open,
}) => {
  const page = await open("", { setup: writable });
  const rows = (scope: string) =>
    page.eval<string[]>(`[...document.querySelectorAll('${scope} [cmdk-item]')].map(n=>n.dataset.value)`);
  const first = (scope: string, value: string) =>
    page.waitFor(`document.querySelector('${scope} [cmdk-item]')?.dataset.value === ${JSON.stringify(value)}`);

  // The S picker: "do" lists Doing before Done in workflow order (PCn.scoreForOrdering), though "Done" alone scores higher.
  const PICKER = dialog("Change status");
  await page.keys("j");
  await page.key("s");
  await page.waitFor(exists(PICKER));
  await page.type("do");
  await first(PICKER, "Doing");
  expect((await rows(PICKER)).slice(0, 2)).toEqual(["Doing", "Done"]);
  await page.key("Escape");
  await page.waitFor(gone(PICKER));

  // Issue options › Status ranks the same way.
  const STATUS = dialog("Status");
  await intoSubmenu(page, 1, "Status");
  await page.type("do");
  await first(STATUS, "Doing");
  expect((await rows(STATUS)).slice(0, 2)).toEqual(["Doing", "Done"]);
  await page.key("Escape");
  await page.key("Escape");
  await page.waitFor(gone(MENU));

  // Issue options › Due date finds Custom… by Linear's keywords ("select specific pick"), and nothing else.
  const DUE = dialog("Due date");
  await intoSubmenu(page, 4, "Due date");
  await page.type("pick");
  await first(DUE, "Custom…");
  expect(await rows(DUE)).toEqual(["Custom…"]);
});
