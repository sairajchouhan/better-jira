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

/** TEST-1: two pull requests (Jira's Development field summarises them as merged; the detail has one open, one merged) and three
 *  links; TEST-2: one open pull request, one GitHub link, a comment and a creator. window.open and the pull request reads are
 *  recorded, so opening a pull request or link stays in the test. The fixture's smart links give TEST-2 its one Jira comment. */
const BADGE_PROPS = ["id", "status", "assignee", "pullRequests", "links", "comments", "creator"];
const badgeSetup = `(()=>{localStorage.setItem(${JSON.stringify(PREFS_KEY)},${JSON.stringify(
  JSON.stringify({ 1: { display: { layout: "board", properties: BADGE_PROPS } } }),
)});window.__opened=[];window.__prReads=[];window.open=(u)=>{window.__opened.push(String(u));return null};const real=fetch;window.fetch=async(input,init)=>{const path=new URL(String(input),location.href).pathname;
 if(path.endsWith('/pull-requests'))window.__prReads.push(path.split('/').at(-2));
 if(path==='/api/issues'){const issues=await (await real(input,init)).json();return Response.json(issues.map(i=>i.key==='TEST-1'?{...i,prCount:2,prStatus:'merged',links:['https://example.test/spec','https://example.test/notes','https://docs.google.com/document/d/1']}:i.key==='TEST-2'?{...i,prCount:1,prStatus:'open',links:['https://github.com/example/app/pull/7'],creator:{id:'alex',name:'Alex'},created:'2026-11-01T10:00:00Z'}:i));}
 return real(input,init);};})()`;
const opened = (page: App) => page.eval<string[]>("window.__opened");

test("the link, pull request, comment and creator badges behave like Linear's", async ({ open }) => {
  await fixture.reset({ smartLinks: true });
  const page = await open("", { setup: badgeSetup });
  const badge = (key: string, label: string) => `${card(key)}.querySelector('[aria-label="${label}"]')`;
  await page.waitFor(`!!${badge("TEST-1", "Links on TEST-1")}`);
  /** Hovers a badge and returns its hover card's box, checking Linear's interactive tooltip opens top-start above it. */
  const hoverCard = async (sel: string, label: string) => {
    const chip = await page.eval<DOMRect>(rect(sel));
    await page.page.mouse.move(1, 1);
    await page.page.mouse.move((chip.left + chip.right) / 2, (chip.top + chip.bottom) / 2);
    const hover = `document.querySelector('[data-hover-card="${label}"]')`;
    await page.waitFor(`!!${hover}`);
    const box = await page.eval<DOMRect>(rect(hover));
    expect(box.bottom).toBeLessThanOrEqual(chip.top);
    expect(Math.abs(box.left - chip.left)).toBeLessThanOrEqual(1);
    return hover;
  };

  await test.step("3+ links: one count badge; hover lists them; click → Open link… lists them and opens the pick", async () => {
    expect(await page.eval(`${badge("TEST-1", "Links on TEST-1")}.textContent`)).toBe("3");
    const hover = await hoverCard(badge("TEST-1", "Links on TEST-1"), "Links");
    expect(await page.eval(`${hover}.querySelectorAll("a").length`)).toBe(3);
    await page.click(`[data-key="TEST-1"] [aria-label="Links on TEST-1"]`);
    await page.waitFor(`!document.querySelector('[data-hover-card="Links"]')`);
    const menu = `document.querySelector('[role="dialog"][aria-label="Open link…"]')`;
    await page.waitFor(`${menu}?.querySelectorAll("[cmdk-item]").length===3`);
    expect(await page.eval(shownIssue)).toBe(null);
    await page.click(`[role="dialog"][aria-label="Open link…"] [cmdk-item]:nth-child(3)`);
    await expect.poll(() => opened(page)).toEqual(["https://docs.google.com/document/d/1"]);
    expect(await page.eval(shownIssue)).toBe(null);
  });
  await test.step("under 3 links: a badge per link with Linear's short name that links to it; hover shows its card", async () => {
    const link = badge("TEST-2", "Open link example/app#7 on TEST-2");
    expect(await page.eval(`[${link}.textContent,${link}.getAttribute("href"),${link}.target]`)).toEqual([
      "#7",
      "https://github.com/example/app/pull/7",
      "_blank",
    ]);
    const hover = await hoverCard(link, "Link");
    expect(await page.eval(`${hover}.textContent`)).toContain("https://github.com/example/app/pull/7");
  });
  await test.step("Linear's PR badge text and status: one PR is its number and status icon; several are \"N PRs\"", async () => {
    const icon = (key: string) => `${badge(key, `Pull requests on ${key}`)}.querySelector('[data-pr-status]')`;
    const look = (key: string) =>
      page.eval(`[${badge(key, `Pull requests on ${key}`)}.textContent,${icon(key)}.dataset.prStatus,getComputedStyle(${icon(key)}).fill]`);
    // One PR: its number from Jira's development detail, Linear's open icon in greenBase (the suite's dark theme: l 60; light is 68).
    await page.waitFor(`${badge("TEST-2", "Pull requests on TEST-2")}.textContent==="#7"`);
    expect(await look("TEST-2")).toEqual(["#7", "open", "lch(60 64.37 141.95)"]);
    // Several: "2 PRs" and the status Jira's Development field gives with the issue (merged, purpleBase) — no per-card read.
    expect(await look("TEST-1")).toEqual(["2 PRs", "merged", "lch(48 59.31 288.43)"]);
    expect(await page.eval<string[]>("window.__prReads")).not.toContain("TEST-1");
  });
  await test.step("pull requests: hover lists Jira's pull requests; click → Go to linked pull requests… opens the pick", async () => {
    const prs = badge("TEST-1", "Pull requests on TEST-1");
    expect(await page.eval(`${prs}.textContent`)).toBe("2 PRs");
    const hover = await hoverCard(prs, "Pull requests");
    // Read on hover: the badge icon becomes the first status in Linear's order among them (open before merged).
    await page.waitFor(`${prs}.querySelector('[data-pr-status]').dataset.prStatus==="open"`);
    await page.waitFor(`${hover}.textContent.includes("Fix the fixture sync")&&${hover}.textContent.includes("Add the fixture board")`);
    await page.click(`[data-key="TEST-1"] [aria-label="Pull requests on TEST-1"]`);
    const menu = `document.querySelector('[role="dialog"][aria-label="Go to linked pull requests…"]')`;
    await page.waitFor(`${menu}?.querySelectorAll("[cmdk-item]").length===2`);
    const box = await page.eval<DOMRect>(rect(menu));
    const chip = await page.eval<DOMRect>(rect(prs));
    expect(Math.abs(box.left - chip.left)).toBeLessThanOrEqual(1);
    expect(box.top).toBeGreaterThan(chip.bottom);
    await page.click(`[role="dialog"][aria-label="Go to linked pull requests…"] [cmdk-item]:nth-child(1)`);
    await expect.poll(() => opened(page)).toContain("https://github.com/example/app/pull/12");
    expect(await page.eval(shownIssue)).toBe(null);
  });
  await test.step("one pull request: the click opens it straight away; so does ⇧→ on the hovered card", async () => {
    await page.eval("window.__opened=[]");
    await page.click(`[data-key="TEST-2"] [aria-label="Pull requests on TEST-2"]`);
    await expect.poll(() => opened(page)).toEqual(["https://github.com/example/app/pull/7"]);
    expect(await page.eval(`!!document.querySelector('[role="dialog"][aria-label^="Go to linked"]')`)).toBe(false);
    await page.eval("window.__opened=[]");
    await page.hover('[data-key="TEST-2"] [aria-label="Status on TEST-2"]');
    await page.key("ArrowRight", "Shift");
    await expect.poll(() => opened(page)).toEqual(["https://github.com/example/app/pull/7"]);
    expect(await page.eval(shownIssue)).toBe(null);
  });
  await test.step("creator: Linear's user card above the avatar, with the name", async () => {
    const hover = await hoverCard(`${card("TEST-2")}.querySelector('[data-creator="TEST-2"]')`, "Creator");
    expect(await page.eval(`${hover}.textContent`)).toContain("Alex");
    expect(await page.eval(`${hover}.textContent`)).toContain("Created the issue");
  });
  await test.step("comments: the click is Linear's Comment on issue — the issue opens with its comment box focused", async () => {
    await page.click(`[data-key="TEST-2"] [aria-label="1 comments"]`);
    await page.waitFor(`${shownIssue}==="TEST-2"`);
    await page.waitFor(`!!document.activeElement?.closest("#comment")`);
  });
});

test("one pull request's badge opens Linear's pull request menu at the pointer; each row acts on that pull request", async ({ open }) => {
  const copied = `;window.__copied=[];Object.defineProperty(navigator,'clipboard',{value:{writeText:async t=>{window.__copied.push(t)}}})`;
  for (const layout of ["board", "list"] as const) {
    const setup = badgeSetup.replace('"board"', `"${layout}"`) + copied;
    const page = await open("", { setup });
    const prs = `[data-key="TEST-2"] [aria-label="Pull requests on TEST-2"]`;
    await page.waitFor(`document.querySelector('${prs}')?.textContent==="#7"`);
    const menu = page.page.locator('[role="dialog"][aria-label="Pull request options"]');
    const rightClick = async () => {
      const r = await page.rect(prs);
      const at = { x: r.x + 3, y: r.y + r.height / 2 };
      await page.page.mouse.click(at.x, at.y, { button: "right" });
      await expect(menu).toBeVisible();
      return at;
    };
    await test.step(`${layout}: right-click opens it at the pointer with Linear's rows, not the card's issue menu`, async () => {
      const at = await rightClick();
      const box = (await menu.boundingBox())!;
      // The shared ContextMenu's placement at the pointer (e2e/context-menu.pw.ts): within the 4px menu gap.
      expect(Math.abs(box.x - at.x)).toBeLessThan(10);
      expect(Math.abs(box.y - at.y)).toBeLessThan(10);
      expect(await menu.locator("[cmdk-item]").allTextContents()).toEqual(["Open in GitHub", "Copy"]);
      expect(await page.eval(`!!document.querySelector('[role="dialog"][aria-label="Issue options"]')`)).toBe(false);
      expect(await page.eval(shownIssue)).toBe(null);
    });
    await test.step(`${layout}: Open in GitHub opens the pull request`, async () => {
      await menu.locator('[cmdk-item][data-value="Open in GitHub"]').click();
      await expect.poll(() => opened(page)).toEqual(["https://github.com/example/app/pull/7"]);
      await expect(menu).toHaveCount(0);
    });
    await test.step(`${layout}: Copy lists the GitHub URL and both branch names; each copies with Linear's toast`, async () => {
      for (const [row, text, toast] of [
        ["Copy GitHub URL", "https://github.com/example/app/pull/7", "URL copied to clipboard"],
        ["Copy branch name", "alex/tidy-labels", "Branch name copied to clipboard"],
        ["Copy target branch name", "main", "Branch name copied to clipboard"],
      ] as const) {
        await rightClick();
        await menu.locator('[cmdk-item][data-value="Copy"]').hover();
        const rows = page.page.locator('[cmdk-item][data-value^="Copy "]');
        await expect(rows).toHaveCount(3);
        expect(await rows.evaluateAll((items) => items.map((i) => i.getAttribute("data-value")))).toEqual([
          "Copy GitHub URL",
          "Copy branch name",
          "Copy target branch name",
        ]);
        // Linear's Copy submenu hides its search until typing (`chn` searchInput hidden).
        await expect(page.page.locator('input[aria-label="Find copy"]')).toHaveClass(/sr-only/);
        // Linear's Copy branch name carries its ⇧⌘. shortcut (`bK`).
        expect(await rows.nth(1).textContent()).toContain(".");
        await page.page.locator(`[cmdk-item][data-value="${row}"]`).click();
        await expect.poll(() => page.eval<string[]>("window.__copied.at(-1)")).toBe(text);
        await page.waitFor(`[...document.querySelectorAll('[data-toast]')].some(t=>t.textContent.includes(${JSON.stringify(toast)})&&t.textContent.includes(${JSON.stringify(text)}))`);
      }
    });
    await test.step(`${layout}: several pull requests leave the right-click to the card's issue menu`, async () => {
      const r = await page.rect(`[data-key="TEST-1"] [aria-label="Pull requests on TEST-1"]`);
      await page.page.mouse.click(r.x + 3, r.y + r.height / 2, { button: "right" });
      await expect(page.page.locator('[role="dialog"][aria-label="Issue options"]')).toBeVisible();
      await expect(menu).toHaveCount(0);
      await page.key("Escape");
    });
  }
});
