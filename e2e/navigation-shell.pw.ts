import { expect, test, sleep, type App as Page, fixture, shownDocument, shownIssue, shownView } from "./app";

const nav = `document.querySelector('nav[aria-label="Main navigation"]')`;
const navShown = `(()=>{const n=${nav};return !!n&&n.getClientRects().length>0})()`;
const rows = `[...document.querySelectorAll('[role^=menuitem]')].map(n=>n.textContent)`;
const highlighted = `document.querySelector('[role^=menuitem][data-focused]')?.textContent`;
async function palette(p: Page, query: string) {
  await p.key("k", "meta");
  await p.waitFor(`!!document.querySelector('.menu-input input')`);
  await p.type(query);
}

test("navigation shell: sidebar, My issues URL, palettes and shortcut search", async ({ open }) => {
  const page = await open();
  await test.step("R1-D57: the collapsed sidebar stays collapsed after a reload", async () => {
    await page.key("[");
    await page.waitFor(`!${nav}`);
    await page.reload();
    expect(await page.eval(`!${nav}`)).toBe(true);
    await page.key("[");
    await page.waitFor(`!!${nav}`);
  });
  await test.step("R1-D56: My issues is in the URL and survives a reload", async () => {
    await page.keys("gm");
    await page.waitFor(`location.pathname==='/my-issues'`);
    await page.cmd("Page.reload"); // no fixture issue is the audit user's, so there are no cards to wait for
    await sleep(300);
    await page.waitFor(
      `document.querySelector('nav[aria-label="Breadcrumb"] [aria-label="My issues"]')?.textContent==='My issues'`,
    );
    await page.keys("ge");
    await page.waitFor(`location.pathname.startsWith('/board/')`);
  });
  await test.step("R1-D54: the scoped palette lists only issue commands that apply", async () => {
    await fetch(`${fixture.url}__fixture`, {
      method: "POST",
      body: JSON.stringify({ subtask: true }),
    });
    await page.reload();
    await page.click('[data-key="TEST-5"]');
    await page.key("Escape");
    await palette(page, "Open");
    await page.waitFor(`${rows}.some(t=>t.includes('Open sub-issue'))`);
    expect(await page.eval<string[]>(rows)).not.toContain(
      expect.stringContaining("Open parent issue"),
    );
    expect(await page.eval<string[]>(rows)).not.toContain(
      expect.stringContaining("Open sub-issues of parent"),
    );
    expect(await page.eval(highlighted)).toContain("Open sub-issue");
    await page.key("Escape");
    await page.waitFor(`!document.querySelector('.menu-input input')`);
  });
  await test.step("R1-D62: ⌘K names the favorite toggle from the issue's state", async () => {
    await page.key("j");
    await palette(page, "favorite");
    await page.waitFor(`${rows}.some(t=>t.includes('Mark as favorite'))`);
    await page.key("Enter");
    await palette(page, "favorite");
    await page.waitFor(`${rows}.some(t=>t.includes('Unfavorite issue'))`);
    await page.key("Escape");
  });
  await test.step("R1-D61: shortcut search matches the shown keys, and a single letter is a whole key", async () => {
    await page.key("/", "meta");
    const dialog = `document.querySelector('[role=dialog][aria-label="Keyboard Shortcuts"]')`;
    const names = `[...${dialog}.querySelectorAll('dt')].map(n=>n.textContent)`;
    await page.waitFor(`!!${dialog}`);
    await page.type("g then");
    await page.waitFor(`${names}.includes('Go to active issues')`);
    await page.eval(
      `(()=>{const i=${dialog}.querySelector('input');Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(i,'');i.dispatchEvent(new Event('input',{bubbles:true}))})()`,
    );
    await page.type("shift d");
    await page.waitFor(`${names}.includes('Set due date')`);
    const found = await page.eval<string[]>(names);
    expect(found).not.toContain("Assign to me");
    expect(found.length).toBeLessThan(5);
    // Linear's Escape clears the search, then closes the panel.
    await page.key("Escape");
    await page.waitFor(`${dialog}.querySelector('input').value===''`);
    await page.key("Escape");
    await page.waitFor(`!${dialog}`);
  });
  await test.step("R1-D55: ⌃⇧I focuses the description when it opens an issue seen before", async () => {
    const page = await open(); // the default board view, where TEST-1 is on screen
    await page.click('[data-key="TEST-1"]');
    await page.waitFor(`!!document.getElementById('description')`);
    await page.key("Enter");
    await page.waitFor(`${shownView}==='page'`);
    await page.key("Escape");
    await page.waitFor(`!${shownIssue}`);
    await page.key("i", "ctrl", "shift");
    await page.waitFor(`document.activeElement?.id==='description'`);
    await sleep(300);
    expect(await page.eval(`document.activeElement?.id`)).toBe("description");
  });
  await test.step("R1-D37: a document's palette offers no board commands, and Escape still leaves it", async () => {
    const p = await open("?issue=TEST-2&view=side");
    await p.waitFor(`!!document.getElementById('comment')`);
    await p.click("#issue-options");
    await p.click("text=Add document…");
    await p.waitFor(`document.activeElement?.getAttribute('aria-label')==='Document title'`);
    await p.type("Palette document");
    await p.click('[aria-label="Document options"]');
    await p.key("Escape");
    await p.eval(`document.activeElement?.blur()`);
    await palette(p, "filter");
    await p.waitFor(`!${rows}.some(t=>t.includes('Add filter'))`);
    for (const name of ["Show display options", "Find in view", "Move down"]) {
      await p.eval(
        `(()=>{const i=document.querySelector('.menu-input input');Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(i,'');i.dispatchEvent(new Event('input',{bubbles:true}))})()`,
      );
      await p.type(name);
      await sleep(100);
      expect(await p.eval<string[]>(rows)).not.toContain(expect.stringContaining(name));
    }
    await p.key("Escape");
    await p.key("f");
    await p.key("Escape");
    await p.waitFor(`!!!${shownDocument}`);
  });
  await test.step("R1-D38: below 768px the Menu button and [ open the sidebar over the page", async () => {
    const p = await open("", { width: 700, height: 800 });
    expect(await p.eval(navShown)).toBe(false);
    await p.click('button[aria-label="Menu"]');
    await p.waitFor(navShown);
    await p.click('nav[aria-label="Main navigation"] a[href="/my-issues"]'); // My issues closes it
    await p.waitFor(`!${navShown}`);
    await p.key("[");
    await p.waitFor(navShown);
    await p.key("Escape");
    await p.waitFor(`!${navShown}`);
  });
  await test.step("R3-chrome-D3: a wide window's hidden sidebar comes back from the header's Menu button: hover peeks, click expands (Linear r5)", async () => {
    const p = await open("");
    await p.key("[");
    await p.waitFor(`!${navShown}`);
    expect(await p.eval(`document.querySelector('button[aria-label="Menu"]')?.getAttribute('data-title') ?? document.querySelector('button[aria-label="Menu"]')?.title`)).toContain("Expand navigation sidebar");
    await p.hover('button[aria-label="Menu"]');
    await p.waitFor(`${navShown} && !!document.querySelector('nav[data-sidebar-peek]')`);
    // Linear's peek floats below the header: the toggle it came from stays on top and reachable.
    expect(await p.eval(`(()=>{const b=document.querySelector('button[aria-label="Menu"]').getBoundingClientRect();return !!document.elementFromPoint(b.x+b.width/2,b.y+b.height/2)?.closest('button[aria-label="Menu"]')})()`)).toBe(true);
    // The pointer on the page closes it (Linear's floating backdrop covers the page, so this is a raw move, not a hover).
    await p.cmd("Input.dispatchMouseEvent", { type: "mouseMoved", x: 720, y: 450 });
    await p.waitFor(`!${navShown}`);
    await p.click('button[aria-label="Menu"]');
    await p.waitFor(`${navShown} && !document.querySelector('nav[data-sidebar-peek]')`);
    expect(await p.eval(`getComputedStyle(document.querySelector('button[aria-label="Menu"]')).display`)).toBe("none");
  });
});

test("boot shell: Linear's splash paints before the app, lines up with its panel and hands over without a jump", async ({ open }) => {
  const app = await open();
  const page = app.page;
  const box = (selector: string) =>
    `(()=>{const r=document.querySelector(${JSON.stringify(selector)})?.getBoundingClientRect();return r?[r.x,r.y,r.width,r.height].map(Math.round):null})()`;
  // Holds the boards request so the shell can be measured; each reload takes a fresh gate.
  let release = () => {};
  let gate = Promise.resolve();
  const hold = () => (gate = new Promise<void>((r) => (release = r)));
  await page.route("**/api/boards", async (route) => {
    await gate;
    await route.continue();
  });
  const bootAndMeasure = async () => {
    hold();
    await page.reload();
    await app.waitFor(`!!document.getElementById('loading-panel')`);
    expect(await app.eval(`document.getElementById('root').textContent`)).toBe("");
    const panel = await app.eval<number[]>(box("#loading-panel"));
    release();
    await app.waitFor(`!document.getElementById('loading')&&document.body.classList.contains('loaded')&&!!document.querySelector('[data-key]')`, 15000);
    expect(await app.eval(box("main"))).toEqual(panel);
    return panel;
  };

  await test.step("the shell: sidebar colour, the panel right of the 244px column, our logo fading in after 1s", async () => {
    hold();
    await page.reload();
    await app.waitFor(`!!document.getElementById('loading-content')`);
    expect(await app.eval(`getComputedStyle(document.getElementById('loading')).backgroundColor`)).toBe(
      await app.eval(`getComputedStyle(document.body).backgroundColor`),
    );
    expect((await app.eval<number[]>(box("#loading-panel")))[0]).toBe(244);
    expect(await app.eval(`getComputedStyle(document.getElementById('loading-panel')).borderRadius`)).toBe("12px");
    expect(await app.eval(box("#loading-logo"))).toEqual(expect.arrayContaining([32, 32]));
    // Linear's dark --content-color.
    expect(await app.eval(`getComputedStyle(document.querySelector('#loading-logo path')).fill`)).toBe("rgb(107, 111, 118)");
    expect(Number(await app.eval(`getComputedStyle(document.getElementById('loading-content')).opacity`))).toBeLessThan(0.5);
    await app.waitFor(`getComputedStyle(document.getElementById('loading-content')).opacity==='1'`, 3000);
    // "Loading…" under the logo stays invisible until ~8.8s.
    expect(await app.eval(`getComputedStyle(document.getElementById('loading-text')).opacity`)).toBe("0");
    release();
    await app.waitFor(`!document.getElementById('loading')&&!!document.querySelector('[data-key]')`, 15000);
  });

  await test.step("the app's <main> takes the panel's exact box", async () => {
    expect((await bootAndMeasure())[0]).toBe(244);
  });

  await test.step("a hidden sidebar is read before first paint: no column, and still no jump", async () => {
    await app.eval(`localStorage.setItem('better-jira:sidebar','hidden')`);
    expect((await bootAndMeasure())[0]).toBe(0);
    await app.eval(`localStorage.setItem('better-jira:sidebar','shown')`);
  });
  await page.unroute("**/api/boards");
});
