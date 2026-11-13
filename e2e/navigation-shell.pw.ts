import { expect, test, sleep, type App as Page, fixture, shownDocument, shownIssue, shownView } from "./app";

const nav = `document.querySelector('nav[aria-label="Main navigation"]')`;
const navShown = `(()=>{const n=${nav};return !!n&&n.getClientRects().length>0})()`;
const rows = `[...document.querySelectorAll('[cmdk-item]')].map(n=>n.textContent)`;
const highlighted = `document.querySelector('[cmdk-item][data-selected=true]')?.textContent`;
async function palette(p: Page, query: string) {
  await p.key("k", "meta");
  await p.waitFor(`!!document.querySelector('[cmdk-input]')`);
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
    await page.waitFor(`!document.querySelector('[cmdk-input]')`);
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
        `(()=>{const i=document.querySelector('[cmdk-input]');Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(i,'');i.dispatchEvent(new Event('input',{bubbles:true}))})()`,
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
});
