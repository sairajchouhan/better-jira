import { expect, test, sleep, type App } from "./app";

/** Regressions for the menu engine (menu.tsx, menu-surface.tsx): one test per audit finding, each fails with its fix removed. */

const ROOT = '[aria-label="Add Filter…"]';
const dialog = (label: string) => `[role=dialog][aria-label="${label}"]`;
const ISSUE_MENU = dialog("Issue options");
const exists = (selector: string) => `!!document.querySelector(${JSON.stringify(selector)})`;
const gone = (selector: string) => `!document.querySelector(${JSON.stringify(selector)})`;
const selected = (page: App, scope = "") =>
  page.eval<string>(`document.querySelector('${scope} [cmdk-item][data-selected=true]')?.dataset.value ?? ""`);
const centre = async (page: App, selector: string) => {
  const r = await page.rect(selector);
  return { x: r.x + r.width / 2, y: r.y + r.height / 2 };
};

/** A writable site faked in the page, so status changes apply and land in `window.__ops`. */
const writable = `(()=>{const real=fetch;window.__ops=[];
window.fetch=async(input,init)=>{const path=new URL(String(input),location.href).pathname;
 if(path==='/api/client'){const client=await (await real(input,init)).json();return Response.json({...client,writable:true});}
 const m=path.match(/^\\/api\\/issues\\/([^/]+)\\/ops$/);if(!m)return real(input,init);
 window.__ops.push({key:m[1],ops:JSON.parse(init.body).ops});
 return Response.json({key:m[1],created:{},others:[]});
};})()`;

async function openFilter(page: App) {
  await page.click('[aria-label="Add filter"]');
  await page.waitFor(`document.activeElement?.getAttribute("aria-label")==="Add Filter…"`);
}

async function rightClick(page: App, selector: string) {
  const { x, y } = await centre(page, selector);
  await page.page.mouse.click(x, y, { button: "right" });
  await page.waitFor(exists(ISSUE_MENU));
}

test("FILTER-1 / CORE-14: a fast move into a submenu across other rows keeps it open", async ({ open }) => {
  const page = await open();
  await test.step("FILTER-1: Add filter › Status, crossing Assignee and Creator", async () => {
    await openFilter(page);
    await page.hover('[cmdk-item][data-value="Status"]');
    await page.waitFor(exists(dialog("Status filter")));
    // The submenu opens on the left with its first row level with Status; aim at its last row, below Assignee and Creator.
    const last = `${dialog("Status filter")} [cmdk-item]:last-of-type`;
    const target = await centre(page, last);
    await page.page.mouse.move(target.x, target.y, { steps: 5 });
    await sleep(200);
    expect(await page.eval(exists(dialog("Status filter")))).toBe(true);
    expect(await page.eval(exists(dialog("Assignee filter")))).toBe(false);
    // Rows crossed on the way don't take the highlight from Status.
    expect(await selected(page, `[cmdk-root]:has(${ROOT})`)).toBe("Status");
    await page.key("Escape");
  });
  await test.step("CORE-14: issue options › Status, crossing Priority and Assignee", async () => {
    await rightClick(page, '[data-key="TEST-2"]');
    await page.hover(`${ISSUE_MENU} [cmdk-item][data-value="Status"]`);
    await page.waitFor(exists(dialog("Status")));
    const items = await page.eval<number>(`document.querySelectorAll('${dialog("Status")} [cmdk-item]').length`);
    const target = await centre(page, `${dialog("Status")} [cmdk-item]:nth-child(${Math.min(items, 4)})`);
    await page.page.mouse.move(target.x, target.y, { steps: 5 });
    await sleep(200);
    expect(await page.eval(exists(dialog("Status")))).toBe(true);
    expect(await page.eval(exists(dialog("Priority")))).toBe(false);
    await page.key("Escape");
  });
});

test("FILTER-4 / CORE-4: a press outside a toolbar popup closes it and does nothing else", async ({ open }) => {
  const page = await open();
  await openFilter(page);
  const card = await centre(page, '[data-key="TEST-2"]');
  await page.clickAt(card.x, card.y);
  await page.waitFor(gone(ROOT));
  await sleep(150);
  expect(await page.eval(`new URL(location.href).searchParams.has("issue")`)).toBe(false);
  expect(await page.eval(exists('[aria-label="Issue title"]'))).toBe(false);
});

test("CORE-1 / CORE-2: a dropdown inside Display options closes alone, by Escape or by a press beside it", async ({ open }) => {
  const page = await open();
  const DISPLAY = dialog("Display options");
  const GROUPING = '[aria-label^="Columns:"]';
  await page.click('[aria-label="Display options"]');
  await page.waitFor(exists(DISPLAY));
  await test.step("CORE-1: Escape closes only the dropdown and focuses its combobox; the next closes Display", async () => {
    await page.click(GROUPING);
    await page.waitFor(exists('[cmdk-item][data-selected=true]'));
    await page.key("Escape");
    await page.waitFor(gone("[cmdk-item]"));
    expect(await page.eval(exists(DISPLAY))).toBe(true);
    expect(await page.eval(`document.activeElement?.matches('${GROUPING}')`)).toBe(true);
  });
  await test.step("CORE-2: a press on the Display panel closes the dropdown, focus returns to it, and Escape still closes Display", async () => {
    await page.click(GROUPING);
    await page.waitFor(exists("[cmdk-item]"));
    const panel = await page.rect(DISPLAY);
    await page.clickAt(panel.x + 8, panel.y + panel.height - 8);
    await page.waitFor(gone("[cmdk-item]"));
    expect(await page.eval(`document.activeElement?.matches('${GROUPING}')`)).toBe(true);
    await page.key("Escape");
    await page.waitFor(gone(DISPLAY));
    expect(await page.active()).toBe("Display options");
  });
});

test("CORE-5 / ISSUE-12: Escape in a submenu closes every level; ← and Backspace step back one", async ({ open }) => {
  const page = await open();
  await test.step("CORE-5: issue options › Status, Escape", async () => {
    await rightClick(page, '[data-key="TEST-2"]');
    await page.key("ArrowDown");
    await page.key("ArrowRight");
    await page.waitFor(`!!document.activeElement?.closest('${dialog("Status")}')`);
    await page.key("Escape");
    await page.waitFor(gone(ISSUE_MENU));
    expect(await page.eval(exists(dialog("Status")))).toBe(false);
  });
  await test.step("ISSUE-12: Add filter › Status with a query, Escape", async () => {
    await openFilter(page);
    await page.key("ArrowDown");
    await page.key("ArrowRight");
    await page.waitFor(`document.activeElement?.getAttribute("aria-label")==="Filter Status"`);
    await page.type("do");
    await page.key("Escape");
    await page.waitFor(gone(ROOT));
    expect(await page.active()).toBe("Add filter");
  });
});

test("FILTER-6 / ISSUE-6 / CORE-9: Backspace on an empty submenu search steps back one level", async ({ open }) => {
  const page = await open();
  await openFilter(page);
  await page.key("ArrowDown");
  await page.key("ArrowRight");
  await page.waitFor(`document.activeElement?.getAttribute("aria-label")==="Filter Status"`);
  await page.type("ab");
  await page.key("Backspace");
  await page.key("Backspace");
  // Emptying the search is not a step back; the next Backspace is.
  expect(await page.active()).toBe("Filter Status");
  await page.key("Backspace");
  await page.waitFor(gone(dialog("Status filter")));
  expect(await page.active()).toBe("Add Filter…");
  expect(await page.eval(exists(ROOT))).toBe(true);
  await page.key("Escape");
});

test("FILTER-7 / CORE-12 / ISSUE-13: Space opens a submenu row and toggles a checkbox row, keeping the menu open", async ({ open }) => {
  const page = await open();
  await openFilter(page);
  await page.key("ArrowDown");
  expect(await selected(page)).toBe("Status");
  await page.key(" ");
  await page.waitFor(`document.activeElement?.getAttribute("aria-label")==="Filter Status"`);
  const SUB = dialog("Status filter");
  const first = await page.eval<string>(`document.querySelector('${SUB} [cmdk-item][data-selected=true]').dataset.value`);
  await page.key(" ");
  await page.waitFor(`document.querySelector('${SUB} [cmdk-item][data-selected=true]')?.getAttribute("aria-checked")==="true"`);
  expect(await page.eval(`document.activeElement.value`)).toBe("");
  expect(await page.eval(exists(SUB))).toBe(true);
  // Mid-search, Space types unless the last key was ↑/↓ on a checkbox row.
  await page.key("ArrowDown");
  await page.key("ArrowUp");
  expect(await selected(page, SUB)).toBe(first);
  await page.key(" ");
  await page.waitFor(`document.querySelector('${SUB} [cmdk-item][data-selected=true]')?.getAttribute("aria-checked")==="false"`);
  await page.key("Escape");
});

test("FILTER-13 / ISSUE-7 / CORE-10: a keyboard highlight resting on a submenu row previews it without moving focus", async ({ open }) => {
  const page = await open();
  await rightClick(page, '[data-key="TEST-2"]');
  // The first ↓ only reveals the hidden first-row highlight (ActionMenu's pristine state); the next ones move it.
  await page.key("ArrowDown");
  await page.key("ArrowDown");
  expect(await selected(page, ISSUE_MENU)).toBe("Priority");
  await page.waitFor(exists(dialog("Priority")), 2000);
  expect(await page.active()).toBe("Find issue options");
  // ↑ moves the preview to the row it lands on.
  await page.key("ArrowUp");
  await page.waitFor(gone(dialog("Priority")));
  await page.waitFor(exists(dialog("Status")), 2000);
  expect(await page.active()).toBe("Find issue options");
  // Typing closes the preview.
  await page.type("a");
  await page.waitFor(gone(dialog("Status")));
  await page.key("Escape");
  // → moves focus into a previewed submenu.
  await rightClick(page, '[data-key="TEST-2"]');
  await page.key("ArrowDown");
  await page.key("ArrowDown");
  await page.waitFor(exists(dialog("Priority")), 2000);
  await page.key("ArrowRight");
  await page.waitFor(`!!document.activeElement?.closest('${dialog("Priority")}')`);
  await page.key("Escape");
  // A preview still pending when the row is opened and closed by hand doesn't reopen it.
  await openFilter(page);
  await page.key("ArrowDown");
  await page.key("ArrowRight");
  await page.waitFor(`document.activeElement?.getAttribute("aria-label")==="Filter Status"`);
  await page.key("ArrowLeft");
  await page.waitFor(gone(dialog("Status filter")));
  await sleep(400);
  expect(await page.eval(exists(dialog("Status filter")))).toBe(false);
  await page.key("Escape");
});

test("FILTER-14 / ISSUE-14 / CORE-11: Tab, Shift+Tab, PageDown and PageUp move the highlight", async ({ open }) => {
  const page = await open("", { width: 900, height: 500 });
  await openFilter(page);
  const order = await page.eval<string[]>(
    `[...document.querySelectorAll('[cmdk-root]:has(${ROOT}) [cmdk-item]:not([aria-disabled="true"])')].map(n=>n.dataset.value)`,
  );
  expect(await selected(page)).toBe(order[0]);
  await page.key("Tab");
  expect(await selected(page)).toBe(order[1]);
  expect(await page.active()).toBe("Add Filter…");
  await page.key("Tab", "shift");
  expect(await selected(page)).toBe(order[0]);
  await page.key("PageDown");
  const paged = order.indexOf(await selected(page));
  expect(paged).toBeGreaterThan(1);
  for (let i = 0; i < 5; i++) await page.key("PageDown");
  // A page move stops at the end instead of wrapping.
  expect(await selected(page)).toBe(order.at(-1));
  for (let i = 0; i < 5; i++) await page.key("PageUp");
  expect(await selected(page)).toBe(order[0]);
  await page.key("Escape");
});

test("FILTER-17 / CORE-23: ArrowRight opens a submenu only with the caret at the end of the search", async ({ open }) => {
  const page = await open();
  await openFilter(page);
  await page.type("stat");
  expect(await selected(page)).toBe("Status");
  await page.key("ArrowLeft");
  await page.key("ArrowLeft");
  await page.key("ArrowRight");
  await sleep(150);
  expect(await page.eval(exists(dialog("Status filter")))).toBe(false);
  expect(await page.eval(`document.activeElement.selectionStart`)).toBe(3);
  await page.key("ArrowRight");
  await page.key("ArrowRight");
  await page.waitFor(exists(dialog("Status filter")));
  await page.key("Escape");
});

test("FILTER-21 / CORE-3: a submenu keeps beside its parent in a small window", async ({ open }) => {
  const page = await open("", { width: 900, height: 500 });
  await openFilter(page);
  await page.hover('[cmdk-item][data-value="Dates"]');
  await page.waitFor(exists(dialog("Dates filter")));
  await page.hover(`${dialog("Dates filter")} [cmdk-item][data-value="Completed date"]`);
  await page.waitFor(exists(dialog("Completed date filter")));
  await sleep(100);
  const [parent, sub, row] = [
    await page.rect(dialog("Dates filter")),
    await page.rect(dialog("Completed date filter")),
    await page.rect(`${dialog("Dates filter")} [cmdk-item][data-value="Completed date"]`),
  ];
  // Beside its parent (2px overlap), never under or over it, and inside the window's 10px margin.
  expect(sub.right <= parent.left + 2.5 || sub.left >= parent.right - 2.5).toBe(true);
  expect(sub.top).toBeGreaterThanOrEqual(10);
  expect(sub.bottom).toBeLessThanOrEqual(490);
  expect(sub.top).toBeLessThanOrEqual(row.top);
  // Level with its row, pushed up only as far as the bottom margin needs (Linear's x3e clamp), never flipped above it.
  expect(sub.top).toBeGreaterThanOrEqual(Math.min(row.top - 12, 490 - sub.height) - 1);
  await page.key("Escape");
});

test("CORE-20: arrowing keeps 24px of rows past the highlight, and a wrap to the first row scrolls to the top", async ({ open }) => {
  const page = await open("", { width: 900, height: 500 });
  await openFilter(page);
  const LIST = `[cmdk-root]:has(${ROOT}) [cmdk-list]`;
  expect(await page.eval(`document.querySelector('${LIST}').scrollHeight>document.querySelector('${LIST}').clientHeight`)).toBe(true);
  await page.key("End");
  await page.key("ArrowDown");
  await sleep(50);
  expect(await page.eval(`document.querySelector('${LIST}').scrollTop`)).toBe(0);
  for (let i = 0; i < 9; i++) await page.key("ArrowDown");
  await sleep(50);
  const gap = await page.eval<number>(
    `(()=>{const l=document.querySelector('${LIST}').getBoundingClientRect(),r=document.querySelector('${LIST} [cmdk-item][data-selected=true]').getBoundingClientRect();return l.bottom-r.bottom})()`,
  );
  expect(gap).toBeGreaterThanOrEqual(23);
  await page.key("Escape");
});

test("FILTER-10: Enter on a chip value picks it and closes; Shift+Enter keeps the menu open", async ({ open }) => {
  const page = await open();
  await openFilter(page);
  await page.type("priority");
  await page.key("ArrowRight");
  await page.waitFor(`document.activeElement?.getAttribute("aria-label")==="Filter Priority"`);
  await page.key("Enter");
  await page.waitFor(`${gone(ROOT)}&&!!document.querySelector(".view-filter-chip")`);
  await page.click('[aria-label="priority value"]');
  const VALUES = '[role=dialog][aria-label="Priority value"]';
  await page.waitFor(exists(VALUES));
  await page.key("ArrowDown");
  await page.key("Enter", "shift");
  await sleep(100);
  expect(await page.eval(exists(VALUES))).toBe(true);
  await page.key("ArrowDown");
  await page.key("Enter");
  await page.waitFor(gone(VALUES));
});

test("CORE-22: Display options opens with focus on the popup, not a ringed control", async ({ open }) => {
  const page = await open();
  await page.click('[aria-label="Display options"]');
  await page.waitFor(exists(dialog("Display options")));
  await sleep(50);
  expect(await page.eval(`document.activeElement?.hasAttribute("data-popover")`)).toBe(true);
  await page.key("Tab");
  expect(await page.eval(`!!document.activeElement?.closest('${dialog("Display options")}')`)).toBe(true);
  await page.key("Escape");
});

test("ISSUE-18: after a status change moves the card, focus returns to its new node", async ({ open }) => {
  const page = await open("", { setup: writable });
  const card = '[data-key="TEST-2"]';
  await page.page.locator(card).first().focus();
  await page.eval(`window.__old=document.querySelector('${card}')`);
  await rightClick(page, card);
  await page.hover(`${ISSUE_MENU} [cmdk-item][data-value="Status"]`);
  const STATUS = dialog("Status");
  await page.waitFor(`!!document.querySelector('${STATUS} [cmdk-item] .menu-checkmark')`);
  const target = await page.eval<string>(
    `[...document.querySelectorAll('${STATUS} [cmdk-item]')].find(n=>!n.querySelector('.menu-checkmark'))?.dataset.value`,
  );
  await page.click(`${STATUS} [cmdk-item][data-value="${target}"]`);
  await page.waitFor(gone(ISSUE_MENU));
  await page.waitFor(`document.activeElement?.closest('[data-key]')?.dataset.key==="TEST-2"`, 2000);
  // The card really re-rendered as a new node, so plain focus return had nothing to go back to.
  expect(await page.eval(`window.__old.isConnected`)).toBe(false);
  await page.waitFor(`window.__ops.some(w=>w.key==="TEST-2"&&w.ops.some(o=>o.op==="status"))`);
});
