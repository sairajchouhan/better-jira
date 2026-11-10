/** QA round 1, group G7: board, filters and display. */
import { expect, test, PREFS_KEY, fixture, type App as Page } from "./app";

const seed = (prefs: object, extra = "") =>
  `if(!sessionStorage.seeded){sessionStorage.seeded=1;localStorage.setItem(${JSON.stringify(PREFS_KEY)},${JSON.stringify(JSON.stringify(prefs))});${extra}}`;
const chips = `[...document.querySelectorAll("button.truncate")].map(b=>b.textContent)`;
const cards = `document.querySelectorAll("[data-key]").length`;
/** Reloads the page with these view preferences. A view that shows no cards (`empty`) is waited for by its filter bar,
 *  since `reload` waits for a card. */
async function show(page: Page, prefs: object, empty = false) {
  await page.eval(
    `localStorage.setItem(${JSON.stringify(PREFS_KEY)},${JSON.stringify(JSON.stringify(prefs))})`,
  );
  if (!empty) return page.reload();
  await page.page.reload();
  await page.waitFor(
    `!!document.querySelector('[aria-label="Add filter"]')&&!document.querySelector("[data-key]")`,
  );
}

test("the default board: My issues, board details, saved views and a fast layout switch", async ({
  open,
}) => {
  const page = await open();
  await page.waitFor(`${cards}===6`);
  await test.step("R1-D56: My issues lives in the URL, survives reload, and names itself in the breadcrumb", async () => {
    await page.eval(
      `[...document.querySelectorAll("nav button")].find(b=>b.textContent.includes("My issues")).click()`,
    );
    await page.waitFor(`new URLSearchParams(location.search).get("mine")==="1"`);
    await page.eval("location.reload()");
    await page.waitFor(
      `!!document.querySelector('[aria-label="Breadcrumb"] [aria-label="My issues"]')`,
    );
    expect(await page.eval(cards)).toBe(0); // no fixture issue is assigned to the user
    await page.eval("history.back()");
    await page.waitFor(`${cards}===6`);
    expect(await page.eval(`new URLSearchParams(location.search).has("mine")`)).toBe(false);
  });
  await test.step("R1-D89: a board-details bucket shows as active and toggles its filter off", async () => {
    await page.click('[aria-label="Open details"]');
    await page.click("text=Alex1");
    await page.waitFor(`${cards}===1`);
    expect(
      await page.eval(
        `document.querySelector('[aria-label="Board details"] [aria-pressed=true]')?.textContent`,
      ),
    ).toBe("Alex1");
    await page.click("text=Alex1");
    await page.waitFor(`${cards}===6`);
  });
  await test.step("R1-D94: removing a saved view asks first", async () => {
    const view = { id: "v1", board: 1, name: "Mine", mine: false, preferences: {} };
    const key = PREFS_KEY.replace("views:v1", "saved-views:v1");
    await page.eval(
      `localStorage.setItem(${JSON.stringify(key)},${JSON.stringify(JSON.stringify([view]))})`,
    );
    await page.reload();
    await page.waitFor(`!!document.querySelector('[aria-label="Edit view Mine"]')`);
    await page.eval(`window.confirm=()=>(window.asked=true,false)`);
    await page.click('[aria-label="Edit view Mine"]');
    await page.click("text=Remove view");
    expect(await page.eval(`window.asked`)).toBe(true);
    expect(await page.eval(`!!document.querySelector('[aria-label="Edit view Mine"]')`)).toBe(true);
    await page.key("Escape");
  });
  await test.step("R1-D95/D96: a layout switch paints the first screenful at once and the rest right after", async () => {
    await fixture.reset({ bulk: 90 });
    await page.reload();
    await page.waitFor(`${cards}===96`);
    // Count the cards the keypress commits, before the follow-up task fills the rest.
    await page.eval(
      `new MutationObserver((_,o)=>{if(document.querySelector("[data-layout=list]")){window.firstPaint=document.querySelectorAll("[data-key]").length;o.disconnect()}}).observe(document.querySelector("main"),{subtree:true,attributes:true,attributeFilter:["data-layout"]})`,
    );
    await page.key("b", "meta");
    await page.waitFor(
      `document.querySelector("[data-layout]").dataset.layout==="list"&&${cards}===96`,
    );
    expect(await page.eval<number>(`window.firstPaint`)).toBeLessThanOrEqual(30);
  });
});

test("display preferences: card dates, filter chips, empty views and pill menus", async ({
  open,
}) => {
  const page = await open();
  await test.step("R1-D50/D94: cards show Linear's short dates and no PR placeholder", async () => {
    await show(page, { 1: { display: { properties: ["id", "updated", "due", "pullRequests"] } } });
    await page.waitFor(`${cards}===6`);
    const text = await page.eval<string>(
      `document.querySelector('[data-key="TEST-1"]').textContent`,
    );
    expect(text).toContain("Updated Nov 6");
    expect(text).not.toContain("2026");
    expect(text).not.toContain("PRs");
  });
  await test.step("R1-D93: Done returns focus to the filter button; pill menus open on the current choice", async () => {
    await show(page, { 1: { display: { layout: "list", columns: "priority" } } });
    await page.waitFor(`${cards}===6`);
    await page.eval(`machines.ui.send({type:"toolbar.open",toolbar:"advanced"})`);
    await page.click("text=Done");
    await page.waitFor(`document.activeElement?.getAttribute("aria-label")==="Add filter"`);
    await page.click('[aria-label="Display options"]');
    await page.click('[aria-label="Grouping: Priority"]');
    await page.waitFor(`!!document.querySelector("[cmdk-item][data-selected=true]")`);
    expect(
      await page.eval(`document.querySelector("[cmdk-item][data-selected=true]").textContent`),
    ).toBe("Priority");
    await page.key("Escape");
  });
  await test.step("R1-D40/D87/D93: chip text reads naturally, empty groups get no chip, and is empty drops stale values", async () => {
    const filters = {
      id: "root",
      join: "and",
      children: [
        { id: "a", field: "due", op: "within", values: ["3"] },
        { id: "b", field: "statusAge", op: "lt", values: ["1"] },
        { id: "c", field: "created", op: "before", values: ["2026-11-08"] },
        { id: "d", field: "priority", op: "is", values: ["High"] },
        { id: "e", join: "or", children: [] },
        { id: "f", join: "or", children: [{ id: "g", field: "labels", op: "is", values: ["ui"] }] },
      ],
    };
    await show(page, { 1: { filters } }, true);
    await page.waitFor(`document.querySelectorAll("button.truncate").length===5`);
    expect(await page.eval(chips)).toEqual([
      "Due date in the last 3 days",
      "Time in current status less than 1 day",
      "Created date before Nov 8",
      "Priority is High",
      "OR group · 1 rule",
    ]);
    await page.click("text=Priority is High");
    await page.click('[aria-label="Priority operator"] [aria-pressed=false]:nth-last-child(2)');
    await page.waitFor(`${chips}.includes("Priority is empty")`);
    await page.key("Escape");
  });
  await test.step("R1-D92: an empty view counts the issues filters hide and clears them", async () => {
    const filters = {
      id: "root",
      join: "and",
      children: [{ id: "a", field: "labels", op: "is", values: ["none-such"] }],
    };
    await show(page, { 1: { filters } }, true);
    await page.waitFor(
      `document.querySelector("[role=status]")?.textContent.includes("6 issues hidden by filters")`,
    );
    await page.click("text=Clear filters");
    await page.waitFor(`${cards}===6`);
  });
  await test.step("R1-D58/D59: swimlane titles stay pinned left, and the lane + prefills the lane's property", async () => {
    const page = await open("", {
      setup: seed({ 1: { display: { rows: "priority" } } }),
      width: 800,
    });
    await page.waitFor(`${cards}===6`);
    const title = `[...document.querySelectorAll(".sticky.left-0")].find(n=>n.textContent.startsWith("High"))`;
    const left = await page.eval<number>(`${title}.getBoundingClientRect().left`);
    const scroller = `document.querySelector("h2").closest(".overflow-auto")`;
    expect(
      await page.eval<number>(`(${scroller}.scrollLeft=1e5,${scroller}.scrollLeft)`),
    ).toBeGreaterThan(100);
    expect(await page.eval<number>(`${title}.getBoundingClientRect().left`)).toBe(left);
    await page.click('[aria-label="New issue in High"]');
    await page.waitFor(`machines.ui.getSnapshot().context.overlay==="create"`);
    expect(await page.eval(`machines.ui.getSnapshot().context.draft`)).toMatchObject({
      status: "todo",
      priority: "High",
    });
  });
});
