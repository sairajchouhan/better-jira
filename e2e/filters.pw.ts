import { expect, test, sleep, PREFS_KEY } from "./app";

const root = `document.querySelector('[aria-label="Add Filter…"]')`;
const cards = `document.querySelectorAll('[data-key]').length`;

test("Add filter by mouse: search, hover submenus, multi-select and chips", async ({ open }) => {
  const page = await open();
  await test.step("filter search is focused on click and hover opens values beside the category list", async () => {
    await page.click('[aria-label="Add filter"]');
    await page.waitFor(`document.activeElement===${root}`);
    await page.type("label");
    await page.hover("text=Labels");
    await page.waitFor(`!!document.querySelector('[aria-label="Filter Labels"]')`);
    expect(await page.eval(`!!${root}`)).toBe(true);
    expect(await page.active()).toBe("Add Filter…");
    const parent = await page.rect('[aria-label="Add Filter…"]');
    const child = await page.rect('[aria-label="Filter Labels"]');
    expect(child.right).toBeLessThanOrEqual(parent.left);
    await page.hover('[aria-label="Filter Labels"]');
    await page.waitFor(`document.activeElement?.getAttribute("aria-label")==="Filter Labels"`);
    await page.type("ui");
    await page.key("Enter");
    await page.waitFor(`${cards}===1`);
    expect(await page.eval(`!!${root}`)).toBe(true);
    await page.key("Escape");
    await page.click('[aria-label="Remove labels filter"]');
    await page.waitFor(`${cards}===6`);
  });
  await test.step("hover switches categories and keeps multi-select values and saved filters working", async () => {
    await page.click('[aria-label="Add filter"]');
    await page.hover("text=Status");
    await page.waitFor(`!!document.querySelector('[aria-label="Filter Status"]')`);
    await page.hover("text=Priority");
    await page.waitFor(
      `!!document.querySelector('[aria-label="Filter Priority"]')&&!document.querySelector('[aria-label="Filter Status"]')`,
    );
    await page.hover('[aria-label="Filter Priority"]');
    await page.click('[aria-label="Priority filter"] [cmdk-item][data-value="High High"]');
    await page.click('[aria-label="Priority filter"] [cmdk-item][data-value="Low Low"]');
    await page.waitFor(`${cards}===3`);
    expect(await page.eval(`!!${root}`)).toBe(true);
    await page.key("Escape");
    await page.reload();
    expect(await page.eval(cards)).toBe(3);
    await page.click('[aria-label="Remove priority filter"]');
    await page.waitFor(`${cards}===6`);
  });
  await test.step("nested Dates panels stay open while moving into their values", async () => {
    await page.click('[aria-label="Add filter"]');
    await page.hover("text=Dates");
    await page.waitFor(`!!document.querySelector('[aria-label="Filter Dates"]')`);
    await page.hover("text=Due date");
    await page.waitFor(`!!document.querySelector('input[aria-label="Due date"]')`);
    await page.hover('input[aria-label="Due date"]');
    await sleep(300); // the panels must not close in this window
    expect(
      await page.eval(
        `!!${root}&&!!document.querySelector('[aria-label="Filter Dates"]')&&!!document.querySelector('input[aria-label="Due date"]')`,
      ),
    ).toBe(true);
    await page.click("text=No due date");
    await page.waitFor(`!!document.querySelector('[aria-label="Remove due filter"]')&&!${root}`);
  });
  await test.step("B7: clicking a filter chip opens a small operator/value picker under the chip", async () => {
    const prefs = {
      1: {
        filters: {
          id: "root",
          join: "and",
          children: [{ id: "r1", field: "labels", op: "is", values: ["ui"] }],
        },
      },
    };
    const setup = `if(!sessionStorage.seeded){sessionStorage.seeded=1;localStorage.setItem(${JSON.stringify(PREFS_KEY)},${JSON.stringify(JSON.stringify(prefs))});}`;
    const page = await open("", { setup });
    await page.waitFor(`${cards}===1`);
    const chip = await page.rect('[aria-label="Remove labels filter"]');
    await page.click("text=Labels is ui");
    await page.waitFor(
      `!!document.querySelector('[role=dialog][aria-label="Edit Labels filter"]')`,
    );
    expect(await page.eval(`!!document.querySelector('[aria-label="Advanced filter"]')`)).toBe(
      false,
    );
    const menu = await page.rect('[role=dialog][aria-label="Edit Labels filter"]');
    expect(menu.top).toBeGreaterThanOrEqual(chip.bottom);
    expect(menu.top - chip.bottom).toBeLessThan(40);
    await page.click('[role=group][aria-label="Labels operator"] button:nth-child(2)');
    await page.waitFor(`${cards}===5`);
    expect(
      await page.eval(
        `[...document.querySelectorAll("button")].some(b=>b.textContent==="Labels is not ui")`,
      ),
    ).toBe(true);
  });
  await test.step("submenus stay inside a narrow viewport and dismiss on an outside click", async () => {
    const page = await open("", { width: 390, height: 700 });
    await page.click('[aria-label="Add filter"]');
    await page.hover("text=Status");
    await page.waitFor(`!!document.querySelector('[aria-label="Filter Status"]')`);
    const rect = await page.rect('[role=dialog][aria-label="Status filter"]');
    expect(rect.left).toBeGreaterThanOrEqual(0);
    expect(rect.right).toBeLessThanOrEqual(390);
    expect(rect.top).toBeGreaterThanOrEqual(0);
    expect(rect.bottom).toBeLessThanOrEqual(700);
    await page.clickAt(5, 5);
    await page.waitFor(`!${root}&&!document.querySelector('[aria-label="Filter Status"]')`);
  });
});

test("Add filter by keyboard: arrows into submenus and back, Esc out", async ({ open }) => {
  const page = await open();
  await test.step("filter keyboard navigation keeps the root and returns with ArrowLeft", async () => {
    await page.key("f");
    await page.waitFor(`document.activeElement===${root}`);
    await page.type("label");
    await page.key("ArrowRight");
    await page.waitFor(`document.activeElement?.getAttribute("aria-label")==="Filter Labels"`);
    expect(await page.eval(`!!${root}`)).toBe(true);
    await page.key("Tab");
    expect(await page.active()).toBe("Add Filter…");
    await page.key("Tab", "shift");
    expect(await page.active()).toBe("Filter Labels");
    await page.key("ArrowLeft");
    await page.waitFor(`document.activeElement===${root}`);
    expect(await page.eval(`!!document.querySelector('[aria-label="Filter Labels"]')`)).toBe(false);
    await page.key("Escape");
    await page.waitFor(`!${root}`);
  });
  await test.step("nested filter keyboard navigation focuses the value field and returns through each parent", async () => {
    await page.key("f");
    await page.waitFor(`document.activeElement===${root}`);
    await page.type("Dates");
    await page.key("ArrowRight");
    await page.waitFor(`document.activeElement?.getAttribute('aria-label')==='Filter Dates'`);
    await page.key("ArrowRight");
    await page.waitFor(`document.activeElement?.getAttribute('aria-label')==='Due date'`);
    await page.key("ArrowLeft");
    await page.waitFor(`document.activeElement?.getAttribute('aria-label')==='Filter Dates'`);
    await page.key("ArrowLeft");
    await page.waitFor(`document.activeElement===${root}`);
    expect(await page.eval(`!!document.querySelector('[aria-label="Filter Dates"]')`)).toBe(false);
    await page.key("Escape");
    await page.waitFor(`!${root}`);
  });
  await test.step("R5: Esc in a filter submenu closes the menu and returns focus to the filter button", async () => {
    await page.eval("document.activeElement?.blur()");
    await page.waitFor(`${cards}===6`);
    await page.key("f");
    await page.waitFor(`document.activeElement===${root}`);
    await page.type("label");
    await page.key("Enter");
    await page.waitFor(`document.activeElement?.getAttribute("aria-label")==="Filter Labels"`);
    await page.key("Escape");
    await page.waitFor(`!document.querySelector('[aria-label="Filter Labels"]')`);
    expect(await page.eval(`!!${root}`)).toBe(false);
    expect(await page.active()).toBe("Add filter");
    await page.key("j");
    await page.waitFor(`!!document.querySelector("[data-selected]")`);
  });
});
