/** QA round 1, group G7: board, filters and display. */
import { afterAll, expect, test } from "bun:test";
import { APP, open, PREFS_KEY, stop } from "./harness";

afterAll(stop);

const seed = (prefs: object, extra = "") =>
  `if(!sessionStorage.seeded){sessionStorage.seeded=1;localStorage.setItem(${JSON.stringify(PREFS_KEY)},${JSON.stringify(JSON.stringify(prefs))});${extra}}`;
/** Views that show no cards: seed after the first load, since `open` waits for a card. */
async function openEmpty(prefs: object) {
  const page = await open();
  await page.eval(
    `localStorage.setItem(${JSON.stringify(PREFS_KEY)},${JSON.stringify(JSON.stringify(prefs))})`,
  );
  await page.eval("location.reload()");
  await page.waitFor(
    `!!document.querySelector('[aria-label="Add filter"]')&&!document.querySelector("[data-key]")`,
  );
  return page;
}
const chips = `[...document.querySelectorAll("button.truncate")].map(b=>b.textContent)`;
const cards = `document.querySelectorAll("[data-key]").length`;

test("R1-D56: My issues lives in the URL, survives reload, and names itself in the breadcrumb", async () => {
  const page = await open();
  try {
    await page.waitFor(`${cards}===6`);
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
  } finally {
    await page.close();
  }
});

test("R1-D58/D59: swimlane titles stay pinned left, and the lane + prefills the lane's property", async () => {
  const page = await open("", {
    setup: seed({ 1: { display: { rows: "priority" } } }),
    width: 800,
  });
  try {
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
  } finally {
    await page.close();
  }
});

test("R1-D50/D94: cards show Linear's short dates and no PR placeholder", async () => {
  const properties = ["id", "updated", "due", "pullRequests"];
  const page = await open("", { setup: seed({ 1: { display: { properties } } }) });
  try {
    await page.waitFor(`${cards}===6`);
    const text = await page.eval<string>(
      `document.querySelector('[data-key="TEST-1"]').textContent`,
    );
    expect(text).toContain("Updated Nov 6");
    expect(text).not.toContain("2026");
    expect(text).not.toContain("PRs");
  } finally {
    await page.close();
  }
});

test("R1-D40/D87/D93: chip text reads naturally, empty groups get no chip, and is empty drops stale values", async () => {
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
  const page = await openEmpty({ 1: { filters } });
  try {
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
  } finally {
    await page.close();
  }
});

test("R1-D93: Done returns focus to the filter button; pill menus open on the current choice", async () => {
  const page = await open("", {
    setup: seed({ 1: { display: { layout: "list", columns: "priority" } } }),
  });
  try {
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
  } finally {
    await page.close();
  }
});

test("R1-D89: a board-details bucket shows as active and toggles its filter off", async () => {
  const page = await open();
  try {
    await page.waitFor(`${cards}===6`);
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
  } finally {
    await page.close();
  }
});

test("R1-D92: an empty view counts the issues filters hide and clears them", async () => {
  const filters = {
    id: "root",
    join: "and",
    children: [{ id: "a", field: "labels", op: "is", values: ["none-such"] }],
  };
  const page = await openEmpty({ 1: { filters } });
  try {
    await page.waitFor(
      `document.querySelector("[role=status]")?.textContent.includes("6 issues hidden by filters")`,
    );
    await page.click("text=Clear filters");
    await page.waitFor(`${cards}===6`);
  } finally {
    await page.close();
  }
});

test("R1-D94: removing a saved view asks first", async () => {
  const view = { id: "v1", board: 1, name: "Mine", mine: false, preferences: {} };
  const key = PREFS_KEY.replace("views:v1", "saved-views:v1");
  const page = await open("", {
    setup: seed(
      {},
      `localStorage.setItem(${JSON.stringify(key)},${JSON.stringify(JSON.stringify([view]))});`,
    ),
  });
  try {
    await page.waitFor(`!!document.querySelector('[aria-label="Edit view Mine"]')`);
    await page.eval(`window.confirm=()=>(window.asked=true,false)`);
    await page.click('[aria-label="Edit view Mine"]');
    await page.click("text=Remove view");
    expect(await page.eval(`window.asked`)).toBe(true);
    expect(await page.eval(`!!document.querySelector('[aria-label="Edit view Mine"]')`)).toBe(true);
  } finally {
    await page.close();
  }
});

test("R1-D95/D96: a layout switch paints the first screenful at once and the rest right after", async () => {
  const page = await open();
  try {
    await fetch(`${APP}__fixture`, { method: "POST", body: JSON.stringify({ bulk: 90 }) });
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
  } finally {
    await fetch(`${APP}__fixture`, { method: "POST", body: "{}" });
    await page.close();
  }
});
