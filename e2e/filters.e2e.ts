import { afterAll, expect, test } from "bun:test";
import { open, PREFS_KEY, stop } from "./harness";

afterAll(stop);
const root = `document.querySelector('[aria-label="Add Filter…"]')`;

test("filter search is focused on click and hover opens values beside the category list", async () => {
  const page = await open();
  try {
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
    await page.waitFor(`document.querySelectorAll('[data-key]').length===1`);
    expect(await page.eval(`!!${root}`)).toBe(true);
  } finally {
    await page.close();
  }
});

test("filter keyboard navigation keeps the root and returns with ArrowLeft", async () => {
  const page = await open();
  try {
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
  } finally {
    await page.close();
  }
});

test("R5: Esc in a filter submenu closes the menu and returns focus to the filter button", async () => {
  const page = await open();
  try {
    await page.waitFor(`document.querySelectorAll("[data-key]").length===6`);
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
  } finally {
    await page.close();
  }
});

test("B7: clicking a filter chip opens a small operator/value picker under the chip", async () => {
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
  try {
    await page.waitFor(`document.querySelectorAll("[data-key]").length===1`);
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
    await page.waitFor(`document.querySelectorAll("[data-key]").length===5`);
    expect(
      await page.eval(
        `[...document.querySelectorAll("button")].some(b=>b.textContent==="Labels is not ui")`,
      ),
    ).toBe(true);
  } finally {
    await page.close();
  }
});

test("hover switches categories and keeps multi-select values and saved filters working", async () => {
  const page = await open();
  try {
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
    await page.waitFor(`document.querySelectorAll('[data-key]').length===3`);
    expect(await page.eval(`!!${root}`)).toBe(true);
    await page.key("Escape");
    await page.reload();
    expect(await page.eval(`document.querySelectorAll('[data-key]').length`)).toBe(3);
  } finally {
    await page.close();
  }
});

test("nested Dates panels stay open while moving into their values", async () => {
  const page = await open();
  try {
    await page.click('[aria-label="Add filter"]');
    await page.hover("text=Dates");
    await page.waitFor(`!!document.querySelector('[aria-label="Filter Dates"]')`);
    await page.hover("text=Due date");
    await page.waitFor(`!!document.querySelector('input[aria-label="Due date"]')`);
    await page.hover('input[aria-label="Due date"]');
    await Bun.sleep(300);
    expect(
      await page.eval(
        `!!${root}&&!!document.querySelector('[aria-label="Filter Dates"]')&&!!document.querySelector('input[aria-label="Due date"]')`,
      ),
    ).toBe(true);
    await page.click("text=No due date");
    await page.waitFor(`!!document.querySelector('[aria-label="Remove due filter"]')&&!${root}`);
  } finally {
    await page.close();
  }
});

test("submenus stay inside a narrow viewport and dismiss on an outside click", async () => {
  const page = await open("", { width: 390, height: 700 });
  try {
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
  } finally {
    await page.close();
  }
});

test("nested filter keyboard navigation focuses the value field and returns through each parent", async () => {
  const page = await open();
  try {
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
  } finally {
    await page.close();
  }
});
