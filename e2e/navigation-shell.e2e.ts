import { afterAll, expect, test } from "bun:test";
import { APP, open, stop, type Page } from "./harness";
afterAll(stop);

const nav = `document.querySelector('nav[aria-label="Main navigation"]')`;
const navShown = `(()=>{const n=${nav};return !!n&&n.getClientRects().length>0})()`;
const rows = `[...document.querySelectorAll('[cmdk-item]')].map(n=>n.textContent)`;
const highlighted = `document.querySelector('[cmdk-item][data-selected=true]')?.textContent`;
async function palette(p: Page, query: string) {
  await p.key("k", "meta");
  await p.waitFor(`!!document.querySelector('[cmdk-input]')`);
  await p.type(query);
}

test("R1-D38: below 768px the Menu button and [ open the sidebar over the page", async () => {
  const p = await open("", { width: 700, height: 800 });
  try {
    expect(await p.eval(navShown)).toBe(false);
    await p.click('button[aria-label="Menu"]');
    await p.waitFor(navShown);
    await p.click('nav[aria-label="Main navigation"] button:nth-of-type(4)'); // My issues closes it
    await p.waitFor(`!${navShown}`);
    await p.key("[");
    await p.waitFor(navShown);
    await p.key("Escape");
    await p.waitFor(`!${navShown}`);
  } finally {
    await p.close();
  }
});

test("R1-D57: the collapsed sidebar stays collapsed after a reload", async () => {
  const p = await open();
  try {
    await p.key("[");
    await p.waitFor(`!${nav}`);
    await p.reload();
    expect(await p.eval(`!${nav}`)).toBe(true);
    await p.key("[");
    await p.waitFor(`!!${nav}`);
  } finally {
    await p.close();
  }
});

test("R1-D56: My issues is in the URL and survives a reload", async () => {
  const p = await open();
  try {
    await p.keys("gm");
    await p.waitFor(`new URL(location.href).searchParams.get('mine')==='1'`);
    await p.cmd("Page.reload"); // no fixture issue is the audit user's, so there are no cards to wait for
    await Bun.sleep(300);
    await p.waitFor(
      `document.querySelector('nav[aria-label="Breadcrumb"] [aria-label="Issues"]')?.textContent==='My issues'`,
    );
    await p.keys("ge");
    await p.waitFor(`!new URL(location.href).searchParams.has('mine')`);
  } finally {
    await p.close();
  }
});

test("R1-D37: a document's palette offers no board commands, and Escape still leaves it", async () => {
  const p = await open("?issue=TEST-2&view=side");
  try {
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
      await Bun.sleep(100);
      expect(await p.eval<string[]>(rows)).not.toContain(expect.stringContaining(name));
    }
    await p.key("Escape");
    await p.key("f");
    await p.key("Escape");
    await p.waitFor(`!new URL(location.href).searchParams.has('document')`);
  } finally {
    await p.close();
  }
});

test("R1-D54: the scoped palette lists only issue commands that apply", async () => {
  const p = await open();
  try {
    await fetch(`${APP}__fixture`, { method: "POST", body: JSON.stringify({ subtask: true }) });
    await p.reload();
    await p.click('[data-key="TEST-5"]');
    await p.key("Escape");
    await palette(p, "Open");
    await p.waitFor(`${rows}.some(t=>t.includes('Open sub-issue'))`);
    expect(await p.eval<string[]>(rows)).not.toContain(
      expect.stringContaining("Open parent issue"),
    );
    expect(await p.eval<string[]>(rows)).not.toContain(
      expect.stringContaining("Open sub-issues of parent"),
    );
    expect(await p.eval(highlighted)).toContain("Open sub-issue");
  } finally {
    await p.close();
  }
});

test("R1-D62: ⌘K names the favorite toggle from the issue's state", async () => {
  const p = await open();
  try {
    await p.key("j");
    await palette(p, "favorite");
    await p.waitFor(`${rows}.some(t=>t.includes('Mark as favorite'))`);
    await p.key("Enter");
    await palette(p, "favorite");
    await p.waitFor(`${rows}.some(t=>t.includes('Unfavorite issue'))`);
  } finally {
    await p.close();
  }
});

test("R1-D61: shortcut search matches the shown keys, and a single letter is a whole key", async () => {
  const p = await open();
  try {
    await p.key("/", "meta");
    const dialog = `document.querySelector('[role=dialog][aria-label="Keyboard Shortcuts"]')`;
    const names = `[...${dialog}.querySelectorAll('dt')].map(n=>n.textContent)`;
    await p.waitFor(`!!${dialog}`);
    await p.type("g then");
    await p.waitFor(`${names}.includes('Go to active issues')`);
    await p.eval(
      `(()=>{const i=${dialog}.querySelector('input');Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(i,'');i.dispatchEvent(new Event('input',{bubbles:true}))})()`,
    );
    await p.type("shift d");
    await p.waitFor(`${names}.includes('Set due date')`);
    const found = await p.eval<string[]>(names);
    expect(found).not.toContain("Assign to me");
    expect(found.length).toBeLessThan(5);
  } finally {
    await p.close();
  }
});

test("R1-D55: ⌃⇧I focuses the description when it opens an issue seen before", async () => {
  const p = await open();
  try {
    await p.click('[data-key="TEST-1"]');
    await p.waitFor(`!!document.getElementById('description')`);
    await p.key("Enter");
    await p.waitFor(`new URL(location.href).searchParams.get('view')==='page'`);
    await p.key("Escape");
    await p.waitFor(`!new URL(location.href).searchParams.get('issue')`);
    await p.key("i", "ctrl", "shift");
    await p.waitFor(`document.activeElement?.id==='description'`);
    await Bun.sleep(300);
    expect(await p.eval(`document.activeElement?.id`)).toBe("description");
  } finally {
    await p.close();
  }
});
