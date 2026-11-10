import { afterAll, expect, test } from "bun:test";
import { open, stop, type Page } from "./harness";
afterAll(stop);

// Two tabs of one browser (one context: shared IndexedDB, storage and locks) on a writable site faked in each page.
// Ops land in `window.__ops`; a create's answer waits for `window.__release()`, so the issue stays "being created".
const setup = `(()=>{const real=fetch;window.__ops=[];
window.fetch=async(input,init)=>{const path=new URL(String(input),location.href).pathname;
 if(path==='/api/client'){const client=await (await real(input,init)).json();return Response.json({...client,writable:true});}
 const m=path.match(/^\\/api\\/issues\\/([^/]+)\\/ops$/);if(!m)return real(input,init);
 const {ops}=JSON.parse(init.body);window.__ops.push({key:m[1],ops});
 if(ops[0]?.op==='create'){await new Promise(r=>{window.__release=r});return Response.json({key:'TEST-99',created:{[m[1]]:'TEST-99'},others:[]});}
 return Response.json({key:m[1],created:{},others:[]});
};})()`;
const MENU = '[role="dialog"][aria-label="Issue options"]';

/** Creates an issue in `page`; its create stays unanswered. Returns its app key. */
async function createHeld(page: Page) {
  await page.key("c");
  await page.waitFor(
    `document.activeElement===document.querySelector('[aria-label="Issue title"]')`,
  );
  await page.type("Two tabs");
  await page.key("Enter", "meta");
  const toast = await page.waitFor<string>(`document.querySelector("[data-toast]")?.textContent`);
  const key = toast.match(/^Created (TEST-NEW\d+)/)![1]!;
  await page.waitFor(`window.__ops.some(w=>w.ops[0]?.op==='create')`);
  await page.waitFor(
    `document.querySelector('[aria-label="Local save status"]')?.textContent==="Saved locally"`,
  );
  return key;
}
/** Sets another priority on a board card through its right-click menu. Returns the priority picked. */
async function setPriority(page: Page, key: string) {
  await page.eval(
    `(()=>{const n=document.querySelector('[data-key="${key}"]'),r=n.getBoundingClientRect();
n.dispatchEvent(new MouseEvent('contextmenu',{bubbles:true,cancelable:true,clientX:r.x+10,clientY:r.y+10}))})()`,
  );
  await page.click(`${MENU} [cmdk-item][data-value="Priority"]`);
  const pick = await page.waitFor<string>(
    `[...document.querySelectorAll('[role="dialog"] [cmdk-item]')].map(n=>n.dataset.value).find(v=>v&&v!=='Normal'&&v!=='Priority')`,
  );
  await page.click(`[role="dialog"] [cmdk-item][data-value="${pick}"]`);
  return pick;
}
const sentTo = (key: string) => `window.__ops.filter(w=>w.key==='${key}').flatMap(w=>w.ops)`;

test("sync check 7, sync review 3: a second tab's edit of an issue the first is creating goes to its Jira key, and doesn't hold up its other edits", async () => {
  const one = await open("", { setup });
  try {
    const key = await createHeld(one);
    const two = await open("", { setup, tabOf: one });
    try {
      await two.waitFor(`!!document.querySelector('[data-key="${key}"]')`);
      const priority = await setPriority(two, key);
      // An edit of another issue goes out at once, though the new issue's edit waits.
      await setPriority(two, "TEST-2");
      await two.waitFor(`${sentTo("TEST-2")}.length>0`, 8000);
      expect(await two.eval(`window.__ops.map(w=>w.key)`)).toEqual(["TEST-2"]);
      // Tab one's create lands: tab two's edit goes to the Jira key.
      await one.eval(`window.__release()`);
      const ops = await two.waitFor<any[]>(
        `(()=>{const o=${sentTo("TEST-99")};return o.length&&o})()`,
        8000,
      );
      expect(ops).toEqual([{ op: "fields", fields: { priority } }]);
      expect(await two.eval(`${sentTo(key)}.length`)).toBe(0);
    } finally {
      await two.close();
    }
  } finally {
    await one.close();
  }
});

test("sync review 3: when the tab creating an issue closes first, the second tab sends the create itself, with its edit", async () => {
  // A third tab holds the browser context, so the creating tab can close on its own.
  const host = await open("", { setup });
  try {
    const one = await open("", { setup, tabOf: host });
    const key = await createHeld(one);
    const two = await open("", { setup, tabOf: host });
    await two.waitFor(`!!document.querySelector('[data-key="${key}"]')`);
    const priority = await setPriority(two, key);
    await Bun.sleep(1500);
    expect(await two.eval(`window.__ops.length`)).toBe(0);
    await one.close();
    const create = await two.waitFor<any>(`${sentTo(key)}.find(o=>o.op==='create')`, 8000);
    expect(create.fields).toMatchObject({ summary: "Two tabs", priority });
    // The same client id as tab one's send, so if that send reached Jira this one gets the same issue back.
    expect(create.client).toMatch(new RegExp(`^${key}@`));
  } finally {
    await host.close();
  }
});

/** Moves a board card to another status through its right-click menu. */
async function setStatus(page: Page, key: string) {
  await page.eval(
    `(()=>{const n=document.querySelector('[data-key="${key}"]'),r=n.getBoundingClientRect();
n.dispatchEvent(new MouseEvent('contextmenu',{bubbles:true,cancelable:true,clientX:r.x+10,clientY:r.y+10}))})()`,
  );
  await page.click(`${MENU} [cmdk-item][data-value="Status"]`);
  const pick = await page.waitFor<string>(
    `[...document.querySelectorAll('[role="dialog"][aria-label="Change status"] [cmdk-item]')].map(n=>n.dataset.value).find(v=>v&&!/backlog/i.test(v))`,
  );
  await page.click(`[role="dialog"][aria-label="Change status"] [cmdk-item][data-value="${pick}"]`);
}

test("sync review 2-3: when the creating tab closes, exactly one of the open tabs sends the create, with every tab's edits", async () => {
  const host = await open("", { setup });
  try {
    const one = await open("", { setup, tabOf: host });
    const key = await createHeld(one);
    // Each tab edits while it is the newest: a background tab's menus don't open.
    const saved = `document.querySelector('[aria-label="Local save status"]')?.textContent==="Saved locally"`;
    const two = await open("", { setup, tabOf: host });
    await two.waitFor(`!!document.querySelector('[data-key="${key}"]')`);
    const priority = await setPriority(two, key);
    await two.waitFor(saved);
    const three = await open("", { setup, tabOf: host });
    await three.waitFor(`!!document.querySelector('[data-key="${key}"]')`);
    await setStatus(three, key);
    await three.waitFor(saved);
    await one.close();
    const creates = `${sentTo(key)}.filter(o=>o.op==='create')`;
    const count = async () =>
      (await two.eval<number>(`${creates}.length`)) +
      (await three.eval<number>(`${creates}.length`));
    for (let i = 0; i < 80 && !(await count()); i++) await Bun.sleep(100);
    // Both tabs see the creator gone; give the slower one time to send a second create if it would.
    await Bun.sleep(2500);
    expect(await count()).toBe(1);
    const [create] = [...(await two.eval<any[]>(creates)), ...(await three.eval<any[]>(creates))];
    expect(create.fields.priority).toBe(priority);
    expect(create.fields.status).not.toBe("backlog");
    await two.close();
    await three.close();
  } finally {
    await host.close();
  }
});

test("sync review 2-5: a create taken over from a closed tab goes before the jobs that name its key", async () => {
  const host = await open("", { setup });
  try {
    const one = await open("", { setup, tabOf: host });
    const key = await createHeld(one);
    const two = await open("", { setup, tabOf: host });
    await two.waitFor(`!!document.querySelector('[data-key="${key}"]')`);
    // A related issue made in tab two links to the issue tab one is creating, so its create waits for that key.
    await two.eval(
      `(()=>{const n=document.querySelector('[data-key="${key}"]'),r=n.getBoundingClientRect();
n.dispatchEvent(new MouseEvent('contextmenu',{bubbles:true,cancelable:true,clientX:r.x+10,clientY:r.y+10}))})()`,
    );
    await two.click(`${MENU} [cmdk-item][data-value="Create related"]`);
    const issue = await two.waitFor<string>(
      `[...document.querySelectorAll('[role="dialog"] [cmdk-item]')].map(n=>n.dataset.value).find(v=>/^(Create related › )?Issue…$/.test(v))`,
    );
    await two.click(`[role="dialog"] [cmdk-item][data-value="${issue}"]`);
    await two.waitFor(
      `document.activeElement===document.querySelector('[aria-label="Issue title"]')`,
    );
    await two.type("Related");
    await two.key("Enter", "meta");
    await two.waitFor(
      `/^Created TEST-NEW\\d+/.test(document.querySelector("[data-toast]")?.textContent??"")`,
    );
    await Bun.sleep(1500);
    expect(await two.eval(`window.__ops.length`)).toBe(0);
    await one.close();
    const first = await two.waitFor<any>(`window.__ops[0]`, 8000);
    expect([first.key, first.ops[0].op]).toEqual([key, "create"]);
    await two.close();
  } finally {
    await host.close();
  }
});

test("sync review 3-5: a tab that takes over a closed tab's changes at load sends what that tab saved last", async () => {
  const host = await open("", { setup });
  try {
    const one = await open("", { setup, tabOf: host });
    const key = await createHeld(one);
    // Tab one holds the outbox lock, so tab two's load reads the saved data now but claims it only once one closes.
    await one.eval(
      `navigator.locks.request("better-jira-outbox",()=>new Promise(()=>{}));undefined`,
    );
    const two = await open("", { setup, tabOf: host });
    await two.waitFor(`!!document.querySelector('[data-key="${key}"]')`);
    // Meanwhile tab one edits the new issue and saves it.
    await one.front();
    const priority = await setPriority(one, key);
    await Bun.sleep(500);
    await one.waitFor(
      `document.querySelector('[aria-label="Local save status"]')?.textContent==="Saved locally"`,
    );
    await one.close();
    const create = await two.waitFor<any>(`${sentTo(key)}.find(o=>o.op==='create')`, 8000);
    expect(create.fields.priority).toBe(priority);
    await two.close();
  } finally {
    await host.close();
  }
});
