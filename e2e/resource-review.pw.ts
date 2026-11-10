import { expect, test, sleep, type App as Page } from "./app";

async function create(page: Page) {
  await page.waitFor(`!!document.getElementById('comment')`);
  await page.click("#issue-options");
  await page.click("text=Add document…");
  await page.waitFor(`!!document.getElementById('resource-document')`);
}
const savedDocument = `(async()=>{const [{name}]=await indexedDB.databases();const db=await new Promise((resolve,reject)=>{const r=indexedDB.open(name);r.onsuccess=()=>resolve(r.result);r.onerror=()=>reject(r.error)});try{return await new Promise((resolve,reject)=>{const r=db.transaction('state').objectStore('state').get('workspace');r.onsuccess=()=>resolve(r.result?.changes?.find(c=>c.key==='TEST-2')?.issue?.resources?.[0]);r.onerror=()=>reject(r.error)})}finally{db.close()}})()`;
const viewPrefs = `Object.entries(localStorage).filter(([k])=>k.startsWith('view:'))`;
const mode = `document.querySelector('[data-mode]').dataset.mode`;

test("documents in an issue: forms, full pages, drafts, flushes and undo", async ({ open }) => {
  const page = await open("?issue=TEST-2&view=side");

  await test.step("resource forms reject duplicates and the document palette omits issue commands", async () => {
    await page.waitFor(`!!document.getElementById('comment')`);
    for (let i = 0; i < 2; i++) {
      await page.click("#issue-options");
      await page.click('[cmdk-item][data-value="Add link…"]');
      await page.type("https://example.com/same");
      await page.click("text=Add link");
    }
    expect(await page.eval(`document.querySelectorAll('[aria-label="Resources"] a').length`)).toBe(
      1,
    );
    await create(page);
    await page.eval("document.activeElement?.blur()");
    await page.key("k", "meta");
    await page.type("priority");
    expect(await page.eval(`document.querySelectorAll('[cmdk-item]').length`)).toBe(0);
    await page.key("Escape");
    await page.waitFor(`!document.querySelector('[cmdk-input]')`);
    await page.eval("document.activeElement?.blur()");
    await page.key("Escape");
    await page.waitFor(`!!document.getElementById('comment')`);
  });

  await test.step("documents are full pages without changing the remembered side-panel view", async () => {
    const prefs = await page.eval(viewPrefs);
    await create(page);
    expect(
      await page.eval(`document.querySelector('[data-document]').getBoundingClientRect().width`),
    ).toBeGreaterThan(1000);
    await page.click('[aria-label="Back to issue"]');
    await page.waitFor(`!!document.getElementById('comment')`);
    expect(await page.eval(mode)).toBe("side");
    expect(await page.eval(viewPrefs)).toEqual(prefs);
    await page.click("text=New document");
    await page.waitFor(`!!document.getElementById('resource-document')`);
    await page.eval("document.activeElement?.blur()");
    await page.key("Escape");
    await page.waitFor(`!!document.getElementById('comment')`);
    expect(await page.eval(mode)).toBe("side");
    await page.reload();
    await page.waitFor(`!!document.getElementById('comment')`);
    expect(await page.eval(mode)).toBe("side");
  });

  await test.step("a saved draft is cleared and undo after a failed save stays undone on reopen", async () => {
    await page.goto("?issue=TEST-2&view=page");
    await create(page);
    await page.type("Base");
    await page.click("#resource-document");
    await page.cmd("Input.insertText", { text: "Saved" });
    await page.waitFor(
      `document.querySelector('[aria-label="Local save status"]').textContent.includes('Saved')&&!Object.keys(localStorage).some(k=>k.includes('resource-draft'))`,
    );
    await page.eval("document.activeElement?.blur()");
    await page.click("#resource-document");
    await page.eval(
      `window.failSave=true;const put=IDBObjectStore.prototype.put;IDBObjectStore.prototype.put=function(...args){if(window.failSave&&this.name==='state')throw new DOMException('Quota','QuotaExceededError');return put.apply(this,args)}`,
    );
    await page.cmd("Input.insertText", { text: " plus unsaved" });
    await page.waitFor(
      `document.querySelector('[aria-label="Local save status"]').textContent.includes('Not saved')`,
    );
    await page.eval("window.failSave=false");
    await page.click('[aria-label="Back to issue"]');
    await page.eval("document.activeElement?.blur()");
    await page.key("z", "meta");
    await page.click("text=Base");
    await page.waitFor(`!!document.getElementById('resource-document')`);
    expect(await page.eval(`document.getElementById('resource-document').textContent`)).toBe(
      "Saved",
    );
  });

  await test.step("document edits flush immediately on blur, clean up drafts and coalesce pauses within one focus session", async () => {
    await page.goto("?issue=TEST-2&view=page");
    await create(page);
    await page.type("Flush title");
    await page.click("#resource-document");
    for (const text of ["a", "b", "c"]) {
      await page.cmd("Input.insertText", { text });
      await sleep(700); // a pause past the 600 ms debounce, within one focus session
    }
    await page.cmd("Input.insertText", { text: "d" });
    await page.click('[aria-label="Back to issue"]');
    await page.waitFor(`!!document.getElementById('comment')`);
    await page.click("text=Flush title");
    await page.waitFor(`document.getElementById('resource-document')?.textContent==='abcd'`);
    await page.eval("document.activeElement?.blur()");
    await page.key("z", "meta");
    await page.waitFor(`document.getElementById('resource-document')?.textContent===''`);
    expect(await page.eval(`document.querySelector('[aria-label="Document title"]').value`)).toBe(
      "Flush title",
    );
  });
});

test("document saves that cannot wait: before the debounce, and before the document opens", async ({
  open,
}) => {
  // Each step patches the page's timers or IndexedDB, so each gets its own page.
  for (const boundary of ["blur", "unmount", "pagehide"])
    await test.step(`blur, unmount and pagehide each persist a document before its debounce: ${boundary}`, async () => {
      const page = await open("?issue=TEST-2&view=page");
      await create(page);
      await page.waitFor(
        `document.querySelector('[aria-label="Local save status"]').textContent.includes('Saved')`,
      );
      await page.eval(
        `const timeout=window.setTimeout;window.setTimeout=function(fn,ms,...args){return timeout.call(this,fn,ms===600?60000:ms,...args)}`,
      );
      await page.click("#resource-document");
      await page.cmd("Input.insertText", { text: boundary });
      if (boundary === "blur") await page.eval(`document.activeElement.blur()`);
      if (boundary === "unmount")
        await page.eval(`machines.ui.send({type:'navigate',document:null})`);
      if (boundary === "pagehide")
        await page.eval(`dispatchEvent(new PageTransitionEvent('pagehide'))`);
      await page.waitFor(
        `(${savedDocument}).then(r=>JSON.stringify(r?.body).includes('${boundary}'))`,
      );
      await page.waitFor(`!Object.keys(localStorage).some(k=>k.includes('resource-draft'))`);
    });

  await test.step("a new document waits for its identity save before opening", async () => {
    const page = await open("?issue=TEST-2&view=page");
    await page.waitFor(`!!document.getElementById('comment')`);
    await page.eval(
      `(()=>{const d=Object.getOwnPropertyDescriptor(IDBTransaction.prototype,'oncomplete');Object.defineProperty(IDBTransaction.prototype,'oncomplete',{...d,set(fn){d.set.call(this,function(event){if(this.mode==='readwrite'&&this.objectStoreNames.contains('state'))window.releaseDocumentSave=()=>fn.call(this,event);else fn.call(this,event)})}})})()`,
    );
    await page.click("#issue-options");
    await page.click("text=Add document…");
    await page.waitFor(`!!window.releaseDocumentSave`);
    expect(await page.eval(`!!document.getElementById('resource-document')`)).toBe(false);
    await page.eval("window.releaseDocumentSave()");
    await page.waitFor(`!!document.getElementById('resource-document')`);
    expect((await page.eval<any>(savedDocument)).kind).toBe("document");
  });
});

test("missing documents and legacy links leave the board and the issue usable", async ({
  open,
}) => {
  const page = await open("?document=missing", {
    setup: `const fetchOriginal=window.fetch;window.fetch=async(...args)=>{const response=await fetchOriginal(...args);if(new URL(args[0],location.href).pathname==='/api/issues'){const issues=await response.json();issues.find(i=>i.key==='TEST-2').links=['https://example.com/legacy'];return Response.json(issues)}return response}`,
  });

  await test.step("orphan document links leave board keyboard navigation usable", async () => {
    await page.key("j");
    await page.key("Enter");
    await page.waitFor(`!!document.getElementById('summary')`);
    expect(await page.eval(`new URL(location.href).searchParams.has('document')`)).toBe(false);
    await page.goto("?issue=NOPE-1&document=missing");
    await page.key("j");
    await page.key("Enter");
    await page.waitFor(`!!document.getElementById('summary')`);
  });

  await test.step("legacy links render and removing one preserves the document resource", async () => {
    await page.goto("?issue=TEST-2&view=page");
    await create(page);
    await page.click('[aria-label="Back to issue"]');
    await page.waitFor(`!!document.querySelector('[href="https://example.com/legacy"]')`);
    await page.hover('[href="https://example.com/legacy"]');
    await page.click('[aria-label="Options for https://example.com/legacy"]');
    await page.click('[cmdk-item][data-value="Remove…"]');
    await page.click(
      '[role=dialog][aria-label="Remove this link from the issue?"] button[data-autofocus]',
    );
    expect(await page.eval(`!!document.querySelector('[href="https://example.com/legacy"]')`)).toBe(
      false,
    );
    expect(
      await page.eval(`document.querySelector('[aria-label="Resources"]').textContent`),
    ).toContain("New document");
  });
});
