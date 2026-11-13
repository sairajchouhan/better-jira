/** Board card parity with Linear's board item (`Cu`) and issue card (`wd`), IssueList.CUOYX8Am.js; .raj/linear.md "Board card". */
import { expect, test, fixture, PREFS_KEY, shownIssue, type App } from "./app";

const PROPS = ["id", "status", "assignee", "priority", "labels", "type", "due", "statusAge", "project", "created", "updated"];
/** Seeds the board display, and gives TEST-1 a due date and a time in status (the fixture issues have neither). */
const setup = `(()=>{localStorage.setItem(${JSON.stringify(PREFS_KEY)},${JSON.stringify(
  JSON.stringify({ 1: { display: { layout: "board", properties: PROPS } } }),
)});const real=fetch;window.fetch=async(input,init)=>{const path=new URL(String(input),location.href).pathname;
 if(path==='/api/issues'){const issues=await (await real(input,init)).json();return Response.json(issues.map(i=>i.key==='TEST-1'?{...i,due:'2030-05-20',statusSince:'2026-11-01T10:00:00Z'}:i));}
 return real(input,init);};})()`;

const card = (key: string) => `document.querySelector('[data-key="${key}"]')`;
const rect = (selector: string) =>
  `(()=>{const r=(${selector}).getBoundingClientRect();return {left:r.left,right:r.right,top:r.top,bottom:r.bottom}})()`;
const writesFor = async (key: string) => (await fixture.log()).writes.filter((w: { key: string }) => w.key === key).length;

/**
 * Clicks a card control and checks Linear's behaviour: its menu opens anchored to it (4.5px below with left edges flush, or left of
 * it for labels), the control stays lit, and the card neither opens nor loses its place. Then a pick in the menu writes to Jira.
 */
async function opensItsMenu(
  page: App,
  key: string,
  control: string,
  menu: string,
  side: "below" | "left",
  pick: () => Promise<void>,
) {
  const sel = `${card(key)}.querySelector('[aria-label="${control} on ${key}"]')`;
  await page.waitFor(`!!${sel}`);
  const url = await page.eval<string>("location.href");
  const before = await writesFor(key);
  const chip = await page.eval<DOMRect>(rect(sel));
  await page.clickAt((chip.left + chip.right) / 2, (chip.top + chip.bottom) / 2);
  const dialog = `document.querySelector('[role="dialog"][aria-label="${menu}"]')`;
  await page.waitFor(`!!${dialog}`);
  const box = await page.eval<DOMRect>(rect(dialog));
  if (side === "below") {
    expect(box.top - chip.bottom).toBeCloseTo(4.5, 0);
    expect(Math.abs(box.left - chip.left)).toBeLessThanOrEqual(1);
  } else {
    expect(chip.left - box.right).toBeGreaterThan(0);
    expect(chip.left - box.right).toBeLessThan(8);
  }
  expect(await page.eval(`${sel}.getAttribute("aria-expanded")`)).toBe("true");
  // Linear's `.sx-1282wza`: the card takes bgBaseHover while one of its menus is open.
  expect(await page.eval(`getComputedStyle(${card(key)}).backgroundColor`)).toBe("lch(13.058 1.3 272)");
  expect(await page.eval("location.href")).toBe(url);
  expect(await page.eval(shownIssue)).toBe(null);
  await pick();
  await expect.poll(() => writesFor(key), { timeout: 5000 }).toBeGreaterThan(before);
  expect(await page.eval(shownIssue)).toBe(null);
}

test("every property on a board card is its own control that opens its menu at the control, not the issue", async ({ open }) => {
  await fixture.reset({ writable: true });
  const page = await open("", { setup });
  await page.waitFor(`!!document.querySelector('[data-key="TEST-1"] [aria-label="Due date on TEST-1"]')`);

  await test.step("due date badge → Due date below it", async () => {
    await opensItsMenu(page, "TEST-1", "Due date", "Due date", "below", async () => {
      await page.click('[role="dialog"][aria-label="Due date"] [cmdk-item][data-value="Tomorrow"]');
      // The fixture keeps no due date (the setup script injects it), so check the write itself.
      await expect.poll(async () => JSON.stringify((await fixture.log()).writes.at(-1)?.ops ?? [])).toContain('"due"');
    });
  });
  await test.step("priority badge → Set priority below it", async () => {
    await opensItsMenu(page, "TEST-1", "Priority", "Set priority", "below", async () => {
      await page.type("Urgent");
      await page.key("Enter");
      await page.waitFor(`${card("TEST-1")}.querySelector('[aria-label="Priority on TEST-1"]').matches('[title="Urgent"],[data-title="Urgent"]')`);
    });
  });
  await test.step("status icon → Change status below it", async () => {
    await opensItsMenu(page, "TEST-1", "Status", "Change status", "below", async () => {
      await page.type("Doing");
      await page.key("Enter");
      await page.waitFor(`${card("TEST-1")}?.querySelector('[aria-label="Status on TEST-1"]').matches('[title="Doing"],[data-title="Doing"]')`);
    });
  });
  await test.step("time in status badge → Change status too (Linear's `Own` runs the status action)", async () => {
    await opensItsMenu(page, "TEST-1", "Time in status", "Change status", "below", async () => {
      await page.type("Backlog");
      await page.key("Enter");
      await page.waitFor(`${card("TEST-1")}?.querySelector('[aria-label="Status on TEST-1"]').matches('[title="Backlog"],[data-title="Backlog"]')`);
    });
  });
  await test.step("assignee avatar → Assign issue below it", async () => {
    await opensItsMenu(page, "TEST-1", "Assignee", "Assign issue", "below", async () => {
      await page.type("Alex");
      await page.key("Enter");
      await page.waitFor(`${card("TEST-1")}.querySelector('[aria-label="Assignee on TEST-1"] :is([title="Alex"],[data-title="Alex"])')!==null`);
    });
  });
  await test.step("label badge → Change labels, left of it (`horizontal-left`)", async () => {
    await opensItsMenu(page, "TEST-1", "Labels", "Change labels", "left", async () => {
      await page.key("ArrowDown");
      await page.key("Enter");
      await page.key("Escape");
    });
  });
  await test.step("type badge → Change issue type below it", async () => {
    await opensItsMenu(page, "TEST-1", "Type", "Change issue type", "below", async () => {
      await page.type("Story");
      await page.key("Enter");
      await page.waitFor(`${card("TEST-1")}.querySelector('[aria-label="Type on TEST-1"]').textContent==="Story"`);
    });
  });
  await test.step("the rest of the card still opens the issue", async () => {
    const title = await page.eval<DOMRect>(rect(`[...${card("TEST-1")}.querySelectorAll("span")].find(s=>s.textContent==="Rich browser fixture")`));
    await page.clickAt(title.left + 4, (title.top + title.bottom) / 2);
    await page.waitFor(`${shownIssue}==="TEST-1"`);
  });
});

test("card and badge hover, and the keyboard ring drawn inside the card on all four sides", async ({ open }) => {
  const page = await open("", { setup });
  await page.waitFor(`!!document.querySelector('[data-key="TEST-2"] [aria-label="Priority on TEST-2"]')`);
  const bg = (sel: string) => page.eval<string>(`getComputedStyle(${sel}).backgroundColor`);

  await test.step("the card takes bgBaseHover under the pointer (Linear 9.232 → 13.058)", async () => {
    expect(await bg(card("TEST-2"))).toBe("lch(9.232 0.85 272)");
    await page.hover('[data-key="TEST-2"] [title^="Updated"]');
    await page.waitFor(`getComputedStyle(${card("TEST-2")}).backgroundColor==="lch(13.058 1.3 272)"`);
  });
  await test.step("a hovered badge takes bgShade, bgBorderSolidThin and labelTitle; an icon trigger brightens", async () => {
    const label = `${card("TEST-2")}.querySelector('[aria-label="Labels on TEST-2"]')`;
    expect(await bg(label)).toBe("lch(9.232 0.85 272)");
    expect(await page.eval(`getComputedStyle(${label}).borderTopColor`)).toBe("lch(20.032 1.93 272)");
    await page.hover('[data-key="TEST-2"] [aria-label="Labels on TEST-2"]');
    await page.waitFor(`getComputedStyle(${label}).backgroundColor==="lch(11.033 1.3 272)"`);
    expect(await page.eval(`getComputedStyle(${label}).borderTopColor`)).toBe("lch(30.833 1.93 272)");
    expect(await page.eval(`getComputedStyle(${label}.querySelector(".ui-badge-text")).color`)).toBe("lch(100 0 272)");
    await page.hover('[data-key="TEST-2"] [aria-label="Status on TEST-2"]');
    await page.waitFor(`getComputedStyle(${card("TEST-2")}.querySelector('[aria-label="Status on TEST-2"]').firstElementChild).filter==="brightness(1.32)"`);
  });
  await test.step("the keyboard ring: 1px accent outline, 1px inside the card, visible on every side", async () => {
    await page.hover("header");
    await page.eval(`${card("TEST-2")}.focus({focusVisible:true})`);
    const style = await page.eval<string[]>(
      `(()=>{const s=getComputedStyle(${card("TEST-2")});return [s.outlineStyle,s.outlineWidth,s.outlineOffset,s.outlineColor,s.backgroundColor]})()`,
    );
    expect(style).toEqual(["solid", "1px", "-1px", "lch(47.918 59.303 288.421)", "lch(9.232 0.85 272)"]);
    // Pixels: the middle of each edge, half a pixel inside the card, is the accent, so nothing clips the ring.
    const r = await page.eval<DOMRect>(rect(card("TEST-2")));
    const shot = (await page.page.screenshot({ clip: { x: r.left, y: r.top, width: r.right - r.left, height: r.bottom - r.top } })).toString("base64");
    const edges = await page.eval<[number, number, number][]>(`(async()=>{const img=await createImageBitmap(await (await fetch("data:image/png;base64,${shot}")).blob());
      const c=new OffscreenCanvas(img.width,img.height),x=c.getContext("2d");x.drawImage(img,0,0);const w=img.width,h=img.height,d=devicePixelRatio;
      const at=(px,py)=>[...x.getImageData(Math.floor(px),Math.floor(py),1,1).data].slice(0,3);
      return [at(w/2,d*0.5),at(w/2,h-d*0.5),at(d*0.5,h/2),at(w-d*0.5,h/2)]})()`);
    for (const [red, green, blue] of edges) expect(blue - Math.max(red, green)).toBeGreaterThan(40);
  });
  await test.step("a j/k selected card draws the same ring and keeps bgBase", async () => {
    await page.eval(`document.activeElement.blur()`);
    await page.key("j");
    await page.waitFor(`!!document.querySelector('[data-key][data-selected]')`);
    const sel = `document.querySelector('[data-key][data-selected]')`;
    expect(await page.eval(`(()=>{const s=getComputedStyle(${sel});return [s.outlineStyle,s.outlineWidth,s.outlineOffset]})()`)).toEqual(["solid", "1px", "-1px"]);
  });
});

test("a list row's keyboard ring sits inside the row, so the next row cannot cover it", async ({ open }) => {
  const page = await open("", {
    setup: `localStorage.setItem(${JSON.stringify(PREFS_KEY)},${JSON.stringify(JSON.stringify({ 1: { display: { layout: "list", properties: PROPS } } }))})`,
  });
  await page.waitFor(`!!${card("TEST-2")}`);
  await page.eval(`${card("TEST-2")}.focus({focusVisible:true})`);
  expect(
    await page.eval(`(()=>{const s=getComputedStyle(${card("TEST-2")});return [s.outlineStyle,s.outlineWidth,s.outlineOffset,s.boxShadow]})()`),
  ).toEqual(["solid", "1px", "-1px", "none"]);
});
