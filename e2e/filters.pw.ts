import { expect, fixture, test, sleep, PREFS_KEY } from "./app";

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
    // Enter picks the value and closes the menu (Linear); clicks keep it open, below.
    await page.waitFor(`${cards}===1&&!${root}`);
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
    await page.click('[cmdk-item][data-value="No due date"]'); // the row text carries its issue count
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
    await page.click('[aria-label="labels operator"]');
    await page.waitFor(
      `!!document.querySelector('[role=dialog][aria-label="Labels operator"]')`,
    );
    expect(await page.eval(`!!document.querySelector('[aria-label="Advanced filter"]')`)).toBe(
      false,
    );
    const menu = await page.rect('[role=dialog][aria-label="Labels operator"]');
    expect(menu.top).toBeGreaterThanOrEqual(chip.bottom);
    expect(menu.top - chip.bottom).toBeLessThan(40);
    await page.click('[cmdk-item][data-value="isNot"]');
    await page.waitFor(`${cards}===5`);
    expect(
      await page.eval(
        `document.querySelector(".view-filter-chip")?.textContent==="Labelsdo not includeui"`,
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
  await test.step("Enter on a value picks it and closes the menu, as Linear does", async () => {
    await page.key("f");
    await page.waitFor(`document.activeElement===${root}`);
    await page.type("status");
    await page.key("ArrowRight");
    await page.waitFor(`document.activeElement?.getAttribute("aria-label")==="Filter Status"`);
    await page.key("Enter");
    await page.waitFor(`!${root}&&!!document.querySelector(".view-filter-chip")`);
    await page.click("text=Clear");
    await page.waitFor(`!document.querySelector(".view-filter-row")`);
  });
  await test.step("filter keyboard navigation keeps the root and returns with ArrowLeft", async () => {
    await page.key("f");
    await page.waitFor(`document.activeElement===${root}`);
    await page.type("label");
    await page.key("ArrowRight");
    await page.waitFor(`document.activeElement?.getAttribute("aria-label")==="Filter Labels"`);
    expect(await page.eval(`!!${root}`)).toBe(true);
    // ISSUE-14: Tab moves the submenu's highlight and keeps focus in its search.
    await page.key("Tab");
    expect(await page.active()).toBe("Filter Labels");
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

/** Paints a CSS colour to a pixel and returns the WCAG contrast ratio of two colours (works for lch()). */
const contrast = `((a,b)=>{const c=document.createElement("canvas").getContext("2d",{willReadFrequently:true});const lum=(x)=>{c.clearRect(0,0,1,1);c.fillStyle=x;c.fillRect(0,0,1,1);const [r,g,bl]=[...c.getImageData(0,0,1,1).data].map(v=>{v/=255;return v<=0.03928?v/12.92:((v+0.055)/1.055)**2.4});return 0.2126*r+0.7152*g+0.0722*bl};const [x,y]=[lum(a),lum(b)].sort((p,q)=>q-p);return (x+0.05)/(y+0.05)})`;
const assignee = `document.querySelector('[aria-label="Assignee filter"]')`;
const row = (name: string) =>
  `[...${assignee}.querySelectorAll("[cmdk-item]")].find(r=>r.textContent.includes(${JSON.stringify(name)}))`;

test("Filter menu looks like Linear: visible checkboxes, counts and avatar photos", async ({
  open,
}) => {
  const page = await open();
  for (const scheme of ["dark", "light"] as const) {
    await test.step(`${scheme}: the Assignee submenu lists none, me, then people with photos and counts`, async () => {
      await page.page.emulateMedia({ colorScheme: scheme });
      await page.click('[aria-label="Add filter"]');
      await page.hover("text=Assignee");
      await page.waitFor(`!!document.querySelector('[aria-label="Filter Assignee"]')`);
      const names = await page.eval(
        `[...${assignee}.querySelectorAll("[cmdk-item]")].map(r=>r.innerText.replace(/\\s*\\d+ issues?$/,"").trim())`,
      );
      expect(names).toEqual(["No assignee", "Current user", "Alex"]);
      expect(await page.eval(`${row("Alex")}.querySelector(".menu-hint")?.textContent`)).toMatch(
        /^\d+ issues?$/,
      );
      // Alex's photo loads through the same-origin proxy (the broken-URL fallback is checked in mentions).
      await page.waitFor(
        `(()=>{const i=${row("Alex")}.querySelector("img");return !!i&&i.complete&&i.naturalWidth>0&&getComputedStyle(i).opacity==="1"})()`,
      );
      expect(await page.eval(`${row("Alex")}.querySelector("img").getAttribute("src")`)).toMatch(
        /^\/api\/avatar\?url=/,
      );
    });
    await test.step(`${scheme}: the checkbox shows on the active row with readable contrast and fills when checked`, async () => {
      await page.hover('[aria-label="Filter Assignee"]');
      await page.hover(`[aria-label="Assignee filter"] [cmdk-item]:nth-of-type(3)`);
      const box = `${row("Alex")}.querySelector(".menu-checkbox")`;
      await page.waitFor(`getComputedStyle(${box}).opacity==="1"`);
      expect(
        await page.eval(
          `getComputedStyle(${row("Current user")}.querySelector(".menu-checkbox")).opacity`,
        ),
      ).toBe("0");
      const ratio = await page.eval(
        `${contrast}(getComputedStyle(${box}).borderTopColor,getComputedStyle(${assignee}.querySelector(".filter-menu")??${assignee}).backgroundColor)`,
      );
      expect(ratio).toBeGreaterThanOrEqual(3);
      expect((await page.rect(`[aria-label="Assignee filter"] .menu-checkbox`)).width).toBe(14);
      await page.click(`[aria-label="Assignee filter"] [cmdk-item]:nth-of-type(3)`);
      await page.waitFor(`${row("Alex")}.getAttribute("aria-checked")==="true"`);
      await page.hover('[aria-label="Filter Assignee"]'); // move off the row: a checked box stays visible
      expect(await page.eval(`getComputedStyle(${box}).opacity`)).toBe("1");
      expect(
        await page.eval(
          `${contrast}(getComputedStyle(${box}).backgroundColor,getComputedStyle(${assignee}.querySelector(".filter-menu")??${assignee}).backgroundColor)`,
        ),
      ).toBeGreaterThanOrEqual(3);
      await page.key("Escape");
      await page.click('[aria-label="Remove assignee filter"]');
      await page.waitFor(`${cards}===6`);
    });
  }
  await test.step("cards show the assignee photo, with initials when the photo fails", async () => {
    await page.waitFor(
      `[...document.querySelectorAll('[data-key] img[src^="/api/avatar"]')].some(i=>i.complete&&i.naturalWidth>0)`,
    );
  });
});

/** Opens the app with these filters already applied on the fixture board. */
const seeded = (children: object[]) => {
  const prefs = { 1: { filters: { id: "root", join: "and", children } } };
  return `if(!sessionStorage.seeded){sessionStorage.seeded=1;localStorage.setItem(${JSON.stringify(PREFS_KEY)},${JSON.stringify(JSON.stringify(prefs))});}`;
};
const items = (scope: string) =>
  `[...document.querySelectorAll('${scope} [cmdk-item]')].map(r=>r.textContent)`;
const chipText = (field: string) =>
  `document.querySelector('[aria-label="Remove ${field} filter"]').closest(".view-filter-chip").textContent`;

test("Add filter root search ranks every row and opens like Linear's", async ({ open }) => {
  const page = await open();
  await test.step("FILTER-15: a click opens the menu pristine; F highlights the first row", async () => {
    await page.click('[aria-label="Add filter"]');
    await page.waitFor(`document.activeElement===${root}`);
    expect(await page.eval(`${root}.closest("[cmdk-root]").hasAttribute("data-pristine")`)).toBe(true);
    await page.key("Escape");
    await page.waitFor(`!${root}`);
    await page.key("f");
    await page.waitFor(`document.activeElement===${root}`);
    expect(await page.eval(`${root}.closest("[cmdk-root]").hasAttribute("data-pristine")`)).toBe(false);
  });
  await test.step("FILTER-5: values rank with categories by Linear's score, from 2 characters, by their label", async () => {
    await page.type("t");
    expect(await page.eval(`[...document.querySelectorAll("[cmdk-item]")].some(r=>r.textContent.includes("Todo")&&r.textContent.includes("Status"))`)).toBe(false);
    await page.type("o");
    await page.waitFor(`${items("")}[0]?.startsWith("StatusTodo")`);
    expect(await page.eval(`document.querySelector("[cmdk-item][data-selected=true]").textContent`)).toMatch(/^StatusTodo/);
    await page.key("a", "Meta");
    await page.type("revi");
    await page.waitFor(`${items("")}.length===1`);
    expect(await page.eval(`${items("")}[0]`)).toMatch(/^StatusReview/);
    await page.key("a", "Meta");
    await page.type("asign");
    await page.waitFor(`${items("")}[0]==="Assignee"`);
    await page.key("a", "Meta");
    await page.type("overdu");
    await page.waitFor(`${items("")}[0]?.startsWith("DatesDue dateOverdue")`);
  });
  await test.step("FILTER-3: a search that matches nothing says so", async () => {
    await page.key("a", "Meta");
    await page.type("zzqx");
    await page.waitFor(`document.querySelector(".menu-empty")?.textContent==="No matching options"`);
    await page.key("Escape");
  });
});

test("Add filter submenus: side, width, empty text, single and Alt selection", async ({ open }) => {
  const page = await open();
  await test.step("FILTER-16: a value submenu keeps its opening width while you type", async () => {
    await page.click('[aria-label="Add filter"]');
    await page.hover("text=Assignee");
    await page.hover('[aria-label="Filter Assignee"]');
    const before = await page.rect('[role=dialog][aria-label="Assignee filter"]');
    await page.type("alex");
    await page.waitFor(`${items('[aria-label="Assignee filter"]')}.length===1`);
    const after = await page.rect('[role=dialog][aria-label="Assignee filter"]');
    expect([after.width, after.left]).toEqual([before.width, before.left]);
    await page.key("Escape");
  });
  await test.step("FILTER-20: a value submenu names its field when nothing matches", async () => {
    await page.click('[aria-label="Add filter"]');
    await page.hover("text=Status");
    await page.hover('[aria-label="Filter Status"]');
    await page.type("zzz");
    await page.waitFor(
      `document.querySelector('[aria-label="Status filter"] .menu-empty')?.textContent==="No matching statuses"`,
    );
    await page.key("Escape");
  });
  await test.step("FILTER-20b: a search that matches nothing keeps the submenu in place and open under the pointer", async () => {
    await page.click('[aria-label="Add filter"]');
    await page.hover("text=Assignee");
    await page.hover('[aria-label="Filter Assignee"]');
    const before = await page.rect('[role=dialog][aria-label="Assignee filter"]');
    await page.type("zzz");
    await page.waitFor(`document.querySelector('[aria-label="Assignee filter"] .menu-empty')`);
    await new Promise((done) => setTimeout(done, 300));
    const after = await page.rect('[role=dialog][aria-label="Assignee filter"]');
    expect([after.top, after.left, after.width]).toEqual([before.top, before.left, before.width]);
    await page.key("Escape");
  });
  await test.step("FILTER-22: Alt-click replaces the selection with only that value", async () => {
    await page.click('[aria-label="Add filter"]');
    await page.hover("text=Priority");
    await page.hover('[aria-label="Filter Priority"]');
    await page.click('[aria-label="Priority filter"] [cmdk-item][data-value="High High"]');
    await page.waitFor(`${cards}===1`);
    await page.locate('[aria-label="Priority filter"] [cmdk-item][data-value="Low Low"]').click({ modifiers: ["Alt"] });
    await page.waitFor(`${cards}===2`);
    expect(
      await page.eval(`document.querySelector('[aria-label="Priority filter"] [data-value="High High"]').getAttribute("aria-checked")`),
    ).toBe("false");
    await page.key("Escape");
    await page.click('[aria-label="Remove priority filter"]');
    await page.waitFor(`${cards}===6`);
  });
  await test.step("FILTER-11: a relation is single-select: picking applies it and closes, and its row shows a checkmark", async () => {
    await page.click('[aria-label="Add filter"]');
    await page.hover("text=Relations");
    await page.hover('[aria-label="Filter Relations"]');
    expect(await page.eval(`document.querySelector('[aria-label="Relations filter"] [cmdk-item][aria-checked]')`)).toBe(null);
    await page.click('[aria-label="Relations filter"] [cmdk-item][data-value^="Blocked issues"]');
    await page.waitFor(`!${root}&&!!document.querySelector('[aria-label="Remove relations filter"]')`);
    await page.click('[aria-label="relations value"]');
    await page.waitFor(
      `!!document.querySelector('[role=dialog][aria-label="Relations value"] [cmdk-item][data-value^="Blocked issues"] .menu-checkmark')`,
    );
    await page.click('[role=dialog][aria-label="Relations value"] [cmdk-item][data-value^="Sub-issues"]');
    await page.waitFor(
      `!document.querySelector('[role=dialog][aria-label="Relations value"]')&&${chipText("relations")}.endsWith("Sub-issues")`,
    );
  });
});

test("Filter chips: the value menu is the submenu's list, operators read like Linear's, F opens the chip row", async ({ open }) => {
  const page = await open("", {
    setup: seeded([
      { id: "p", field: "priority", op: "is", values: ["Normal"] },
      { id: "s", field: "status", op: "is", values: ["todo"] },
      { id: "l", field: "labels", op: "is", values: ["ui", "test"] },
    ]),
  });
  await page.waitFor(`${cards}===2`);
  await test.step("FILTER-12: several values read 'is any of'; labels read 'include any of'", async () => {
    expect(await page.eval(chipText("labels"))).toBe("Labelsinclude any of2 labels");
  });
  await test.step("FILTER-2 and FILTER-18: the chip's values count the board under the other filters, picked first, titled by the field", async () => {
    await page.click('[aria-label="status value"]');
    await page.waitFor(`document.activeElement?.getAttribute("placeholder")==="Status"`);
    const rows = await page.eval<string[]>(items('[role=dialog][aria-label="Status value"]'));
    expect(rows[0]).toBe("Todo2 issues");
    await page.type("zzz");
    await page.waitFor(
      `document.querySelector('[role=dialog][aria-label="Status value"] .menu-empty')?.textContent==="No matching statuses"`,
    );
    await page.key("Escape");
  });
  await test.step("FILTER-19: the operator menu opens pristine from a click and filters as you type", async () => {
    await page.click('[aria-label="priority operator"]');
    await page.waitFor(`document.activeElement?.getAttribute("placeholder")==="is"`);
    expect(
      await page.eval(`document.querySelector('[role=dialog][aria-label="Priority operator"] [cmdk-root]').hasAttribute("data-pristine")`),
    ).toBe(true);
    await page.type("not");
    await page.waitFor(`${items('[role=dialog][aria-label="Priority operator"]')}.join()==="is not,is not empty"`);
    await page.key("Escape");
  });
  await test.step("FILTER-9 and FILTER-8: F opens the chip row's +, whose submenus open to its right", async () => {
    await page.eval("document.activeElement?.blur()");
    await page.key("f");
    await page.waitFor(`document.querySelector('.view-filter-add')?.getAttribute("aria-expanded")==="true"`);
    expect(
      await page.eval(`[...document.querySelectorAll('[aria-label="Add another filter"][aria-expanded=true]')].map(b=>b.classList.contains("view-filter-add"))`),
    ).toEqual([true]);
    await page.hover("text=Status");
    await page.waitFor(`!!document.querySelector('[aria-label="Filter Status"]')`);
    const parent = await page.rect('[aria-label="Add Filter…"]');
    const child = await page.rect('[role=dialog][aria-label="Status filter"]');
    expect(child.left).toBeGreaterThanOrEqual(parent.right - 4);
  });
});

test("5.3 5.4: Priority and Labels list the site's every value; ten or more split off the unmatched behind Linear's footer", async ({ open }) => {
  // The site's catalog loads on a writable site.
  await fixture.reset({
    writable: true,
    catalog: {
      priorities: ["Urgent", "High", "Normal", "Low", "Lowest"],
      labels: ["alpha", "beta", "gamma", "delta", "epsilon", "zeta", "eta", "theta", "iota", "kappa"],
    },
  });
  const page = await open();
  const values = (menu: string) =>
    `[...document.querySelectorAll('[aria-label="${menu} filter"] [cmdk-item]')].map(n=>n.querySelector('.menu-name')?.textContent)`;
  await test.step("Priority: every priority, the unused Lowest included, inline (fewer than ten options)", async () => {
    await page.click('[aria-label="Add filter"]');
    await page.hover("text=Priority");
    await page.waitFor(`${values("Priority")}.includes('Lowest')`);
    expect(await page.eval(values("Priority"))).toEqual(["No priority", "Urgent", "High", "Normal", "Low", "Lowest"]);
    await page.key("Escape");
  });
  await test.step("Labels: matched first, the rest behind the footer, then after a divider with no counts", async () => {
    await page.click('[aria-label="Add filter"]');
    await page.hover("text=Labels");
    const footer = '[aria-label="Labels filter"] [cmdk-item][data-value="Show 11 options with no matches"]';
    await page.waitFor(`!!document.querySelector('${footer}')`);
    expect(await page.eval(values("Labels"))).toEqual(["test", "ui", "Show 11 options with no matches"]);
    await page.click(footer);
    await page.waitFor(`${values("Labels")}.includes('alpha')`);
    expect(await page.eval(values("Labels"))).toEqual(
      ["test", "ui", "No labels", "alpha", "beta", "delta", "epsilon", "eta", "gamma", "iota", "kappa", "theta", "zeta"],
    );
    expect(await page.eval(`!!document.querySelector('[aria-label="Labels filter"] [cmdk-separator]')`)).toBe(true);
    expect(
      await page.eval(`[...document.querySelectorAll('[aria-label="Labels filter"] [cmdk-item]')].find(n=>n.textContent.startsWith('alpha')).querySelector('.menu-hint')`),
    ).toBe(null);
  });
});
