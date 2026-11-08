import { afterAll, expect, test } from "bun:test";
import { open, stop, type Page } from "./harness";
afterAll(stop);
// Phase 3 checklist items that no other browser test exercised.
const summary = `(document.getElementById('summary').value??document.getElementById('summary').textContent)`;
const fromBoard = async (page: Page, key: string) => {
  await page.click(`[data-key="${key}"]`);
  await page.waitFor(`!!document.getElementById('summary')&&${summary}!==''`);
};

test('an Activity timestamp shows its exact time in a tooltip 8px above, centred, like Linear (RAJ-52 "Sat Nov 7, 2026, 00:20:06")', async () => {
  const page = await open("?issue=TEST-1&view=page");
  try {
    await page.waitFor(`!!document.querySelector('#issue-created a')`);
    await page.hover("#issue-created a");
    await page.waitFor(`!!document.querySelector('[role=tooltip]')`);
    const [text, label, gap, centre] = await page.eval<[string, string, number, number]>(
      `(()=>{const t=document.querySelector('[role=tooltip]'),a=document.querySelector('#issue-created a'),q=t.getBoundingClientRect(),b=a.getBoundingClientRect();return [t.textContent,a.getAttribute('aria-label'),Math.round(b.top-q.bottom),Math.round(q.left+q.width/2-b.left-b.width/2)]})()`,
    );
    expect(text).toBe(label);
    expect(text).toMatch(/^[A-Z][a-z]{2} [A-Z][a-z]{2} \d{1,2}, \d{4}, \d{2}:\d{2}:\d{2}$/);
    expect([gap, centre]).toEqual([8, 0]);
  } finally {
    await page.close();
  }
});

test("favorite turns off from the star, and both states survive a reload", async () => {
  const page = await open("?issue=TEST-1&view=page");
  try {
    await page.waitFor(`!!document.querySelector('[aria-label="Add issue to favorites"]')`);
    await page.click('[aria-label="Add issue to favorites"]');
    await page.waitFor(`!!document.querySelector('[aria-label="Remove issue from favorites"]')`);
    await page.reload();
    await page.waitFor(`!!document.querySelector('[aria-label="Remove issue from favorites"]')`);
    await page.click('[aria-label="Remove issue from favorites"]');
    await page.waitFor(`!!document.querySelector('[aria-label="Add issue to favorites"]')`);
    await page.reload();
    await page.waitFor(`!!document.querySelector('[aria-label="Add issue to favorites"]')`);
    expect(
      await page.eval(`!!document.querySelector('[aria-label="Remove issue from favorites"]')`),
    ).toBe(false);
  } finally {
    await page.close();
  }
});

test("Previous and Next stop at the first and last issue, and browser Back and Forward retrace the issues", async () => {
  const page = await open();
  try {
    await fromBoard(page, "TEST-1");
    const nav = `[...document.querySelector('[aria-label="Issue position"]').parentElement.querySelectorAll('button')].map(b=>[b.title,b.disabled])`;
    expect(await page.eval(nav)).toEqual([
      ["Next (J / ↓)", false],
      ["Previous (K / ↑)", true],
    ]);
    await page.eval("document.activeElement?.blur()");
    await page.key("k");
    await Bun.sleep(150);
    expect(await page.eval(summary)).toBe("Rich browser fixture");
    await page.key("j");
    await page.waitFor(`${summary}!=='Rich browser fixture'`);
    const second = await page.eval<string>(`new URL(location.href).searchParams.get('issue')`);
    await page.eval("history.back()");
    await page.waitFor(
      `new URL(location.href).searchParams.get('issue')==='TEST-1'&&${summary}==='Rich browser fixture'`,
    );
    await page.eval("history.forward()");
    await page.waitFor(
      `new URL(location.href).searchParams.get('issue')==='${second}'&&${summary}!=='Rich browser fixture'`,
    );
    for (let i = 0; i < 8; i++) {
      const before = await page.eval<string>(
        `document.querySelector('[aria-label="Issue position"]').textContent`,
      );
      if (before.startsWith("6")) break;
      await page.key("j");
      await page.waitFor(
        `document.querySelector('[aria-label="Issue position"]').textContent!==${JSON.stringify(before)}`,
      );
    }
    expect(
      await page.eval(`document.querySelector('[aria-label="Issue position"]').textContent`),
    ).toBe("6 / 6");
    expect(await page.eval(nav)).toEqual([
      ["Next (J / ↓)", true],
      ["Previous (K / ↑)", false],
    ]);
    const last = await page.eval<string>(`new URL(location.href).searchParams.get('issue')`);
    await page.key("j");
    await Bun.sleep(150);
    expect(await page.eval(`new URL(location.href).searchParams.get('issue')`)).toBe(last);
  } finally {
    await page.close();
  }
});

// TEST-3 gets a milestone so TEST-1, in the same project, can pick it.
const milestone = `const read=fetch;window.fetch=async(...args)=>{const response=await read(...args),path=new URL(String(args[0]?.url??args[0]),location.href).pathname;if(path!=='/api/issues')return response;const issues=await response.json();issues.find(i=>i.key==='TEST-3').milestones=[{id:'m1',name:'Beta'}];return Response.json(issues)};`;
test("assignee, project and milestone pick, clear and survive a reload on the issue", async () => {
  const page = await open("?issue=TEST-1&view=page", { setup: milestone });
  try {
    await page.waitFor(`!!document.getElementById('prop-assignee')`);
    const pick = async (id: string, menu: string, row: string) => {
      await page.click(`#${id}`);
      await page.waitFor(
        `!!document.querySelector('[role=dialog][aria-label="${menu}"] [cmdk-item][data-value="${row}"]')`,
      );
      await page.click(`[role=dialog][aria-label="${menu}"] [cmdk-item][data-value="${row}"]`);
      await page.waitFor(`!document.querySelector('[role=dialog][aria-label="${menu}"]')`);
    };
    await pick("prop-assignee", "Assign issue", "Alex alex");
    await page.waitFor(`document.getElementById('prop-assignee').textContent.includes('Alex')`);
    await page.reload();
    await page.waitFor(`document.getElementById('prop-assignee')?.textContent.includes('Alex')`);
    await pick("prop-assignee", "Assign issue", "No assignee");
    await page.waitFor(
      `document.getElementById('prop-assignee').textContent.includes('Unassigned')`,
    );
    await pick("prop-project", "Change project", "No project");
    await page.waitFor(`!document.getElementById('prop-project')?.textContent.includes('Audit')`);
    await pick("prop-project", "Change project", "Audit");
    await page.waitFor(`document.getElementById('prop-project')?.textContent.includes('Audit')`);
    await page.key("M", "shift");
    await page.waitFor(
      `!!document.querySelector('[role=dialog][aria-label="Set milestone"] [cmdk-item][data-value="Beta"]')`,
    );
    await page.click('[role=dialog][aria-label="Set milestone"] [cmdk-item][data-value="Beta"]');
    await page.waitFor(`document.getElementById('prop-milestone')?.textContent.includes('Beta')`);
    await page.reload();
    await page.waitFor(
      `document.getElementById('prop-milestone')?.textContent.includes('Beta')&&document.getElementById('prop-assignee').textContent.includes('Unassigned')&&document.getElementById('prop-project').textContent.includes('Audit')`,
    );
  } finally {
    await page.close();
  }
});

test("every control on the issue page and in its menus keeps the default arrow cursor; only text fields show a text cursor", async () => {
  const page = await open("?issue=TEST-1&view=page");
  try {
    await page.waitFor(
      `!!document.getElementById('comment')&&!!document.querySelector('[data-properties]')`,
    );
    const bad = `[...document.querySelectorAll('button,a[href],[role=button],[role=menuitem],[role=option],[cmdk-item],summary,label,select,input[type=checkbox],input[type=range]')].filter(n=>n.getClientRects().length&&!n.closest('[contenteditable=true]')).map(n=>[n.getAttribute('aria-label')||n.textContent.trim().slice(0,30)||n.tagName,getComputedStyle(n).cursor]).filter(([,c])=>c!=='default')`;
    expect(await page.eval(bad)).toEqual([]);
    expect(
      await page.eval(
        `[getComputedStyle(document.getElementById('summary')).cursor,getComputedStyle(document.getElementById('comment')).cursor]`,
      ),
    ).toEqual(["text", "text"]);
    for (const open of [
      "#issue-options",
      "#prop-status",
      "#prop-priority",
      '[aria-label="Add reaction"]',
    ]) {
      await page.click(open);
      await page.waitFor(`!!document.querySelector('[role=dialog]')`);
      expect([open, await page.eval(bad)]).toEqual([open, []]);
      await page.key("Escape");
      await page.waitFor(`!document.querySelector('[role=dialog]')`);
    }
  } finally {
    await page.close();
  }
});

test("keyboard focus shows Linear's ring: 1px accent on buttons, inset 1px on Activity timestamps (RAJ-52)", async () => {
  const page = await open("?issue=TEST-1&view=page");
  try {
    await page.waitFor(
      `!!document.querySelector('#issue-created a')&&!!document.querySelector('[aria-label="Add reaction"]')`,
    );
    await page.key("Shift");
    expect(
      await page.eval(
        `['#issue-options','[aria-label="Add reaction"]','#issue-created a'].map(s=>{const n=document.querySelector(s);n.focus();const c=getComputedStyle(n);return [n.matches(':focus-visible'),c.outlineStyle,c.outlineWidth,c.outlineColor,c.outlineOffset]})`,
      ),
    ).toEqual([
      [true, "solid", "1px", "lch(47.918 59.303 288.421)", "0px"],
      [true, "solid", "1px", "lch(47.918 59.303 288.421)", "0px"],
      [true, "solid", "1px", "lch(47.918 59.303 288.421)", "-1px"],
    ]);
  } finally {
    await page.close();
  }
});

test("action menus open with no row highlighted, like Linear: Enter does nothing, ArrowDown highlights the first row and ArrowUp the last (RAJ-52)", async () => {
  const page = await open("?issue=TEST-1&view=page");
  try {
    await page.waitFor(`!!document.getElementById('issue-options')`);
    const lit = `[...document.querySelectorAll('[role=dialog] [cmdk-item]')].filter(n=>getComputedStyle(n).backgroundColor!=='rgba(0, 0, 0, 0)').map(n=>n.dataset.value)`;
    const menu = async (open: () => Promise<void>) => {
      await open();
      await page.waitFor(`!!document.querySelector('[role=dialog] [cmdk-item]')`);
      await Bun.sleep(100);
    };
    await menu(() => page.click("#issue-options"));
    expect(await page.eval(lit)).toEqual([]);
    await page.key("Enter");
    await Bun.sleep(150);
    expect([
      await page.eval(`document.querySelectorAll('[role=dialog]').length`),
      await page.eval(lit),
    ]).toEqual([1, []]);
    await page.key("ArrowRight");
    await Bun.sleep(150);
    expect(await page.eval(`document.querySelectorAll('[role=dialog] [cmdk-list]').length`)).toBe(
      1,
    );
    await page.key("ArrowDown");
    await page.waitFor(`${lit}.length===1`);
    expect(await page.eval(lit)).toEqual(["Due date"]);
    await page.key("ArrowDown");
    await page.waitFor(`${lit}[0]==='Issue type'`);
    await page.key("Escape");
    await page.waitFor(`!document.querySelector('[role=dialog]')`);
    await menu(() => page.click("#issue-options"));
    await page.key("ArrowUp");
    await page.waitFor(`${lit}.length===1`);
    expect(await page.eval(lit)).toEqual(["Delete"]);
    await page.key("Escape");
    await page.waitFor(`!document.querySelector('[role=dialog]')`);
    await menu(() => page.click("#issue-options"));
    await page.type("copy");
    await page.waitFor(`${lit}.length===1`);
    expect((await page.eval<string[]>(lit))[0]).toStartWith("Copy");
    await page.key("Escape");
    await page.waitFor(`!document.querySelector('[role=dialog]')`);
  } finally {
    await page.close();
  }
});

type Box = [number, number, number, number, number, number];
const tree = `const read=fetch;window.fetch=async(...args)=>{const response=await read(...args);if(new URL(String(args[0]?.url??args[0]),location.href).pathname!=='/api/issues')return response;const issues=await response.json();for(const key of ['TEST-3','TEST-4'])issues.find(i=>i.key===key).parent='TEST-2';return Response.json(issues)}`;
test("action menus sit where Linear puts them: Issue options left-aligned 4px under, row ⋯ menus right-aligned 4px under, right-click at the cursor, 175px minimum (RAJ-52)", async () => {
  const page = await open("?issue=TEST-2&view=page", { width: 1272, height: 1400, setup: tree });
  try {
    await page.waitFor(
      `!!document.getElementById('comment')&&!!document.querySelector('[data-sub-issue]')`,
    );
    await page.click("#issue-options");
    await page.click('[cmdk-item][data-value="Add link…"]');
    await page.type("https://example.com/spec");
    await page.click('[aria-label="Link title"]');
    await page.type("Spec");
    await page.click("text=Add link");
    await page.waitFor(`!!document.querySelector('[aria-label="Options for Spec"]')`);
    await page.click("#comment");
    await page.type("Placement");
    await page.key("Enter", "meta");
    await page.waitFor(`!!document.querySelector('[data-comment] [aria-label="Comment options"]')`);
    const R = `n=>{const b=n.getBoundingClientRect();return [b.left,b.top,b.right,b.bottom,b.width,b.height].map(Math.round)}`;
    const place = async (sel: string) => {
      await page.eval(
        `document.querySelector(${JSON.stringify(sel)}).scrollIntoView({block:'center'})`,
      );
      await page.eval(`document.querySelector(${JSON.stringify(sel)}).click()`);
      await page.waitFor(`!!document.querySelector('[role=dialog] [cmdk-item]')`);
      await Bun.sleep(100);
      const r = await page.eval<[Box, Box]>(
        `[(${R})(document.querySelector(${JSON.stringify(sel)})),(${R})([...document.querySelectorAll('[role=dialog]')].at(-1))]`,
      );
      await page.key("Escape");
      await page.waitFor(`!document.querySelector('[role=dialog]')`);
      return r;
    };
    const right = async (sel: string, dx: number, dy: number) => {
      await page.eval(
        `document.querySelector(${JSON.stringify(sel)}).scrollIntoView({block:'center'})`,
      );
      const [x, y] = await page.eval<[number, number]>(
        `(()=>{const b=document.querySelector(${JSON.stringify(sel)}).getBoundingClientRect();return [Math.round(b.left+${dx}),Math.round(b.top+${dy})]})()`,
      );
      for (const type of ["mouseMoved", "mousePressed", "mouseReleased"])
        await page.cmd("Input.dispatchMouseEvent", { type, x, y, button: "right", clickCount: 1 });
      await page.waitFor(`!!document.querySelector('[role=dialog] [cmdk-item]')`);
      await Bun.sleep(100);
      const m = await page.eval<Box>(
        `(${R})([...document.querySelectorAll('[role=dialog]')].at(-1))`,
      );
      await page.key("Escape");
      await page.waitFor(`!document.querySelector('[role=dialog]')`);
      return [x, y, m] as const;
    };
    const [issue, issueMenu] = await place("#issue-options");
    expect([issueMenu[0], issueMenu[1] - issue[3]]).toEqual([issue[0], 4]);
    const [res, resMenu] = await place('[aria-label="Options for Spec"]');
    expect([res[4], res[5], resMenu[2], resMenu[1] - res[3], resMenu[4]]).toEqual([
      24,
      24,
      res[2],
      4,
      175,
    ]);
    // Inside, Linear keeps 6px above and below the rows and a 12px band per separator: 165px for Open link, Copy link | Edit… | Remove… (0.5px border; headless draws 1px).
    await page.click('[aria-label="Options for Spec"]');
    await page.waitFor(`!!document.querySelector('[role=dialog] [cmdk-item]')`);
    expect(
      await page.eval(
        `(()=>{const d=[...document.querySelectorAll('[role=dialog]')].at(-1),D=d.getBoundingClientRect(),i=[...d.querySelectorAll('[cmdk-item]')].map(n=>n.getBoundingClientRect());return [i[0].top-D.top,i[2].top-i[1].bottom,i[3].top-i[2].bottom,D.bottom-i[3].bottom,D.height].map(Math.round)})()`,
      ),
    ).toEqual([7, 12, 12, 7, 166]);
    // Separators are drawn in the menu border colour, as bright as Linear's, not the faint --line-2.
    expect(
      await page.eval(
        `[...[...document.querySelectorAll('[role=dialog]')].at(-1).querySelectorAll('[cmdk-separator]')].map(n=>getComputedStyle(n).backgroundColor)`,
      ),
    ).toEqual(["lch(21.36 1.93 272)", "lch(21.36 1.93 272)"]);
    await page.key("Escape");
    await page.waitFor(`!document.querySelector('[role=dialog]')`);
    const [com, comMenu] = await place('[data-comment] [aria-label="Comment options"]');
    expect([comMenu[2], comMenu[1] - com[3]]).toEqual([com[2], 4]);
    let [x, y, m] = await right("[data-comment] .comment-body", 20, 6);
    expect([m[0] - x, m[1] - y]).toEqual([2, 4]);
    [x, y, m] = await right('[aria-label="Options for Spec"]', -200, 12);
    expect([m[0] - x, m[1] - y]).toEqual([4, -1]);
    [x, y, m] = await right("[data-sub-issue]", 200, 18);
    expect([m[0] - x, m[1] - y]).toEqual([3, 0]);
    // Too tall to fit under the cursor, it stays 10px off the window bottom, as Linear's sub-issue menu does (RAJ-52, [439,255,180,637]).
    await page.cmd("Emulation.setDeviceMetricsOverride", {
      width: 1272,
      height: 600,
      deviceScaleFactor: 1,
      mobile: false,
    });
    [x, y, m] = await right("[data-sub-issue]", 200, 18);
    expect([m[0] - x, m[3], m[1] < y]).toEqual([3, 590, true]);
  } finally {
    await page.close();
  }
});
