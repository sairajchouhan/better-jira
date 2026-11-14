import { expect, test, PREFS_KEY, type App } from "./app";

// Right-click menus on the chrome and on group headers, as Linear builds them (startup-root.CnUSfl4j.js `yPn`, `O$n`, `g3`, `Api`, `Ffr`;
// IssueList.CUOYX8Am.js `qu`; useListContextualActions.C9ILezPv.js `h`; CollapseListGroupButton `x`/`S`; useGroupingMenu `d`,
// useOrderingMenu `_`). Row names come from src/client/features/navigation/sidebar-menus.ts
// and personal-controls.tsx `groupMenuEntries`.
const NAV = 'nav[aria-label="Main navigation"]';
const menu = (label: string) => `[role="dialog"][aria-label="${label}"]`;
const rows = (page: App, label: string) =>
  page.eval<string[]>(`[...document.querySelectorAll('${menu(label)} [cmdk-item]')].map(n=>n.dataset.value)`);

/** A real right button press on the first element matching `locator`, as Chrome fires `contextmenu` from it. */
async function rightClick(page: App, target: ReturnType<App["page"]["locator"]>, label: string) {
  await target.first().click({ button: "right" });
  await expect(page.page.locator(menu(label))).toBeVisible();
}

test("sidebar Inbox, My issues, board rows and the empty sidebar open Linear's menus on right-click", async ({ open }) => {
  const page = await open("/board/1/all");
  const link = (name: string) => page.page.locator(`${NAV} a`, { hasText: name });

  await test.step("Inbox: Visibility ▸, Customize sidebar, then the link rows (Mark all first while anything is unread)", async () => {
    await rightClick(page, link("Inbox"), "Inbox options");
    const names = await rows(page, "Inbox options");
    expect(names.filter((n) => n !== "Mark all notifications as read")).toEqual([
      "Visibility",
      "Customize sidebar",
      "Copy link",
      "Open in new tab",
    ]);
    expect(names.indexOf("Mark all notifications as read")).toBeLessThanOrEqual(0);
    await page.key("Escape");
  });

  await test.step("My issues: Customize sidebar opens the dialog", async () => {
    await rightClick(page, link("My issues"), "My issues options");
    expect(await rows(page, "My issues options")).toEqual(["Visibility", "Customize sidebar", "Copy link", "Open in new tab"]);
    await page.click(`${menu("My issues options")} [cmdk-item][data-value="Customize sidebar"]`);
    await expect(page.page.locator(menu("Customize sidebar"))).toBeVisible();
    await page.key("Escape");
  });

  await test.step("a board row: Linear's team row with what Jira backs", async () => {
    await rightClick(page, link("Browser audit"), "Space options");
    const names = await rows(page, "Space options");
    expect(names.slice(0, 3)).toEqual([expect.stringMatching(/^(Un)?[Ff]avorite$/), "Board settings", "Copy URL"]);
    await page.key("Escape");
  });

  await test.step("the sidebar's empty space: the hidden items, then Customize sidebar", async () => {
    // Just above Help, which sits at the sidebar's foot (mt-auto) below its empty space.
    const help = await page.rect("#help-menu");
    await page.page.mouse.click(help.x + help.width / 2, help.y - 24, { button: "right" });
    await expect(page.page.locator(menu("Sidebar options"))).toBeVisible();
    expect(await rows(page, "Sidebar options")).toEqual(["Customize sidebar"]);
    await page.key("Escape");
  });
});

test("a board column header opens its ⋯ menu on right-click", async ({ open }) => {
  const page = await open("/board/1/all");
  await rightClick(page, page.page.locator('[data-board-column="Todo"] h2'), "Column Todo");
  expect(await rows(page, "Column Todo")).toEqual(["Select all in column", "Hide column"]);
});

test("a list group header opens Linear's list group menu on right-click, and Collapse collapses it", async ({ open }) => {
  const page = await open("/board/1/all", {
    setup: `localStorage.setItem(${JSON.stringify(PREFS_KEY)},JSON.stringify({1:{display:{layout:'list'}}}))`,
  });
  const header = page.page.locator('section:has(button[aria-label="Collapse Todo"]) > div').first();
  await rightClick(page, header, "Group Todo");
  expect(await rows(page, "Group Todo")).toEqual(["Collapse", "Collapse all", "Select all in group", "Hide group"]);
  await page.click(`${menu("Group Todo")} [cmdk-item][data-value="Collapse"]`);
  await expect(page.page.locator('button[aria-label="Expand Todo"]')).toBeVisible();
});

const LIST_SETUP = `localStorage.setItem(${JSON.stringify(PREFS_KEY)},JSON.stringify({1:{display:{layout:'list'}}}))`;
const stored = `JSON.parse(localStorage.getItem(${JSON.stringify(PREFS_KEY)})??"{}")[1]`;
const expanded = `[...document.querySelectorAll('main button[aria-label^="Collapse "][aria-expanded="true"]')].length`;
const collapsedCount = `[...document.querySelectorAll('main button[aria-label^="Expand "][aria-expanded="false"]')].length`;

test("C11: ⌥-click on a group's chevron and its Collapse all / Expand all toggle every group from that group's state", async ({ open }) => {
  const page = await open("/board/1/all", { setup: LIST_SETUP });
  const groups = await page.eval<number>(expanded);
  expect(groups).toBeGreaterThan(1);

  await test.step("the chevron's tooltip is Linear's two lines", async () => {
    await expect(page.page.locator('button[aria-label="Collapse Todo"] span[title]')).toHaveAttribute(
      "title",
      /^\(T\) to collapse group\n\((⌥|Alt) click\) to collapse all$/,
    );
  });

  await test.step("⌥-click on an open group collapses every group", async () => {
    await page.page.locator('button[aria-label="Collapse Todo"]').click({ modifiers: ["Alt"] });
    await page.waitFor(`${collapsedCount}===${groups}`);
  });

  await test.step("one group open again, then Expand all from a collapsed group opens every group", async () => {
    await page.click('button[aria-label="Expand Todo"]');
    const other = page.page.locator('main button[aria-label^="Expand "][aria-expanded="false"]').first();
    const name = (await other.getAttribute("aria-label"))!.replace(/^Expand /, "");
    await rightClick(page, page.page.locator(`[data-list-group="${name}"]`), `Group ${name}`);
    expect((await rows(page, `Group ${name}`)).slice(0, 2)).toEqual(["Expand", "Expand all"]);
    await page.click(`${menu(`Group ${name}`)} [cmdk-item][data-value="Expand all"]`);
    await page.waitFor(`${expanded}===${groups}`);
  });
});

test("C12: ⌥⇧G and ⌥⇧O open the grouping and ordering choices without the Display menu; ⌘K lifts them as you type", async ({ open }) => {
  const page = await open("/board/1/all", { setup: LIST_SETUP });

  await test.step("⌥⇧G: Change grouping, the current grouping checked; picking Assignee regroups the list", async () => {
    await page.key("KeyG", "alt", "shift");
    const dialog = page.page.locator(menu("Change grouping"));
    await expect(dialog).toBeVisible();
    await expect(dialog.locator("[cmdk-item]", { hasText: /^Status$/ }).locator(".menu-checkmark")).toBeVisible();
    await dialog.locator("[cmdk-item]", { hasText: /^Assignee$/ }).click();
    await expect(dialog).toBeHidden();
    await page.waitFor(`${stored}?.display?.columns==="assignee"`);
  });

  await test.step("⌥⇧O: View ordering…, Manual then By <field>; picking By title orders by title", async () => {
    await page.key("KeyO", "alt", "shift");
    const dialog = page.page.locator(menu("View ordering…"));
    await expect(dialog).toBeVisible();
    const names = await dialog.locator("[cmdk-item]").allTextContents();
    expect(names.slice(0, 2)).toEqual(["Manual", "By title"]);
    await dialog.locator("[cmdk-item]", { hasText: /^By title$/ }).click();
    await page.waitFor(`${stored}?.display?.ordering==="title"`);
  });

  await test.step("⌘K: Change grouping lists from 2 characters, View ordering's values from 5", async () => {
    await page.key("k", "meta");
    await page.type("prio");
    const palette = page.page.locator(menu("Search issues and commands"));
    await expect(palette.locator("[cmdk-item]", { hasText: "Change grouping › Priority" })).toBeVisible();
    await expect(palette.locator("[cmdk-item]", { hasText: "View ordering › By priority" })).toHaveCount(0);
    await page.type("r");
    await expect(palette.locator("[cmdk-item]", { hasText: "View ordering › By priority" })).toBeVisible();
    await page.key("Escape");
  });

  await test.step("the Display menu's Grouping and Ordering labels name their commands and shortcuts", async () => {
    await page.key("V", "shift");
    await expect(page.page.locator('[data-label="row"][title^="Change grouping ("]')).toHaveText("Grouping");
    await expect(page.page.locator('[data-label="row"][title^="View ordering… ("]')).toHaveText("Ordering");
  });
});

test("the open issue's breadcrumb opens the copy rows and Rename… on right-click", async ({ open }) => {
  const page = await open("/issue/TEST-1");
  await rightClick(page, page.page.locator('nav[aria-label="Breadcrumb"] a[aria-current="page"]'), "Issue options");
  const names = await rows(page, "Issue options");
  expect(names[0]).toBe("Copy ID");
  expect(names.at(-1)).toBe("Rename…");
});
