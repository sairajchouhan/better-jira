import { expect, test, PREFS_KEY, sleep, type App } from "./app";

/** Characterization of every popup kind: where it opens (to the pixel, against its anchor) and how focus moves in, stays in and returns. */

const filters = {
  id: "root",
  join: "and",
  children: [{ id: "p", field: "priority", op: "is", values: ["High"] }],
};
const seeded = `if(!sessionStorage.seeded){sessionStorage.seeded=1;localStorage.setItem(${JSON.stringify(PREFS_KEY)},${JSON.stringify(JSON.stringify({ 1: { filters } }))})}`;
const TOOLBAR = "body > div.fixed.z-40";
const FILTER = 'header [aria-label="Add another filter"]:not(.view-filter-add)';
const dialog = (label: string) => `[role=dialog][aria-label="${label}"]`;

type Box = { left: number; top: number; right: number; bottom: number; width: number; height: number };
const rect = (page: App, selector: string) =>
  page.eval<Box>(
    `(()=>{const n=document.querySelector(${JSON.stringify(selector)});return n&&n.getBoundingClientRect().toJSON()})()`,
  );
/** What has focus, by its accessible name, else its text. */
const focused = (page: App) =>
  page.eval<string>(
    `(()=>{const a=document.activeElement;return a?(a.getAttribute("aria-label")??a.getAttribute("placeholder")??(a.textContent.trim()||a.tagName)):""})()`,
  );
const inside = (page: App, selector: string) =>
  page.eval<boolean>(`!!document.querySelector(${JSON.stringify(selector)})?.contains(document.activeElement)`);
/** Layout rounds to 1/64 px. */
const near = (actual: number, expected: number) => expect(Math.abs(actual - expected)).toBeLessThan(0.05);

/** Tab and Shift+Tab past either end wrap inside the popup. */
async function trapsTab(page: App, selector: string) {
  for (const mods of [[], ["shift"]] as string[][])
    for (let i = 0; i < 12; i++) {
      await page.key("Tab", ...mods);
      expect(await inside(page, selector)).toBe(true);
    }
}

test("toolbar popups: Filter, Display and the chip row + open at Linear's offsets and own focus", async ({ open }) => {
  const page = await open("", { setup: seeded });
  await page.waitFor(`!!document.querySelector('.view-filter-chip')`);

  await test.step("Filter: bottom-right, 6px under the trigger, right edges flush; focus in, Tab trapped, Esc returns", async () => {
    await page.click(FILTER);
    await page.waitFor(`document.activeElement?.placeholder==="Add Filter…"`);
    const [trigger, popup] = [await rect(page, FILTER), await rect(page, TOOLBAR)];
    near(popup.top, trigger.bottom + 6);
    near(popup.right, trigger.right);
    expect(await page.eval(`document.querySelector(${JSON.stringify(TOOLBAR)}).style.right`)).toBe(
      `${1440 - trigger.right}px`,
    );
    await trapsTab(page, TOOLBAR);
    await page.key("Escape");
    await page.waitFor(`!document.querySelector(${JSON.stringify(TOOLBAR)})`);
    expect(await focused(page)).toBe("Add another filter");
  });

  await test.step("Filter submenu: left of its row, 4.5px apart, 43px above it (floating-ui rounding)", async () => {
    await page.click(FILTER);
    await page.waitFor(`document.activeElement?.placeholder==="Add Filter…"`);
    await page.hover('[cmdk-item][data-value="Status"]');
    await page.waitFor(`!!document.querySelector('${dialog("Status filter")}')`);
    await sleep(50);
    const [row, sub] = [
      await rect(page, '[cmdk-item][data-value="Status"]'),
      await rect(page, dialog("Status filter")),
    ];
    // Menu.Submenu overlaps its parent's outer edge by 2px: 4.5px left of the row's highlight, which is 6.5px inside in Linear.
    near(sub.right, (await rect(page, TOOLBAR)).left + 2);
    // Menu.Submenu puts its first row level with the opener (43px under its top in Linear, where the 0.5px borders stay 0.5px).
    const first = await rect(page, `${dialog("Status filter")} [cmdk-item]`);
    near(first.top, Math.round(row.top));
    // Hover opens it without taking focus; ArrowRight on the row moves focus into its search, ArrowLeft back.
    expect(await focused(page)).toBe("Add Filter…");
    await page.key("Escape");
    await page.waitFor(`!document.querySelector(${JSON.stringify(TOOLBAR)})`);
    await page.click(FILTER);
    await page.waitFor(`document.activeElement?.placeholder==="Add Filter…"`);
    // A click opens it pristine (FILTER-15): the first ArrowDown highlights "Advanced filter", the second Status.
    await page.key("ArrowDown");
    await page.key("ArrowDown");
    await page.key("ArrowRight");
    await page.waitFor(`document.activeElement?.getAttribute("aria-label")==="Filter Status"`);
    await page.key("ArrowLeft");
    await page.waitFor(`document.activeElement?.placeholder==="Add Filter…"`);
    await page.key("Escape");
    await page.waitFor(`!document.querySelector(${JSON.stringify(TOOLBAR)})`);
    expect(await focused(page)).toBe("Add another filter");
  });

  await test.step("Display: bottom-right, focus on the first layout tab, Esc returns to the trigger", async () => {
    await page.click('[aria-label="Display options"]');
    await page.waitFor(`!!document.querySelector(${JSON.stringify(TOOLBAR)})`);
    await sleep(50);
    const [trigger, popup] = [await rect(page, '[aria-label="Display options"]'), await rect(page, TOOLBAR)];
    near(popup.top, trigger.bottom + 6);
    near(popup.right, trigger.right);
    // The first match in DOM order of "input, selected tab, button": the first layout tab, whichever is selected.
    expect(
      await page.eval(`document.activeElement===document.querySelector('${TOOLBAR} [role=tab]')`),
    ).toBe(true);
    await trapsTab(page, TOOLBAR);
    await page.key("Escape");
    await page.waitFor(`!document.querySelector(${JSON.stringify(TOOLBAR)})`);
    expect(await focused(page)).toBe("Display options");
  });

  await test.step("an outside press closes it; focus goes where the press put it", async () => {
    await page.click('[aria-label="Display options"]');
    await page.waitFor(`!!document.querySelector(${JSON.stringify(TOOLBAR)})`);
    await page.page.mouse.click(700, 600);
    await page.waitFor(`!document.querySelector(${JSON.stringify(TOOLBAR)})`);
    expect(
      await page.eval(`document.activeElement===document.elementFromPoint(700,600).closest("[tabindex],button,a,input")`),
    ).toBe(true);
  });

  await test.step("chip row +: bottom-left, rounded 4px under it; Esc returns to the +", async () => {
    await page.click(".view-filter-add");
    await page.waitFor(`document.activeElement?.placeholder==="Add Filter…"`);
    const [trigger, popup] = [await rect(page, ".view-filter-add"), await rect(page, TOOLBAR)];
    expect(popup.top).toBe(Math.round(trigger.bottom + 4));
    expect(popup.left).toBe(Math.round(trigger.left));
    await page.key("Escape");
    await page.waitFor(`!document.querySelector(${JSON.stringify(TOOLBAR)})`);
    expect(await page.eval(`document.activeElement.classList.contains("view-filter-add")`)).toBe(true);
  });

  await test.step("Save filters (MenuSurface, align end): 5px under Save, right edges flush", async () => {
    await page.click('[aria-label="priority operator"]');
    await page.click('[cmdk-item][data-value="isNot"]');
    await page.click("text=Save");
    await page.waitFor(`!!document.querySelector('${dialog("Save filters")}')`);
    await sleep(50);
    const save = await page.eval<Box>(
      `[...document.querySelectorAll("button")].find(n=>n.textContent.trim()==="Save").getBoundingClientRect().toJSON()`,
    );
    const menu = await rect(page, dialog("Save filters"));
    near(menu.top, save.bottom + 5);
    near(menu.right, save.right);
    expect(await inside(page, dialog("Save filters"))).toBe(true);
    await trapsTab(page, dialog("Save filters"));
    await page.key("Escape");
    await page.waitFor(`!document.querySelector('${dialog("Save filters")}')`);
    expect(await focused(page)).toBe("Save");
  });
  await page.close();
});

test("MenuSurface: below its anchor, flipped above near the bottom, centred under 600px, and at a point inside the edges", async ({
  open,
}) => {
  const page = await open("?issue=TEST-2");
  const STATUS = dialog("Change status");
  // The open issue's Status property: S anchors there (a card or row opens the command menu instead, ISSUE-11).
  const card = "#prop-status";
  await page.waitFor(`!!document.querySelector('${card}')`);

  await test.step("S on the open issue (PropertyMenu, gap 4.5): 4.5px under its Status button, left edges flush; Tab stays in; Esc returns focus to where it was", async () => {
    await page.eval("document.activeElement?.blur()");
    const before = await focused(page);
    await page.key("s");
    await page.waitFor(`document.activeElement?.placeholder==="Change status…"`);
    await sleep(50);
    const [anchor, menu] = [await rect(page, card), await rect(page, STATUS)];
    near(menu.top, anchor.bottom + 4.5);
    near(menu.left, anchor.left);
    await trapsTab(page, STATUS);
    await page.key("Escape");
    await page.waitFor(`!document.querySelector('${STATUS}')`);
    expect(await focused(page)).toBe(before);
  });

  await test.step("near the bottom it flips above the button, 4.5px over it", async () => {
    const anchor = await rect(page, card);
    await page.page.setViewportSize({ width: 1440, height: Math.ceil(anchor.bottom + 40) });
    await sleep(100);
    await page.key("s");
    await page.waitFor(`!!document.querySelector('${STATUS}')`);
    await sleep(50);
    const [now, menu] = [await rect(page, card), await rect(page, STATUS)];
    near(menu.bottom, now.top - 4.5);
    near(menu.left, now.left);
    await page.key("Escape");
    await page.page.setViewportSize({ width: 1440, height: 900 });
  });

  await test.step("under 600px wide it is centred, 12vh down", async () => {
    await page.page.setViewportSize({ width: 560, height: 800 });
    await sleep(100);
    await page.key("s");
    await page.waitFor(`!!document.querySelector('${STATUS}')`);
    await sleep(50);
    const menu = await rect(page, STATUS);
    near(menu.left, (560 - menu.width) / 2);
    near(menu.top, 96);
    expect(await page.eval(`document.querySelector('${STATUS}').style.maxHeight`)).toBe("80vh");
    await page.key("Escape");
    await page.page.setViewportSize({ width: 1440, height: 900 });
  });

  await test.step("a right-click at the bottom-right corner stays 10px inside the window", async () => {
    await page.eval(
      `(()=>{const n=document.querySelector('[data-key="TEST-2"]');n.dispatchEvent(new MouseEvent('contextmenu',{bubbles:true,cancelable:true,clientX:innerWidth-2,clientY:innerHeight-2}))})()`,
    );
    const MENU = dialog("Issue options");
    await page.waitFor(`!!document.querySelector('${MENU}')`);
    await sleep(50);
    // A fitted menu is placed by its exact width, so its right edge sits exactly 10px in.
    const [menu, size] = [
      await rect(page, MENU),
      await page.eval<number[]>(`(n=>[n.offsetWidth,n.scrollHeight+n.offsetHeight-n.clientHeight])(document.querySelector('${MENU}'))`),
    ];
    near(menu.right, 1440 - 10);
    near(menu.top, 900 - size[1]! - 10);
    expect(await inside(page, MENU)).toBe(true);
    await page.key("Escape");
    await page.waitFor(`!document.querySelector('${MENU}')`);
  });

  await test.step("a right-click mid-board opens 3px right of the pointer", async () => {
    await page.eval(
      `(()=>{const n=document.querySelector('[data-key="TEST-2"]');n.dispatchEvent(new MouseEvent('contextmenu',{bubbles:true,cancelable:true,clientX:300,clientY:200}))})()`,
    );
    const MENU = dialog("Issue options");
    await page.waitFor(`!!document.querySelector('${MENU}')`);
    await sleep(50);
    const menu = await rect(page, MENU);
    near(menu.left, 303);
    near(menu.top, 200);
    await page.key("Escape");
  });
  await page.close();
});

test("mention menu: 4px under the @, focus stays in the editor", async ({ open }) => {
  const page = await open("?issue=TEST-2&view=page");
  await page.waitFor(`!!document.querySelector('#description p')`);
  await page.click("#description p");
  await page.key("End");
  await page.type(" @");
  const MENU = '[aria-label="Mention people"]';
  await page.waitFor(`document.querySelectorAll('${MENU} [role=option]').length===3`);
  const at = await page.eval<Box>(
    `(()=>{const w=document.createTreeWalker(document.querySelector('#description'),NodeFilter.SHOW_TEXT);let n,last;while(n=w.nextNode())if(n.data.includes('@'))last=n;const r=document.createRange(),i=last.data.lastIndexOf('@');r.setStart(last,i);r.setEnd(last,i+1);return r.getBoundingClientRect().toJSON()})()`,
  );
  const menu = await rect(page, MENU);
  near(menu.left, Math.max(8, Math.min(at.left, 1440 - 268)));
  near(menu.top, at.bottom + 4);
  // Menu's list padding (Vw.LIST_PADDING 6 above and below) plus the 1px border.
  expect(menu.height).toBe(3 * 32 + 12 + 2);
  expect(await page.eval(`document.querySelector('#description').contains(document.activeElement)`)).toBe(true);
  await page.key("Escape");
  await page.waitFor(`!document.querySelector('${MENU}')`);
  await page.close();
});

test("label menu from the properties panel opens beside its row, 4.5px left, 5.5px above its top", async ({ open }) => {
  const page = await open("?issue=TEST-2&view=page");
  const trigger = "[data-properties] #prop-labels";
  await page.waitFor(`!!document.querySelector(${JSON.stringify(trigger)})`);
  await page.click(trigger);
  const MENU = dialog("Change labels");
  await page.waitFor(`!!document.querySelector('${MENU}')`);
  await sleep(50);
  const [anchor, menu, width] = [
    await rect(page, trigger),
    await rect(page, MENU),
    await page.eval<number>(`document.querySelector('${MENU}').offsetWidth`),
  ];
  near(menu.left, anchor.left - width - 4.5);
  near(menu.top, anchor.top - 5.5);
  expect(await focused(page)).toBe("Change or add labels…");
  await page.key("Escape");
  await page.waitFor(`!document.querySelector('${MENU}')`);
  expect(await page.eval(`document.activeElement===document.querySelector(${JSON.stringify(trigger)})`)).toBe(true);
  await page.close();
});
