import { expect, test, PREFS_KEY, type App } from "./app";

// Right-click menus on the chrome and on group headers, as Linear builds them (startup-root.CnUSfl4j.js `yPn`, `O$n`, `g3`, `Api`, `Ffr`;
// IssueList.CUOYX8Am.js `qu`; useListContextualActions.C9ILezPv.js `h`; CollapseListGroupButton `x`/`S`). Row names come from src/client/features/navigation/sidebar-menus.ts
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
    await rightClick(page, link("Browser audit"), "Board options");
    const names = await rows(page, "Board options");
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

test("the open issue's breadcrumb opens the copy rows and Rename… on right-click", async ({ open }) => {
  const page = await open("/issue/TEST-1");
  await rightClick(page, page.page.locator('nav[aria-label="Breadcrumb"] a[aria-current="page"]'), "Issue options");
  const names = await rows(page, "Issue options");
  expect(names[0]).toBe("Copy ID");
  expect(names.at(-1)).toBe("Rename…");
});
