import { expect, test, PREFS_KEY, type App } from "./app";

// Right-click menus on the chrome and on group headers, as Linear builds them (startup-root.CnUSfl4j.js `yPn`, `O$n`, `g3`, `Api`, `Ffr`;
// IssueList.CUOYX8Am.js `qu`; useListContextualActions.C9ILezPv.js `h`). Row names come from src/client/features/navigation/sidebar-menus.ts
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

test("the open issue's breadcrumb opens the copy rows and Rename… on right-click", async ({ open }) => {
  const page = await open("/issue/TEST-1");
  await rightClick(page, page.page.locator('nav[aria-label="Breadcrumb"] a[aria-current="page"]'), "Issue options");
  const names = await rows(page, "Issue options");
  expect(names[0]).toBe("Copy ID");
  expect(names.at(-1)).toBe("Rename…");
});
