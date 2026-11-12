import { expect, test, fixture, sleep, type App as Page } from "./app";

// Two tabs of one browser (one context: shared IndexedDB, storage and locks) on a writable site faked in each page.
// Ops land in `window.__ops`; a create's answer waits for `window.__release()`, so the issue stays "being created".
// `window.__release(answer)` answers with `answer` instead of the created issue.
const setup = `(()=>{const real=fetch;window.__ops=[];
window.fetch=async(input,init)=>{const path=new URL(String(input),location.href).pathname;
 if(path==='/api/client'){const client=await (await real(input,init)).json();return Response.json({...client,writable:true});}
 const m=path.match(/^\\/api\\/issues\\/([^/]+)\\/ops$/);if(!m)return real(input,init);
 const {ops}=JSON.parse(init.body);window.__ops.push({key:m[1],ops});
 if(ops[0]?.op==='create'){const answer=await new Promise(r=>{window.__release=r});return Response.json(answer??{key:'TEST-99',created:{[m[1]]:'TEST-99'},others:[]});}
 return Response.json({key:m[1],created:{},others:[]});
};})()`;
const MENU = '[role="dialog"][aria-label="Issue options"]';
const DB = "better-jira:local:v1:https://example.atlassian.net/audit-me";
const saved = `document.querySelector('[aria-label="Local save status"]')?.textContent==="Saved locally"`;
/** Whether the saved local change to `key` has this priority. */
const savedPriority = (key: string, priority: string) =>
  `new Promise(r=>{const o=indexedDB.open(${JSON.stringify(DB)},1);o.onsuccess=()=>{const g=o.result.transaction('state').objectStore('state').get('workspace');g.onsuccess=()=>{r(!!g.result?.changes?.some(c=>c.key==='${key}'&&c.issue?.priority===${JSON.stringify(priority)}));o.result.close();};};})`;

/** Creates an issue in `page`; its create stays unanswered. Returns its app key. */
async function createHeld(page: Page) {
  await page.key("c");
  await page.waitFor(
    `document.activeElement===document.querySelector('[aria-label="Issue title"]')`,
  );
  await page.type("Two tabs");
  await page.key("Enter", "meta");
  // Until Jira answers, the toast shows the title alone; its subject carries the app key.
  const key = await page.waitFor<string>(`document.querySelector("[data-toast-subject]")?.dataset.toastSubject`);
  expect(await page.eval(`document.querySelector("[data-toast]").textContent`)).toBe("Issue createdTwo tabsView issue");
  await page.waitFor(`window.__ops.some(w=>w.ops[0]?.op==='create')`);
  await page.waitFor(saved);
  return key;
}
/** Opens a board card's right-click menu. */
const cardMenu = (page: Page, key: string) =>
  page.eval(
    `(()=>{const n=document.querySelector('[data-key="${key}"]'),r=n.getBoundingClientRect();
n.dispatchEvent(new MouseEvent('contextmenu',{bubbles:true,cancelable:true,clientX:r.x+10,clientY:r.y+10}))})()`,
  );
/** Sets another priority on a board card through its right-click menu. Returns the priority picked. */
async function setPriority(page: Page, key: string) {
  await cardMenu(page, key);
  await page.hover(`${MENU} [cmdk-item][data-value="Priority"]`);
  const pick = await page.waitFor<string>(
    `[...document.querySelectorAll('[role="dialog"][aria-label="Priority"] [cmdk-item]')].map(n=>n.dataset.value).find(v=>v&&v!=='Normal'&&v!=='No priority')`,
  );
  await page.click(`[role="dialog"][aria-label="Priority"] [cmdk-item][data-value="${pick}"]`);
  return pick;
}
/** Moves a board card to another status through its right-click menu. */
async function setStatus(page: Page, key: string) {
  await cardMenu(page, key);
  await page.hover(`${MENU} [cmdk-item][data-value="Status"]`);
  const pick = await page.waitFor<string>(
    `[...document.querySelectorAll('[role="dialog"][aria-label="Status"] [cmdk-item]')].map(n=>n.dataset.value).find(v=>v&&!/backlog/i.test(v))`,
  );
  await page.click(`[role="dialog"][aria-label="Status"] [cmdk-item][data-value="${pick}"]`);
}
const sentTo = (key: string) => `window.__ops.filter(w=>w.key==='${key}').flatMap(w=>w.ops)`;

test("two tabs: a second tab edits an issue the first is still creating", async ({ open }) => {
  const one = await open("", { setup });
  const key = await createHeld(one);
  const two = await open("", { setup, tabOf: one });
  let priority = "";

  await test.step("sync check 7: an edit of another issue goes out at once, though the new issue's edit waits", async () => {
    await two.waitFor(`!!document.querySelector('[data-key="${key}"]')`);
    priority = await setPriority(two, key);
    await setPriority(two, "TEST-2");
    await two.waitFor(`${sentTo("TEST-2")}.length>0`, 8000);
    expect(await two.eval(`window.__ops.map(w=>w.key)`)).toEqual(["TEST-2"]);
  });

  await test.step("sync review 3: once tab one's create lands, tab two's edit goes to the Jira key", async () => {
    await one.eval(`window.__release()`);
    const ops = await two.waitFor<any[]>(
      `(()=>{const o=${sentTo("TEST-99")};return o.length&&o})()`,
      8000,
    );
    expect(ops).toEqual([{ op: "fields", fields: { priority } }]);
    expect(await two.eval(`${sentTo(key)}.length`)).toBe(0);
  });
});

// In each step a third tab (`host`) holds the browser context, so the creating tab can close on its own. It is read-only:
// a writable open tab takes a closing tab's create over too (BJ-19), and the steps watch which tab sends it.
test("two tabs: when the creating tab closes, another tab sends the create with every tab's edits", async ({
  open,
}) => {
  await test.step("sync review 3: when the tab creating an issue closes first, the second tab sends the create itself, with its edit", async () => {
    const host = await open("");
    const one = await open("", { setup, tabOf: host });
    const key = await createHeld(one);
    const two = await open("", { setup, tabOf: host });
    await two.waitFor(`!!document.querySelector('[data-key="${key}"]')`);
    const priority = await setPriority(two, key);
    await sleep(1500); // nothing is sent while the creating tab is open
    expect(await two.eval(`window.__ops.length`)).toBe(0);
    await one.close();
    const create = await two.waitFor<any>(`${sentTo(key)}.find(o=>o.op==='create')`, 8000);
    expect(create.fields).toMatchObject({ summary: "Two tabs", priority });
    // The same client id as tab one's send, so if that send reached Jira this one gets the same issue back.
    expect(create.client).toMatch(new RegExp(`^${key}@`));
  });

  await test.step("sync review 2-3: exactly one of the open tabs sends the create, with every tab's edits", async () => {
    const host = await open("");
    const one = await open("", { setup, tabOf: host });
    const key = await createHeld(one);
    // Each tab edits while it is the newest: a background tab's menus don't open.
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
    await expect.poll(count, { timeout: 8000 }).toBeGreaterThan(0);
    // Both tabs see the creator gone; give the slower one time to send a second create if it would.
    await sleep(2500);
    expect(await count()).toBe(1);
    const [create] = [...(await two.eval<any[]>(creates)), ...(await three.eval<any[]>(creates))];
    expect(create.fields.priority).toBe(priority);
    expect(create.fields.status).not.toBe("backlog");
  });
});

test("two tabs: a taken-over create keeps its order and the closed tab's latest changes", async ({
  open,
}) => {
  await test.step("sync review 2-5: a create taken over from a closed tab goes before the jobs that name its key", async () => {
    const host = await open("");
    const one = await open("", { setup, tabOf: host });
    const key = await createHeld(one);
    const two = await open("", { setup, tabOf: host });
    await two.waitFor(`!!document.querySelector('[data-key="${key}"]')`);
    // A related issue made in tab two links to the issue tab one is creating, so its create waits for that key.
    await cardMenu(two, key);
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
      `/^TEST-NEW\\d+$/.test(document.querySelector("[data-toast-subject]")?.dataset.toastSubject??"")`,
    );
    await sleep(1500); // nothing is sent while the creating tab is open
    expect(await two.eval(`window.__ops.length`)).toBe(0);
    await one.close();
    const first = await two.waitFor<any>(`window.__ops[0]`, 8000);
    expect([first.key, first.ops[0].op]).toEqual([key, "create"]);
  });

  await test.step("sync review 3-5: a tab that takes over a closed tab's changes at load sends what that tab saved last", async () => {
    const host = await open("");
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
    await one.waitFor(savedPriority(key, priority));
    await one.waitFor(saved);
    await one.close();
    const create = await two.waitFor<any>(`${sentTo(key)}.find(o=>o.op==='create')`, 8000);
    expect(create.fields.priority).toBe(priority);
  });
});

test("two tabs: BJ-19 a closing tab hands its unsent create to an open tab at once, though that tab never edited it", async ({
  open,
}) => {
  const host = await open("");
  const one = await open("", { setup, tabOf: host });
  const key = await createHeld(one);
  const two = await open("", { setup, tabOf: host });
  await two.waitFor(`!!document.querySelector('[data-key="${key}"]')`);
  // Tab two has no write waiting on the create: before, it was sent only at a tab's next load.
  await one.close();
  const create = await two.waitFor<any>(`${sentTo(key)}.find(o=>o.op==='create')`, 3000);
  expect(create.fields).toMatchObject({ summary: "Two tabs" });
  expect(create.client).toMatch(new RegExp(`^${key}@`));
});

test("two tabs: BJ-23 an issue its creating tab discards takes the other tab's edits of it along", async ({
  open,
}) => {
  const one = await open("", { setup });
  const key = await createHeld(one);
  const two = await open("", { setup, tabOf: one });
  await two.waitFor(`!!document.querySelector('[data-key="${key}"]')`);
  // Tab two's edit waits for tab one's create.
  await setPriority(two, key);
  await two.waitFor(saved);
  // Jira refuses the create: tab one discards the issue, and tab two lets go of it and of its edit.
  await one.eval(`window.__release({key:'${key}',error:'Jira refused the issue',created:{},others:[]})`);
  await two.waitFor(`!document.querySelector('[data-key="${key}"]')`, 8000);
  await two.waitFor(`document.querySelector('[data-toast]')?.textContent === "Two tabs wasn't created in Jira, so your changes to it were discarded."`);
  expect(await two.eval(`document.body.textContent.includes("Waiting for another tab to create")`)).toBe(false);
  // Its outbox lets the waiting edit go too: nothing is sent, and nothing waits on it any more.
  expect(await two.eval(`window.__ops.length`)).toBe(0);
  expect(await two.eval(`!!document.querySelector('[data-key="TEST-2"]')`)).toBe(true);
});


test("BJ-169: goodbye takes over edits of an issue Jira created after this tab loaded", async ({ open }) => {
  await fixture.reset({ writable: true, createSuccess: true });
  const landing = `(()=>{const real=fetch;window.__ops=[];
    window.fetch=async(input,init)=>{const m=new URL(String(input),location.href).pathname.match(/^\\/api\\/issues\\/([^/]+)\\/ops$/);
      if(!m)return real(input,init);const {ops}=JSON.parse(init.body);window.__ops.push({key:m[1],ops});
      if(ops[0]?.op==='create')await new Promise(r=>window.__release=r);
      else if(window.__holdWrites)return new Promise(()=>{});
      return real(input,init);
    };})()`;
  const host = await open("");
  const one = await open("", { setup: landing, tabOf: host });
  const key = await createHeld(one);
  const two = await open("", { tabOf: host });
  await two.waitFor(`!!document.querySelector('[data-key="${key}"]')`);
  await one.eval(`window.__release()`);
  await one.waitFor(`!!document.querySelector('[data-key="TEST-90"]')`);
  await one.front();
  await one.eval(`window.__holdWrites=true`);
  const priority = await setPriority(one, "TEST-90");
  await one.waitFor(savedPriority("TEST-90", priority));
  await one.waitFor(saved);
  await one.close();
  await expect.poll(async () => (await fixture.log()).writes.some(w => w.key === "TEST-90" && w.ops.some((op: any) => op.fields?.priority === priority)), { timeout: 8000 }).toBe(true);
});
