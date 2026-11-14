import { expect, fixture, test, sleep, type App as Page } from "./app";
// Phase 3 checklist items that no other browser test exercised.
const summary = `(document.getElementById('summary').value??document.getElementById('summary').textContent)`;
const fromBoard = async (page: Page, key: string) => {
  await page.click(`[data-key="${key}"]`);
  await page.waitFor(`!!document.getElementById('summary')&&${summary}!==''`);
};
/** Waits until the expression's JSON is the same on two polls in a row, for a menu that positions itself after it opens. */
const stable = async <T>(page: Page, expression: string) => {
  await page.eval("delete window.__stable");
  return page
    .waitFor<string>(
      `(()=>{const r=JSON.stringify(${expression});const same=window.__stable===r;window.__stable=r;return same&&r})()`,
    )
    .then((r) => JSON.parse(r) as T);
};

test("the issue page looks and feels like Linear: timestamp tooltip, focus ring, cursors and menu highlighting (RAJ-52)", async ({
  open,
}) => {
  const page = await open("?issue=TEST-1&view=page");
  await page.waitFor(
    `!!document.getElementById('comment')&&!!document.querySelector('[data-properties]')&&!!document.querySelector('#issue-created a')&&!!document.querySelector('[aria-label="Add reaction"]')`,
  );
  await test.step('RAJ-52: an Activity timestamp shows its exact time in a tooltip 8px above, centred ("Sat Nov 7, 2026, 00:20:06")', async () => {
    await page.hover("#issue-created a");
    await page.waitFor(`!!document.querySelector('[role=tooltip]')`);
    const [text, label, gap, centre] = await page.eval<[string, string, number, number]>(
      `(()=>{const t=document.querySelector('[role=tooltip]'),a=document.querySelector('#issue-created a'),q=t.getBoundingClientRect(),b=a.getBoundingClientRect();return [t.textContent,a.getAttribute('aria-label'),Math.round(b.top-q.bottom),Math.round(q.left+q.width/2-b.left-b.width/2)+0]})()`,
    );
    expect(text).toBe(label);
    expect(text).toMatch(/^[A-Z][a-z]{2} [A-Z][a-z]{2} \d{1,2}, \d{4}, \d{2}:\d{2}:\d{2}$/);
    expect([gap, centre]).toEqual([8, 0]);
    await page.page.mouse.move(0, 0);
  });
  await test.step("RAJ-52: keyboard focus shows Linear's ring: 1px accent on buttons, inset 1px on Activity timestamps", async () => {
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
    await page.eval("document.activeElement?.blur()");
  });
  await test.step("every control on the issue page and in its menus keeps the default arrow cursor; only text fields show a text cursor", async () => {
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
  });
  await test.step("RAJ-52: action menus open with no row highlighted: Enter does nothing, ArrowDown highlights the first row and ArrowUp the last", async () => {
    const lit = `[...document.querySelectorAll('[role=dialog] [cmdk-item]')].filter(n=>getComputedStyle(n,'::before').backgroundColor!=='rgba(0, 0, 0, 0)').map(n=>n.dataset.value)`;
    const menu = async () => {
      await page.click("#issue-options");
      await page.waitFor(`!!document.querySelector('[role=dialog] [cmdk-item]')`);
      await sleep(100); // no row lights up late
    };
    await menu();
    expect(await page.eval(lit)).toEqual([]);
    await page.key("Enter");
    await sleep(150); // Enter neither closes the menu nor picks a row
    expect([
      await page.eval(`document.querySelectorAll('[role=dialog]').length`),
      await page.eval(lit),
    ]).toEqual([1, []]);
    await page.key("ArrowRight");
    await sleep(150); // no submenu opens
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
    await menu();
    await page.key("ArrowUp");
    await page.waitFor(`${lit}.length===1`);
    expect(await page.eval(lit)).toEqual(["Delete"]);
    await page.key("Escape");
    await page.waitFor(`!document.querySelector('[role=dialog]')`);
    await menu();
    await page.type("copy");
    await page.waitFor(`${lit}.length===1`);
    expect((await page.eval<string[]>(lit))[0]!).toStartWith("Copy");
    await page.key("Escape");
    await page.waitFor(`!document.querySelector('[role=dialog]')`);
  });
});

// TEST-3 gets a milestone so TEST-1, in the same project, can pick it.
const milestone = `const read=fetch;window.fetch=async(...args)=>{const response=await read(...args),path=new URL(String(args[0]?.url??args[0]),location.href).pathname;if(path!=='/api/issues')return response;const issues=await response.json();issues.find(i=>i.key==='TEST-3').milestones=[{id:'m1',name:'Beta'}];return Response.json(issues)};`;
test("an issue's favourite, assignee, project and milestone change and survive a reload", async ({
  open,
}) => {
  // The project is the issue's epic (shared/epics.ts): the fixture's TEST-7 "Fixture epic".
  await fixture.reset({ epics: true });
  const page = await open("?issue=TEST-1&view=page", { setup: milestone });
  await test.step("favorite turns off from the star, and both states survive a reload", async () => {
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
  });
  await test.step("assignee, project and milestone pick, clear and survive a reload on the issue", async () => {
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
    await pick("prop-project", "Change epic", "Fixture epic TEST-7");
    await page.waitFor(`document.getElementById('prop-project')?.textContent.includes('Fixture epic')`);
    await pick("prop-project", "Change epic", "No epic");
    await page.waitFor(`!document.getElementById('prop-project')?.textContent.includes('Fixture epic')`);
    await pick("prop-project", "Change epic", "Fixture epic TEST-7");
    await page.key("M", "shift");
    await page.waitFor(
      `!!document.querySelector('[role=dialog][aria-label="Set milestone"] [cmdk-item][data-value="Beta"]')`,
    );
    await page.click('[role=dialog][aria-label="Set milestone"] [cmdk-item][data-value="Beta"]');
    await page.waitFor(`document.getElementById('prop-milestone')?.textContent.includes('Beta')`);
    await page.reload();
    await page.waitFor(
      `document.getElementById('prop-milestone')?.textContent.includes('Beta')&&document.getElementById('prop-assignee').textContent.includes('Unassigned')&&document.getElementById('prop-project').textContent.includes('Fixture epic')`,
    );
  });
});

test("Previous and Next stop at the first and last issue, and browser Back and Forward retrace the issues", async ({
  open,
}) => {
  const page = await open();
  const nav = `[...document.querySelector('[aria-label="Issue position"]').parentElement.querySelectorAll('button')].map(b=>[b.title,b.disabled])`;
  await fromBoard(page, "TEST-1");
  await test.step("Previous stops at the first issue", async () => {
    expect(await page.eval(nav)).toEqual([
      ["Next (J / ↓)", false],
      ["Previous (K / ↑)", true],
    ]);
    await page.eval("document.activeElement?.blur()");
    await page.key("k");
    await sleep(150); // K does not move off the first issue
    expect(await page.eval(summary)).toBe("Rich browser fixture");
  });
  await test.step("browser Back and Forward retrace the issues", async () => {
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
  });
  await test.step("Next stops at the last issue", async () => {
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
    await sleep(150); // J does not move off the last issue
    expect(await page.eval(`new URL(location.href).searchParams.get('issue')`)).toBe(last);
  });
});

type Box = [number, number, number, number, number, number];
const tree = `const read=fetch;window.fetch=async(...args)=>{const response=await read(...args);if(new URL(String(args[0]?.url??args[0]),location.href).pathname!=='/api/issues')return response;const issues=await response.json();for(const key of ['TEST-3','TEST-4'])issues.find(i=>i.key===key).parent='TEST-2';return Response.json(issues)}`;
test("RAJ-52: action menus sit where Linear puts them: Issue options left-aligned 4px under, row ⋯ menus right-aligned 4px under, right-click at the cursor, 175px minimum", async ({
  open,
}) => {
  const page = await open("?issue=TEST-2&view=page", { width: 1272, height: 1400, setup: tree });
  const R = `n=>{const b=n.getBoundingClientRect();return [b.left,b.top,b.right,b.bottom,b.width,b.height].map(Math.round)}`;
  const place = async (sel: string) => {
    await page.eval(
      `document.querySelector(${JSON.stringify(sel)}).scrollIntoView({block:'center'})`,
    );
    await page.eval(`document.querySelector(${JSON.stringify(sel)}).click()`);
    await page.waitFor(`!!document.querySelector('[role=dialog] [cmdk-item]')`);
    const r = await stable<[Box, Box]>(
      page,
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
    const m = await stable<Box>(
      page,
      `(${R})([...document.querySelectorAll('[role=dialog]')].at(-1))`,
    );
    await page.key("Escape");
    await page.waitFor(`!document.querySelector('[role=dialog]')`);
    return [x, y, m] as const;
  };
  await test.step("add a link and a comment to place menus on", async () => {
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
  });
  await test.step("Issue options left-aligned 4px under; a resource's ⋯ menu right-aligned 4px under, 175px wide", async () => {
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
  });
  await test.step("menu rows keep Linear's padding and separator bands, in the menu border colour", async () => {
    // Inside, Linear keeps 6px above and below the rows and a 12px band per separator: 165px for Open link, Copy link | Edit… | Remove… (0.5px border; headless draws 1px).
    await page.click('[aria-label="Options for Spec"]');
    await page.waitFor(`!!document.querySelector('[role=dialog] [cmdk-item]')`);
    expect(
      await page.eval(
        `(()=>{const d=[...document.querySelectorAll('[role=dialog]')].at(-1),D=d.getBoundingClientRect(),i=[...d.querySelectorAll('[cmdk-item]')].map(n=>n.getBoundingClientRect());return [i[0].top-D.top,i[2].top-i[1].bottom,i[3].top-i[2].bottom,D.bottom-i[3].bottom,D.height].map(Math.round)})()`,
      ),
    ).toEqual([7, 12, 12, 7, 166]);
    // Separators are Menu.Divider's 0.5px line in Linear's bgBorderFaintThin (fT's divider), not the faint --line-2.
    expect(
      await page.eval(
        `[...[...document.querySelectorAll('[role=dialog]')].at(-1).querySelectorAll('[cmdk-separator]')].map(n=>getComputedStyle(n,'::after').borderBottomColor)`,
      ),
    ).toEqual(["lch(20.28 1.93 272)", "lch(20.28 1.93 272)"]);
    await page.key("Escape");
    await page.waitFor(`!document.querySelector('[role=dialog]')`);
  });
  await test.step("a comment's ⋯ menu right-aligned 4px under; right-click menus open at the cursor", async () => {
    const [com, comMenu] = await place('[data-comment] [aria-label="Comment options"]');
    expect([comMenu[2], comMenu[1] - com[3]]).toEqual([com[2], 4]);
    let [x, y, m] = await right("[data-comment] .comment-body", 20, 6);
    expect([m[0] - x, m[1] - y]).toEqual([2, 4]);
    [x, y, m] = await right('[aria-label="Options for Spec"]', -200, 12);
    expect([m[0] - x, m[1] - y]).toEqual([4, -1]);
    // CORE-18: every row menu opens at Linear's one point offset.
    [x, y, m] = await right("[data-sub-issue]", 200, 18);
    expect([m[0] - x, m[1] - y]).toEqual([4, -1]);
  });
  await test.step("RAJ-52: too tall to fit under the cursor, a menu stays 10px off the window bottom ([439,255,180,637])", async () => {
    await page.cmd("Emulation.setDeviceMetricsOverride", {
      width: 1272,
      height: 600,
      deviceScaleFactor: 1,
      mobile: false,
    });
    const [x, y, m] = await right("[data-sub-issue]", 200, 18);
    expect([m[0] - x, m[3], m[1] < y]).toEqual([4, 590, true]);
  });
});
