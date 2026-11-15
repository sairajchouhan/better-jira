/** QA round 2: views and filters. */
import { expect, test, sleep, PREFS_KEY, PAGE_FILTERS_KEY } from "./app";

const root = `document.querySelector('[aria-label="Add Filter…"]')`;
const chips = `[...document.querySelectorAll(".ui-filter-block")].map(b=>b.textContent)`;
const stored = `JSON.parse(localStorage.getItem(${JSON.stringify(PREFS_KEY)})??"{}")[1]`;
/** Board 1's All issues temporary filter, as stored (shared/page-filters.ts). */
const storedFilter = `JSON.parse(localStorage.getItem(${JSON.stringify(PAGE_FILTERS_KEY)})??"{}")["board/1/all"]`;

test("filter menu: the first F after load opens it without a loading step, and the Overdue preset saves a relative filter", async ({
  open,
}) => {
  const page = await open();
  await test.step("R2-D6: the first F after load opens the filter menu without a loading step", async () => {
    await sleep(800); // the menu preloads once the browser is idle
    await page.eval(
      `window.sawLoading=false;new MutationObserver(()=>{if(document.body.textContent.includes("Opening filters…"))window.sawLoading=true}).observe(document.body,{childList:true,subtree:true,characterData:true})`,
    );
    await page.eval(`document.activeElement?.blur()`);
    await page.key("f");
    await page.waitFor(`!!${root}`);
    expect(await page.eval(`window.sawLoading`)).toBe(false);
    await page.key("Escape");
    await page.waitFor(`!${root}`);
  });
  await test.step("R2-D3: the Overdue preset saves a relative filter and its chip reads Overdue", async () => {
    await page.click('[aria-label="Add filter"]');
    await page.hover("text=Dates");
    await page.waitFor(`!!document.querySelector('[aria-label="Filter Dates"]')`);
    await page.hover("text=Due date");
    await page.waitFor(`!!document.querySelector('input[aria-label="Due date"]')`);
    await page.click("text=Overdue");
    await page.waitFor(`${chips}.includes("Due datebeforeOverdue")`);
    await page.waitFor(`${storedFilter}?.children?.[0]?.values?.[0]==="P0D"`);
  });
});

test("R2-D4: a view=page link opens full page once and keeps the board's Open issues in", async ({
  open,
}) => {
  const page = await open("?board=1&issue=TEST-2&view=page");
  try {
    await page.waitFor(`machines.ui.getSnapshot().context.view==="page"`);
    await page.key("Escape");
    await page.waitFor(`!machines.ui.getSnapshot().context.panel`);
    await page.waitFor(`machines.ui.getSnapshot().context.view==="side"`);
    await page.click('[data-key="TEST-1"]');
    await page.waitFor(`machines.ui.getSnapshot().context.selected==="TEST-1"`);
    expect(await page.eval(`machines.ui.getSnapshot().context.view`)).toBe("side");
    expect(await page.eval(`${stored}?.display?.openIn ?? "side"`)).toBe("side");
  } finally {
    await page.close();
  }
});

test("R2-D5: a chip switched from is empty back to is and closed without a value is dropped", async ({
  open,
}) => {
  const filters = {
    id: "root",
    join: "and",
    children: [{ id: "p", field: "priority", op: "is", values: ["High"] }],
  };
  const page = await open("", {
    setup: `if(!sessionStorage.seeded){sessionStorage.seeded=1;localStorage.setItem(${JSON.stringify(PREFS_KEY)},${JSON.stringify(JSON.stringify({ 1: { filters } }))})}`,
  });
  try {
    await page.click('[aria-label="priority operator"]');
    await page.click('[role^=menuitem][data-value="empty"]'); // is empty
    await page.waitFor(`${chips}.includes("Priorityis empty")`);
    await page.click('[aria-label="priority operator"]');
    await page.click('[role^=menuitem][data-value="is"]'); // is
    await page.waitFor(`${chips}.includes("Priorityis")`);
    await page.key("Escape");
    await page.waitFor(`!${chips}.some(c=>c.startsWith("Priority"))`);
    expect(await page.eval(`${storedFilter}?.children?.length ?? 0`)).toBe(0);
  } finally {
    await page.close();
  }
});

// BJ-336: an empty page draws its own empty state in place of the columns, as Linear's IssueList draws only its
// placeholder (MyIssuesEmptyPage on My issues, ViewEmptyState on a board tab), never blank columns or Hidden columns.
test("an empty My issues tab and an empty board tab show their empty state, no columns", async ({ open }) => {
  const page = await open();
  try {
    await page.goto("/my-issues");
    await page.waitFor(`document.body.textContent.includes("No issues assigned to you")`);
    expect(await page.eval(`!!document.querySelector('aside[aria-label="Hidden columns"]')`)).toBe(false);
    expect(await page.eval(`document.querySelectorAll('[aria-label^="Options for"]').length`)).toBe(0);
    await page.goto("/board/1/backlog");
    await page.waitFor(`document.body.textContent.includes("Backlog issues")`);
    expect(await page.eval(`!!document.querySelector('aside[aria-label="Hidden columns"]')`)).toBe(false);
  } finally {
    await page.close();
  }
});
