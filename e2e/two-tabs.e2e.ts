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
