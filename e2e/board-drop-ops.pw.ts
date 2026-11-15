/**
 * What a board drop writes to Jira (Fable's blocker 6): the rank op names the card shown beside the drop in its cell, an
 * empty cell sends only the status, and the card's own place sends nothing. Linear's handleIssuesDrop (`kFn`, `Vyt`, `HN`).
 * Drops are React Aria's keyboard drag, which reads every drop position by name; the mouse goes through the same plan
 * (routes/board-drop.ts, unit tested in board-drop.test.ts).
 *
 * Fixture board: Todo holds TEST-1, 2, 4, 5 and 6 in rank order, Doing holds TEST-3 (ranked between 2 and 4), Review is
 * empty and shown. TEST-1 is labelled `ui`, the rest `test`; TEST-2 is Alex's, the rest unassigned.
 */
import { expect, test, fixture, sleep, PREFS_KEY, type App } from "./app";

const seed = (prefs: object) =>
  `if(!sessionStorage.seeded){sessionStorage.seeded=1;localStorage.setItem(${JSON.stringify(PREFS_KEY)},${JSON.stringify(JSON.stringify({ 1: prefs }))});}`;
const SHOWN = { display: { emptyGroups: true } };
const FILTERED = { ...SHOWN, filters: { id: "root", join: "and", children: [{ id: "f1", field: "labels", op: "is", values: ["test"] }] } };
const LANES = { display: { emptyGroups: true, rows: "assignee" } };

/** The keyboard drag's current target: "Insert before TEST-3@Doing", "root@Review", or "none". */
const target = `(()=>{const gaps=[...document.querySelectorAll(".ui-drop-gap[data-drop-target] [aria-roledescription='drop indicator']")].map(b=>(b.getAttribute("aria-label")||"").replace(/ Browser fixture \\d| Rich browser fixture/g,"")+"@"+(b.closest("[role=grid]")?.getAttribute("aria-label")??""));const roots=[...document.querySelectorAll("[role=grid][data-drop-target]")].map(g=>"root@"+g.getAttribute("aria-label"));return [...gaps,...roots].join(",")||"none"})()`;
const cellKeys = (label: string) =>
  `[...(document.querySelector('[role=grid][aria-label=${JSON.stringify(label)}]')?.querySelectorAll("[data-key]")??[])].map(c=>c.dataset.key)`;

async function board(open: (path?: string, o?: object) => Promise<App>, prefs: object, cards = 6) {
  await fixture.reset({ writable: true });
  const page = await open("", { setup: seed(prefs), height: 1000 });
  await page.waitFor(`document.querySelectorAll("[data-key]").length===${cards}`);
  return page;
}

/** Picks `key` up with its drag handle (the row first: a column is one tab stop). */
async function pickUp(page: App, key: string) {
  await page.page.locator(`[role=row][data-key="${key}"]`).focus();
  await page.page.locator(`button[aria-label^="Drag ${key} "]`).focus();
  await page.key("Enter");
  await page.waitFor(`${target}!=="none"`);
}

/** Tabs to the cell, then steps ↓ to `want`, failing if the arrows never reach it. */
async function moveTo(page: App, cell: string, want: string) {
  for (let i = 0; i < 8 && !(await page.eval<string>(target)).endsWith(`@${cell}`); i++) await page.key("Tab");
  for (let i = 0; i < 12 && (await page.eval<string>(target)) !== want; i++) await page.key("ArrowDown");
  expect(await page.eval<string>(target)).toBe(want);
}

async function drop(page: App, key: string, cell: string, want: string) {
  await pickUp(page, key);
  await moveTo(page, cell, want);
  await page.key("Enter");
}

const writes = async () => (await fixture.log()).writes;
/** Waits for the one write a drop makes. */
const written = async () => {
  await expect.poll(async () => (await writes()).length, { timeout: 5000 }).toBe(1);
  return (await writes())[0];
};
/** A drop that writes nothing: the outbox has had time to send. */
const nothingWritten = async () => {
  await sleep(1500);
  expect(await writes()).toEqual([]);
};

test("a drop between two cards of another column ranks after the card shown above it", async ({ open }) => {
  const page = await board(open, SHOWN);
  await drop(page, "TEST-3", "Todo", "Insert between TEST-4 and TEST-5@Todo");
  expect(await written()).toEqual({ key: "TEST-3", ops: [{ op: "status", status: "todo" }, { op: "rank", after: "TEST-4" }] });
  expect(await page.waitFor<string[]>(`${cellKeys("Todo")}.length===6&&${cellKeys("Todo")}`)).toEqual([
    "TEST-1", "TEST-2", "TEST-4", "TEST-3", "TEST-5", "TEST-6",
  ]);
});

test("a drop at a column's top or bottom edge names that column's card, not another column's", async ({ open }) => {
  await test.step("top of Doing: before TEST-3, not before Todo's TEST-1", async () => {
    const page = await board(open, SHOWN);
    await drop(page, "TEST-5", "Doing", "Insert before TEST-3@Doing");
    expect(await written()).toEqual({ key: "TEST-5", ops: [{ op: "status", status: "doing" }, { op: "rank", before: "TEST-3" }] });
  });
  await test.step("bottom of Doing: after TEST-3, not after TEST-6, the board's last card", async () => {
    const page = await board(open, SHOWN);
    await drop(page, "TEST-2", "Doing", "Insert after TEST-3@Doing");
    expect(await written()).toEqual({ key: "TEST-2", ops: [{ op: "status", status: "doing" }, { op: "rank", after: "TEST-3" }] });
  });
});

test("a drop into an empty column changes only the status", async ({ open }) => {
  const page = await board(open, SHOWN);
  await drop(page, "TEST-4", "Review", "root@Review");
  expect(await written()).toEqual({ key: "TEST-4", ops: [{ op: "status", status: "review" }] });
});

test("a drop at the top of a filtered column ranks before the card shown, never the hidden one", async ({ open }) => {
  // The label filter hides TEST-1, so Todo shows TEST-2 first.
  const page = await board(open, FILTERED, 5);
  expect(await page.eval(cellKeys("Todo"))).toEqual(["TEST-2", "TEST-4", "TEST-5", "TEST-6"]);
  await drop(page, "TEST-6", "Todo", "Insert before TEST-2@Todo");
  expect(await written()).toEqual({ key: "TEST-6", ops: [{ op: "rank", before: "TEST-2" }] });
});

test("a drop in a swimlane ranks against the card shown above it in that lane's cell", async ({ open }) => {
  const page = await board(open, LANES);
  // TEST-2 is Alex's: the unassigned lane's Todo cell is TEST-1, 4, 5 and 6, so TEST-6 lands right after TEST-1.
  await drop(page, "TEST-6", "Todo, No assignee", "Insert between TEST-1 and TEST-4@Todo, No assignee");
  expect(await written()).toEqual({ key: "TEST-6", ops: [{ op: "rank", after: "TEST-1" }] });
});

test("a reorder within a column ranks after the card above; the card's own place sends nothing", async ({ open }) => {
  await test.step("TEST-6 between TEST-2 and TEST-4", async () => {
    const page = await board(open, SHOWN);
    await drop(page, "TEST-6", "Todo", "Insert between TEST-2 and TEST-4@Todo");
    expect(await written()).toEqual({ key: "TEST-6", ops: [{ op: "rank", after: "TEST-2" }] });
  });
  await test.step("TEST-4 dropped just above or just below itself", async () => {
    for (const spot of ["Insert between TEST-2 and TEST-4@Todo", "Insert between TEST-4 and TEST-5@Todo"]) {
      const page = await board(open, SHOWN);
      await drop(page, "TEST-4", "Todo", spot);
      await nothingWritten();
      expect(await page.eval(cellKeys("Todo"))).toEqual(["TEST-1", "TEST-2", "TEST-4", "TEST-5", "TEST-6"]);
    }
  });
});

test("keyboard drag: the arrows reach every drop position in order, and Escape puts focus back on the card", async ({ open }) => {
  const page = await board(open, SHOWN);
  await pickUp(page, "TEST-5");
  // React Aria starts after the dragged card. ↓ steps down through every gap and wraps to the top with no stop on the
  // column itself (that stop dropped at the end); ↑ walks back the same way.
  const down = ["Insert between TEST-5 and TEST-6@Todo"];
  for (let i = 0; i < 6; i++) {
    await page.key("ArrowDown");
    down.push(await page.eval<string>(target));
  }
  expect(down).toEqual([
    "Insert between TEST-5 and TEST-6@Todo",
    "Insert after TEST-6@Todo",
    "Insert before TEST-1@Todo",
    "Insert between TEST-1 and TEST-2@Todo",
    "Insert between TEST-2 and TEST-4@Todo",
    "Insert between TEST-4 and TEST-5@Todo",
    "Insert between TEST-5 and TEST-6@Todo",
  ]);
  const up: string[] = [];
  for (let i = 0; i < 6; i++) {
    await page.key("ArrowUp");
    up.push(await page.eval<string>(target));
  }
  expect(up).toEqual(down.slice(0, 6).toReversed());
  // Into Doing, then Escape: nothing moves, nothing is written, and focus is back on the card's handle, not <body>.
  await moveTo(page, "Doing", "Insert after TEST-3@Doing");
  await page.key("Escape");
  await page.waitFor(`${target}==="none"`);
  expect(await page.eval(`document.activeElement?.closest("[data-key]")?.dataset.key`)).toBe("TEST-5");
  expect(await page.eval(cellKeys("Todo"))).toEqual(["TEST-1", "TEST-2", "TEST-4", "TEST-5", "TEST-6"]);
  await nothingWritten();
});

test("a mouse drop writes the same ops: a card's top edge, and the blank space below a column's last card", async ({ open }) => {
  await test.step("onto TEST-3's top edge: before TEST-3", async () => {
    const page = await board(open, SHOWN);
    const at = await page.rect('[data-key="TEST-3"]');
    await page.drag('[data-key="TEST-5"]', at.x + at.width / 2, at.y + 4);
    expect(await written()).toEqual({ key: "TEST-5", ops: [{ op: "status", status: "doing" }, { op: "rank", before: "TEST-3" }] });
  });
  await test.step("below Doing's last card: after TEST-3, not after the board's last card", async () => {
    const page = await board(open, SHOWN);
    const at = await page.rect('[data-key="TEST-3"]');
    await page.drag('[data-key="TEST-2"]', at.x + at.width / 2, at.y + at.height + 60);
    expect(await written()).toEqual({ key: "TEST-2", ops: [{ op: "status", status: "doing" }, { op: "rank", after: "TEST-3" }] });
  });
  await test.step("back onto its own place: nothing", async () => {
    const page = await board(open, SHOWN);
    const at = await page.rect('[data-key="TEST-4"]');
    await page.drag('[data-key="TEST-4"]', at.x + at.width / 2, at.y + 4);
    await nothingWritten();
  });
});
