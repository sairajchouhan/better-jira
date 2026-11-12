import { readFileSync } from "node:fs";
import type { Download } from "@playwright/test";
import { expect, test, sleep, PREFS_KEY, type App as Page, savedAs } from "./app";

const DOC_PAGE = "?issue=TEST-2&view=page";
const SAVED = `document.querySelector('[aria-label="Local save status"]').textContent.includes('Saved')`;

async function create(page: Page, title = "Reference document", body = "A durable document body") {
  await page.waitFor(`!!document.getElementById('comment')`);
  await page.click("#issue-options");
  await page.click("text=Add document…");
  await page.waitFor(`document.activeElement?.getAttribute('aria-label')==='Document title'`);
  await page.type(title);
  await page.click("#resource-document");
  await page.type(body);
  await page.click('[aria-label="Document options"]');
  await page.key("Escape");
  await page.waitFor(SAVED);
}
/** A new document on TEST-2 after a fresh load, so window overrides from an earlier step are gone. */
async function fresh(page: Page, title?: string, body?: string) {
  await page.goto(DOC_PAGE);
  await create(page, title, body);
}
async function downloaded(download: Promise<Download>, name: string) {
  const path = await savedAs(download, name);
  return { text: () => readFileSync(path, "utf8") };
}
/** The saved local workspace (IndexedDB), as the next load reads it. */
const WORKSPACE = `(async()=>{const name=(await indexedDB.databases()).find(d=>d.name.startsWith('better-jira:local:v1:')).name;const db=await new Promise(r=>{const o=indexedDB.open(name);o.onsuccess=()=>r(o.result)});const w=await new Promise(r=>{const q=db.transaction('state').objectStore('state').get('workspace');q.onsuccess=()=>r(q.result)});db.close();return w})()`;
const LOCAL_MEDIA = `split('"collection":"local"').length-1`;
/** True once a saved document holds every one of these texts and a local file. */
const documentSaved = (...texts: string[]) =>
  `${WORKSPACE}.then(w=>w.changes.flatMap(c=>c.issue?.resources??[]).map(r=>JSON.stringify(r)).some(r=>${JSON.stringify(texts)}.every(t=>r.includes(t))&&r.includes('"collection":"local"')))`;
/** Local files in TEST-2's saved description, and in its saved comment draft. */
const savedDescriptionMedia = `${WORKSPACE}.then(w=>JSON.stringify(w.changes.find(c=>c.key==='TEST-2')?.full?.fields?.description??'').${LOCAL_MEDIA})`;
const commentDraftMedia = `Object.keys(localStorage).filter(k=>k.startsWith('better-jira:comment-draft:')&&k.endsWith(':TEST-2')).map(k=>localStorage.getItem(k)).join('').${LOCAL_MEDIA}`;

test("document header, menus and shortcuts act on the document, preserve the parent and survive reload", async ({
  open,
}) => {
  const page = await open("?issue=TEST-2&view=side");
  await page.context.grantPermissions(["clipboard-read", "clipboard-write"]);

  await test.step("header, favorites and registered shortcuts act on the document and preserve the parent", async () => {
    await create(page);
    const url = await page.eval<string>("location.href");
    await page.click('[aria-label="Add document to favorites"]');
    expect(
      await page.eval(
        `document.querySelector('[aria-label="Remove document from favorites"]').getAttribute('aria-checked')`,
      ),
    ).toBe("true");
    await page.key("f", "alt");
    await page.waitFor(`!!document.querySelector('[aria-label="Add document to favorites"]')`);
    await page.key("f", "alt");
    await page.key("r", "shift");
    await page.waitFor(`document.activeElement?.getAttribute('aria-label')==='Document title'`);
    await page.type("Renamed reference");
    await page.click('[aria-label="Document options"]');
    await page.key("Escape");
    await page.key("a", "shift");
    await page.waitFor(`!!document.querySelector('[data-document-author]')`);
    expect(await page.eval(`document.querySelector('[data-document-author]').textContent`)).toBe(
      "Audit user",
    );
    await page.key("s", "meta", "shift");
    await page.waitFor(`!!document.querySelector('[aria-label="Find document subscribers"]')`);
    await page.key("Escape");
    await page.click('[aria-label="Back to issue"]');
    await page.waitFor(`!!document.getElementById('summary')`);
    expect(
      await page.eval(
        `document.querySelector('[aria-label="Add issue to favorites"]').getAttribute('aria-checked')`,
      ),
    ).toBe("false");
    expect(await page.eval(`document.querySelector('[data-mode]').dataset.mode`)).toBe("side");
    await page.click("text=Renamed reference");
    await page.waitFor(`!!document.getElementById('resource-document')`);
    expect(await page.eval("location.href")).toBe(url);
    await page.goto(new URL(url).search);
    await page.waitFor(
      `document.querySelector('[aria-label="Document title"]')?.value==='Renamed reference'`,
    );
    expect(
      await page.eval(
        `document.querySelector('[aria-label="Remove document from favorites"]').getAttribute('aria-checked')`,
      ),
    ).toBe("true");
    await page.reload();
    await page.waitFor(`!!document.querySelector('[data-document-author]')`);
    expect(await page.eval(`document.querySelector('.document-header').textContent`)).toContain(
      "Edited",
    );
  });

  await test.step("owner, checked subscribers, author names and icon survive reload", async () => {
    await fresh(page);
    await page.click('[aria-label^="Document display options"]');
    await page.click('[role="dialog"] input[type="checkbox"]');
    await page.click('[aria-label^="Owned by:"]');
    await page.click('[cmdk-item][data-value="Alex"]');
    await page.click('[aria-label^="Document display options"]');
    expect(await page.eval(`document.querySelector('[aria-label^="Owned by:"]').textContent`)).toBe(
      "Alex",
    );
    await page.key("Escape");
    await page.click('[aria-label="Change document subscribers"]');
    expect(
      await page.eval(`document.querySelector('input[aria-label="Audit user"]').checked`),
    ).toBe(true);
    await page.click('[cmdk-item][data-value="Audit user"]');
    await page.click('[cmdk-item][data-value="Alex"]');
    expect(
      await page.eval(`document.querySelector('input[aria-label="Audit user"]').checked`),
    ).toBe(false);
    expect(await page.eval(`document.querySelector('input[aria-label="Alex"]').checked`)).toBe(
      true,
    );
    await page.key("Escape");
    await page.click('[aria-label="Document icon"]');
    await page.click('[aria-label="Teal"]');
    await page.click('[aria-label="Use calendar icon"]');
    await page.waitFor(SAVED);
    await page.reload();
    await page.waitFor(`!!document.querySelector('[data-document-author]')`);
    expect(
      await page.eval(
        `getComputedStyle(document.querySelector('[aria-label="Document icon"]')).color`,
      ),
    ).toBe("rgb(38, 181, 206)");
    await page.click('[aria-label="Document icon"]');
    expect(
      await page.eval(`document.querySelector('[aria-label="Teal"]').getAttribute('aria-pressed')`),
    ).toBe("true");
    await page.key("Escape");
    await page.click('[aria-label="Change document subscribers"]');
    expect(await page.eval(`document.querySelector('input[aria-label="Alex"]').checked`)).toBe(
      true,
    );
    await page.key("Escape");
    await page.click('[aria-label^="Document display options"]');
    expect(await page.eval(`document.querySelector('[aria-label^="Owned by:"]').textContent`)).toBe(
      "Alex",
    );
    await page.key("Escape");
  });

  await test.step("copy descendants are searchable, hover-opened and keyboard-accessible, and Markdown downloads exact bytes", async () => {
    await fresh(page);
    await page.click('[aria-label="Document options"]');
    await page.waitFor(
      `document.activeElement?.getAttribute('aria-label')==='Find document options'`,
    );
    await page.hover('[cmdk-item][data-value="Copy"]');
    await page.waitFor(`!!document.querySelector('[role="dialog"][aria-label="Copy"]')`);
    expect(
      await page.eval(
        `!!document.querySelector('[role="dialog"][aria-label="Document options"] [cmdk-item][data-value="Download"]')`,
      ),
    ).toBe(true);
    // Linear (RAJ-52 synthetic document): two groups break after Rename… and Remind me, and every item and Copy child has an icon.
    expect(
      await page.eval(
        `['Document options','Copy'].map(l=>{const m=document.querySelector('[role="dialog"][aria-label="'+l+'"]');return [m.querySelectorAll('[cmdk-separator]').length,[...m.querySelectorAll('[cmdk-item]')].every(n=>n.querySelector('svg'))]})`,
      ),
    ).toEqual([
      [2, true],
      [0, true],
    ]);
    // Linear opens the submenu to the right, overlapping by 2px, first row level with Copy, and wide enough for its shortcuts.
    expect(
      await page.eval(
        `(()=>{const menu=document.querySelector('[role="dialog"][aria-label="Document options"]').getBoundingClientRect(),sub=document.querySelector('[role="dialog"][aria-label="Copy"]'),box=sub.querySelector('[cmdk-root]').getBoundingClientRect(),row=document.querySelector('[cmdk-item][data-value="Copy"]').getBoundingClientRect(),first=sub.querySelector('[cmdk-item]').getBoundingClientRect();return [Math.round(menu.right-box.left),Math.abs(first.top-row.top)<=1,[...sub.querySelectorAll('[cmdk-item]')].every(n=>n.scrollWidth<=n.clientWidth)]})()`,
      ),
    ).toEqual([2, true, true]);
    await page.click('[cmdk-item][data-value="Copy title"]');
    expect(await page.eval("navigator.clipboard.readText()")).toBe("Reference document");
    await page.click('[aria-label="Document options"]');
    await page.type("content");
    await page.waitFor(
      `!!document.querySelector('[cmdk-item][data-value="Copy › Copy content as Markdown"]')`,
    );
    await page.key("Enter");
    expect(await page.eval("navigator.clipboard.readText()")).toBe(
      "# Reference document\n\nA durable document body",
    );
    await page.click('[aria-label="Document options"]');
    for (let i = 0; i < 4; i++) await page.key("ArrowDown");
    await page.key("ArrowRight");
    await page.waitFor(`document.activeElement?.getAttribute('aria-label')==='Find copy'`);
    await page.key("ArrowLeft");
    await page.waitFor(
      `document.activeElement?.getAttribute('aria-label')==='Find document options'`,
    );
    await page.key("ArrowRight");
    await page.waitFor(`document.activeElement?.getAttribute('aria-label')==='Find copy'`);
    await page.key("Escape");
    await page.waitFor(
      `!!document.querySelector('[role="dialog"][aria-label="Document options"]')&&!document.querySelector('[role="dialog"][aria-label="Copy"]')`,
    );
    await page.hover('[cmdk-item][data-value="Copy"]');
    await page.click('[cmdk-item][data-value="Copy title as link"]');
    const link = await page.eval<string>("navigator.clipboard.readText()");
    expect(link).toContain("[Reference document](http://127.0.0.1:");
    expect(link).toContain("document=");
    const download = page.page.waitForEvent("download");
    await page.click('[aria-label="Document options"]');
    await page.type("Markdown");
    await page.key("ArrowDown");
    await page.key("Enter");
    const file = await downloaded(download, "Reference document.md");
    expect(await file.text()).toBe("# Reference document\n\nA durable document body");
  });

  await test.step("URL, link and filename escaping, owner check, emoji search and filtered submenus behave like Linear", async () => {
    const title = "Spec [v2] a\\b/c:d*?";
    await fresh(page, title, "Body");
    const id = await page.eval<string>(`new URL(location.href).searchParams.get('document')`),
      copied = async () => {
        const text = await page.eval<string>("navigator.clipboard.readText()");
        await page.eval(`navigator.clipboard.writeText('')`);
        return text;
      };
    await page.click('[aria-label="Copy document URL"]');
    expect(new URL(await copied()).searchParams.get("document")).toBe(id);
    await page.click('[aria-label="Document options"]');
    await page.type("copy URL");
    await page.waitFor(`!!document.querySelector('[cmdk-item][data-value="Copy › Copy URL"]')`);
    await page.key("Enter");
    expect(new URL(await copied()).searchParams.get("document")).toBe(id);
    await page.click('[aria-label="Document options"]');
    await page.hover('[cmdk-item][data-value="Copy"]');
    await page.click('[cmdk-item][data-value="Copy title as link"]');
    expect(await copied()).toStartWith("[Spec \\[v2\\] a\\\\b/c:d*?](http");
    const download = page.page.waitForEvent("download");
    await page.click('[aria-label="Document options"]');
    await page.type("Markdown");
    await page.key("ArrowDown");
    await page.key("Enter");
    expect(await (await downloaded(download, "Spec [v2] a-b-c-d--.md")).text()).toBe(
      `# ${title}\n\nBody`,
    );
    await page.click('[aria-label="Document options"]');
    for (let i = 0; i < 4; i++) await page.key("ArrowDown");
    await page.key("ArrowRight");
    await page.waitFor(`document.activeElement?.getAttribute('aria-label')==='Find copy'`);
    await page.type("ti");
    await page.key("ArrowLeft");
    await sleep(100); // ArrowLeft inside a filter moves the caret; it must not leave the submenu
    expect(await page.eval(`document.activeElement?.getAttribute('aria-label')`)).toBe("Find copy");
    expect(await page.eval(`!!document.querySelector('[role="dialog"][aria-label="Copy"]')`)).toBe(
      true,
    );
    await page.key("Escape");
    await page.key("Escape");
    await page.click('[aria-label^="Document display options"]');
    await page.click('[aria-label^="Owned by:"]');
    await page.waitFor(`!!document.querySelector('[aria-label="Find document owner"]')`);
    expect(
      await page.eval(
        `[document.querySelector('input[aria-label="Audit user"]').checked,document.querySelector('input[aria-label="Alex"]').checked]`,
      ),
    ).toEqual([true, false]);
    await page.key("Escape");
    await page.click('[aria-label="Document icon"]');
    await page.click('[role="tab"]:last-child');
    await page.click('[aria-label="Search document icons"]');
    await page.cmd("Input.insertText", { text: "🚀" });
    await page.waitFor(`document.querySelectorAll('[aria-label$=" emoji"]').length===1`);
    expect(
      await page.eval(
        `document.querySelector('[aria-label$=" emoji"]').getAttribute('aria-label')`,
      ),
    ).toBe("Use 🚀 emoji");
    await page.key("Escape");
  });

  await test.step("copy shortcuts follow Linear: ⌘⇧, URL, ⌘⇧' title, ⌘C title as link, ⌘⌥C Markdown, with the live title; a page selection keeps native copy", async () => {
    await fresh(page);
    await page.click('[aria-label="Document title"]');
    await page.key("End");
    await page.type(" v2");
    await page.eval(
      `document.activeElement?.blur();window.copied=[];navigator.clipboard.writeText=async text=>{window.copied.push(text)}`,
    );
    const id = await page.eval<string>(`new URL(location.href).searchParams.get('document')`);
    await page.key(",", "meta", "shift");
    await page.waitFor("window.copied.length===1");
    expect(new URL(await page.eval<string>("window.copied[0]")).searchParams.get("document")).toBe(
      id,
    );
    await page.key("'", "meta", "shift");
    await page.waitFor("window.copied.length===2");
    expect(await page.eval("window.copied[1]")).toBe("Reference document v2");
    await page.key("c", "meta");
    await page.waitFor("window.copied.length===3");
    expect(await page.eval<string>("window.copied[2]")).toMatch(
      /^\[Reference document v2\]\(http.+document=/,
    );
    await page.key("c", "meta", "alt");
    await page.waitFor("window.copied.length===4");
    expect(await page.eval("window.copied[3]")).toBe(
      "# Reference document v2\n\nA durable document body",
    );
    await page.eval(
      `(()=>{const w=document.createTreeWalker(document.querySelector('[data-document]'),NodeFilter.SHOW_TEXT,{acceptNode:n=>n.textContent.trim()&&!n.parentElement.closest('input,[contenteditable=true],button')?1:3});const n=w.nextNode();const r=document.createRange();r.selectNodeContents(n);getSelection().removeAllRanges();getSelection().addRange(r)})()`,
    );
    expect(
      await page.eval(`!getSelection().isCollapsed&&document.activeElement===document.body`),
    ).toBe(true);
    await page.key("c", "meta");
    await sleep(300); // nothing may reach the document's clipboard handler in this window
    expect(await page.eval("window.copied.length")).toBe(4);
  });

  await test.step("options follow Linear's labels, and Download as PDF prints only the document", async () => {
    await fresh(page);
    await page.eval("window.printed=0;window.print=()=>{window.printed++}");
    await page.click('[aria-label="Document options"]');
    await page.waitFor(
      `document.activeElement?.getAttribute('aria-label')==='Find document options'`,
    );
    expect(
      await page.eval(
        `[...document.querySelectorAll('[role="dialog"][aria-label="Document options"] [cmdk-item]')].map(n=>n.getAttribute('data-value'))`,
      ),
    ).toEqual([
      "Duplicate",
      "Rename…",
      "Favorite",
      "Copy",
      "Download",
      "Remind me",
      "Show author names",
      "Show document history",
      "Delete",
    ]);
    await page.hover('[cmdk-item][data-value="Copy"]');
    await expect
      .poll(() =>
        page.eval(
          `[...document.querySelectorAll('[role="dialog"][aria-label="Copy"] [cmdk-item]')].map(n=>n.getAttribute('data-value'))`,
        ),
      )
      .toEqual(["Copy URL", "Copy title", "Copy title as link", "Copy content as Markdown"]);
    // Leave Copy for a plain row and let its submenu close first: moving straight from Copy to Download lets Copy's
    // pending hover-close clear whichever submenu is open, so Download's would close a moment after opening.
    await page.hover('[cmdk-item][data-value="Favorite"]');
    await page.waitFor(`!document.querySelector('[role="dialog"][aria-label="Copy"]')`);
    await page.hover('[cmdk-item][data-value="Download"]');
    await expect
      .poll(() =>
        page.eval(
          `[...document.querySelectorAll('[role="dialog"][aria-label="Download"] [cmdk-item]')].map(n=>n.getAttribute('data-value'))`,
        ),
      )
      .toEqual(["Download as markdown", "Download as PDF"]);
    await page.key("Escape");
    await page.waitFor(`!document.querySelector('[role="dialog"][aria-label="Document options"]')`);
    await page.click('[aria-label="Document options"]');
    await page.waitFor(
      `document.activeElement?.getAttribute('aria-label')==='Find document options'`,
    );
    await page.type("PDF");
    await page.waitFor(
      `!!document.querySelector('[cmdk-item][data-value="Download › Download as PDF"]')`,
    );
    await page.key("Enter");
    await page.waitFor("window.printed===1");
    await page.page.emulateMedia({ media: "print" });
    expect(
      await page.eval(
        `[getComputedStyle(document.querySelector('nav[aria-label="Main navigation"]')).visibility,getComputedStyle(document.querySelector('[aria-label="Document title"]')).visibility,getComputedStyle(document.querySelector('[aria-label="Document options"]')).display]`,
      ),
    ).toEqual(["hidden", "visible", "none"]);
    await page.page.emulateMedia({ media: null });
  });

  await test.step("the icon picker uses Linear's named palette, a custom color and named emoji search", async () => {
    await fresh(page);
    await page.click('[aria-label="Document icon"]');
    expect(
      await page.eval(
        `[...document.querySelectorAll('[aria-label="Icon color"] [aria-label]')].map(n=>n.getAttribute('aria-label'))`,
      ),
    ).toEqual([
      "Grey",
      "Dark Grey",
      "Purple",
      "Teal",
      "Green",
      "Yellow",
      "Orange",
      "Pink",
      "Red",
      "Set custom color",
    ]);
    await page.eval(
      `(()=>{const i=document.querySelector('[aria-label="Set custom color"]');Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(i,'#123456');i.dispatchEvent(new Event('input',{bubbles:true}))})()`,
    );
    await page.waitFor(
      `getComputedStyle(document.querySelector('[aria-label="Document icon"]')).color==='rgb(18, 52, 86)'`,
    );
    await page.click('[role="tab"]:last-child');
    await page.click('[aria-label="Search document icons"]');
    await page.type("rocket");
    await page.waitFor(`document.querySelectorAll('[aria-label$=" emoji"]').length===1`);
    await page.click('[aria-label="Use 🚀 emoji"]');
    await page.waitFor(
      `document.querySelector('[aria-label="Document icon"]')?.textContent==='🚀'`,
    );
  });

  await test.step("Escape blurs first, as in Linear, and a second Escape returns to the issue", async () => {
    await fresh(page, "Escape document", "Escape body");
    for (const field of ['[aria-label="Document title"]', "#resource-document"]) {
      await page.click(field);
      await page.key("Escape");
      await page.waitFor(`document.activeElement===document.body`);
      expect(await page.eval(`new URLSearchParams(location.search).has('document')`)).toBe(true);
      await page.key("Escape");
      await page.waitFor(
        `!new URLSearchParams(location.search).has('document')&&!!document.getElementById('summary')`,
      );
      expect(await page.eval(`new URLSearchParams(location.search).get('issue')`)).toBe("TEST-2");
      await page.click("text=Escape document");
      await page.waitFor(`!!document.getElementById('resource-document')`);
    }
  });

  await test.step("leaving a document focuses its row; favorites open it from the sidebar and O F; a retired icon falls back to the file icon", async () => {
    await fresh(page, "Favorite document");
    await page.click('[aria-label="Add document to favorites"]');
    await page.click('[aria-label="Back to issue"]');
    await page.waitFor(`!!document.activeElement?.dataset.resourceId`);
    expect(await page.eval(`document.activeElement.textContent`)).toContain("Favorite document");
    const opened = `document.querySelector('[aria-label="Document title"]')?.value==='Favorite document'`;
    const sidebar = `[...document.querySelectorAll('nav[aria-label="Main navigation"] button')].find(b=>b.textContent==='Favorite document')`;
    await page.waitFor(`!!${sidebar}`);
    await page.eval(`${sidebar}.click()`);
    await page.waitFor(opened);
    await page.click('[aria-label="Back to issue"]');
    await page.waitFor(`!!document.activeElement?.dataset.resourceId`);
    await page.key("o");
    await page.key("f");
    await page.waitFor(`!!document.querySelector('[cmdk-item][data-value*="Favorite document"]')`);
    await page.click('[cmdk-item][data-value*="Favorite document"]');
    await page.waitFor(opened);
    await page.eval(
      `(async()=>{const name=(await indexedDB.databases()).find(d=>d.name.startsWith('better-jira:local:v1:')).name;const db=await new Promise(r=>{const o=indexedDB.open(name);o.onsuccess=()=>r(o.result);});const tx=db.transaction('state','readwrite'),store=tx.objectStore('state');const w=await new Promise(r=>{const q=store.get('workspace');q.onsuccess=()=>r(q.result);});for(const c of w.changes)for(const r of c.issue?.resources??[])if(r.kind==='document')r.icon={name:'retired-icon',color:'#eb5757'};store.put(w,'workspace');await new Promise(r=>tx.oncomplete=r);db.close();})()`,
    );
    await page.reload();
    await page.waitFor(opened);
    expect(
      await page.eval(
        `document.querySelector('[aria-label="Document icon"] path').getAttribute('d')?.length>0`,
      ),
    ).toBe(true);
  });
});

test("document history, narrow and measured layouts, the hidden board and reminders", async ({
  open,
}) => {
  await test.step("history previews and restores earlier content with undo, and duplicate documents stay independent", async () => {
    const page = await open(DOC_PAGE, {
      setup: `window.clockOffset=0;const RealDate=Date;window.Date=class extends RealDate{constructor(...args){super(...(args.length?args:[RealDate.now()+window.clockOffset]));}static now(){return RealDate.now()+window.clockOffset;}}`,
    });
    await create(page, "Versioned document", "First version");
    await page.eval("window.clockOffset=120000");
    await page.click("#resource-document");
    await page.key("End");
    await page.type(" plus second version");
    await page.click('[aria-label="Document options"]');
    await page.click("text=Show document history");
    await page.waitFor(
      `document.querySelectorAll('[aria-label="Document versions"] button').length===2`,
    );
    expect(
      await page.eval(
        `document.querySelector('[aria-label="This is the current version, you cannot restore it"]').disabled`,
      ),
    ).toBe(true);
    await page.click('[aria-label="Document versions"] button:last-child');
    expect(
      await page.eval(
        `document.querySelector('[aria-label="Document version content"]').textContent`,
      ),
    ).toBe("First version");
    await page.click('[aria-label="Restore this document version"]');
    await page.waitFor(
      `document.getElementById('resource-document')?.textContent==='First version'`,
    );
    await page.click('[aria-label="Undo"]');
    await page.waitFor(
      `document.getElementById('resource-document')?.textContent==='First version plus second version'`,
    );
    await page.click('[aria-label="Document options"]');
    await page.click("text=Duplicate");
    await page.waitFor(
      `document.querySelector('[aria-label="Document title"]')?.value==='Versioned document (copy)'`,
    );
    await page.click('[aria-label="Document options"]');
    await page.click("text=Show document history");
    await page.waitFor(`!!document.querySelector('[aria-label="Document versions"]')`);
    expect(
      await page.eval(
        `document.querySelectorAll('[aria-label="Document versions"] button').length`,
      ),
    ).toBe(1);
    await page.key("Escape");
    await page.click("#resource-document");
    await page.key("End");
    await page.type(" unique copy");
    await page.click('[aria-label="Back to issue"]');
    await page.waitFor(`!!document.getElementById('comment')`);
    await page.click("text=Versioned document");
    await page.waitFor(
      `document.querySelector('[aria-label="Document title"]')?.value==='Versioned document'`,
    );
    expect(await page.eval(`document.getElementById('resource-document').textContent`)).toBe(
      "First version plus second version",
    );
  });

  await test.step("a narrow document and its history remain usable with precise title and body typography", async () => {
    const page = await open(DOC_PAGE, {
      width: 1864,
      setup: `window.layoutErrors=[];addEventListener('error',event=>window.layoutErrors.push(event.message))`,
    });
    await create(page, "A long title that must fit a narrow document header", "Narrow content");
    await page.cmd("Emulation.setDeviceMetricsOverride", {
      width: 390,
      height: 900,
      deviceScaleFactor: 1,
      mobile: false,
    });
    await page.waitFor(`document.querySelector('[aria-label="Document title"]').clientHeight>=64`);
    expect(await page.eval(`document.documentElement.scrollWidth<=innerWidth`)).toBe(true);
    expect(
      await page.eval(`document.querySelector('[aria-label="Document title"]').clientHeight`),
    ).toBe(64);
    expect(
      await page.eval(`getComputedStyle(document.getElementById('resource-document')).fontSize`),
    ).toBe("15px");
    expect(
      await page.eval(
        `getComputedStyle(document.querySelector('[aria-label="Document title"]')).fontSize`,
      ),
    ).toBe("24px");
    expect(
      await page.eval(`document.querySelector('[aria-label="Document title"]').scrollTop`),
    ).toBe(0);
    expect(
      await page.eval(`window.layoutErrors.filter(message=>message.includes('ResizeObserver'))`),
    ).toEqual([]);
    await page.click('[aria-label="Document options"]');
    await page.click("text=Show document history");
    expect(
      await page.eval(
        `document.querySelector('[role="dialog"]').scrollWidth<=document.querySelector('[role="dialog"]').clientWidth`,
      ),
    ).toBe(true);
    await page.click('[aria-label="Close document history"]');
    await page.waitFor(`document.activeElement?.getAttribute('aria-label')==='Document options'`);
    // Linear documents show no toolbar while editing; a selection gets a floating one that stays inside the window and clear of the title.
    const toolbar = `document.querySelector('[data-document] [role=toolbar]')`;
    await page.click("#resource-document");
    await page.key("End");
    expect(await page.eval(`!${toolbar}`)).toBe(true);
    await page.key("a", "meta");
    await page.waitFor(`!!${toolbar}`);
    const box = await page.eval<{ left: number; right: number; top: number; bottom: number }>(
        `${toolbar}.getBoundingClientRect().toJSON()`,
      ),
      title = await page.eval<{ bottom: number }>(
        `document.querySelector('[aria-label="Document title"]').getBoundingClientRect().toJSON()`,
      );
    expect(box.left).toBeGreaterThanOrEqual(12);
    expect(box.right).toBeLessThanOrEqual(390 - 12);
    expect(box.top >= title.bottom || box.bottom <= 0).toBe(true);
    await page.key("ArrowRight");
    await page.waitFor(`!${toolbar}`);
    await page.page.screenshot({ path: ".raj/ticket-detail/betterjira-document-narrow.png" });
  });

  await test.step("a long selection keeps the floating toolbar inside the viewport", async () => {
    const page = await open(DOC_PAGE, { width: 720, height: 650 });
    await page.waitFor(`!!document.getElementById('comment')`);
    await page.click("#issue-options");
    await page.click('[cmdk-item][data-value="Add document…"]');
    await page.waitFor(`document.activeElement?.getAttribute('aria-label')==='Document title'`);
    await page.type("Long");
    await page.click("#resource-document");
    await page.cmd("Input.insertText", {
      text: Array.from(
        { length: 90 },
        (_, i) => `Line ${i} with enough text to wrap and take up room.`,
      ).join("\n"),
    });
    await page.key("Home", "meta");
    await page.key("a", "meta");
    const inside = `(()=>{const b=document.querySelector('[role=toolbar]')?.getBoundingClientRect();return !!b&&b.top>=0&&b.bottom<=650})()`;
    await page.waitFor(inside);
    // Scrolled to the end, the selection still spans the viewport and the toolbar stays inside it.
    await page.eval(
      `document.getElementById('resource-document').closest('.overflow-y-auto').scrollTop=1e6`,
    );
    await page.waitFor(
      `document.getElementById('resource-document').closest('.overflow-y-auto').scrollTop>0`,
    );
    await page.waitFor(inside);
  });

  await test.step("title, icon and menu surface match Linear's measured geometry and colours", async () => {
    const page = await open(DOC_PAGE, { width: 1272, height: 846 });
    await create(page, "BetterJira synthetic document reference", "Disposable document");
    // Linear (RAJ-52 synthetic document, 1272×846): title 24px/32px, -0.16px, "opsz" 32 at y 159; 18px icon in a 24px button at y 123; body at y 217.
    expect(
      await page.eval(
        `(()=>{const t=document.querySelector('[aria-label="Document title"]'),c=getComputedStyle(t),i=document.querySelector('[aria-label="Document icon"]').getBoundingClientRect(),s=document.querySelector('[aria-label="Document icon"] svg').getBoundingClientRect();return [c.fontVariationSettings,c.letterSpacing,c.lineHeight,t.getBoundingClientRect().top,i.top,i.height,s.width,document.querySelector('#resource-document p').getBoundingClientRect().top,document.fonts.check('600 24px "Inter Variable"')]})()`,
      ),
    ).toEqual(['"opsz" 32', "-0.16px", "32px", 159, 123, 24, 18, 217, true]);
    // The same title renders 432px wide in Linear, which needs Inter's optical-size axis.
    expect(
      await page.eval(
        `(()=>{const t=document.querySelector('[aria-label="Document title"]'),c=getComputedStyle(t),s=document.createElement('span');for(const k of ['fontFamily','fontSize','fontWeight','letterSpacing','fontVariationSettings','fontFeatureSettings'])s.style[k]=c[k];s.style.position='absolute';s.textContent=t.value;document.body.append(s);const w=Math.round(s.getBoundingClientRect().width);s.remove();return w})()`,
      ),
    ).toBe(432);
    await page.click('[aria-label="Document options"]');
    await page.key("ArrowDown");
    expect(
      await page.eval(
        `(()=>{const m=document.querySelector('[role="dialog"][aria-label="Document options"]'),c=getComputedStyle(m);return [c.backgroundColor,c.borderTopColor,c.boxShadow.match(/lch\\(/g).length,getComputedStyle(m.querySelector('[cmdk-item][data-selected=true]'),'::before').backgroundColor]})()`,
      ),
    ).toEqual(["lch(12.72 0.85 272)", "lch(21.36 1.93 272)", 3, "lch(20.82 1.3 272)"]);
    await page.hover('[cmdk-item][data-value="Copy"]');
    await page.waitFor(
      `!!document.querySelector('[role="dialog"][aria-label="Copy"] [cmdk-root]')`,
    );
    expect(
      await page.eval(
        `getComputedStyle(document.querySelector('[role="dialog"][aria-label="Copy"] [cmdk-root]')).backgroundColor`,
      ),
    ).toBe("lch(12.72 0.85 272)");
    await page.key("Escape");
    await page.waitFor(`!document.querySelector('[role="dialog"]')`);
    await page.click('[aria-label="Back to issue"]');
    await page.waitFor(`!!document.getElementById('comment')`);
    // Linear's issue title (RAJ-52) uses the document title's type: "BetterJira media and issue-detail parity test" is 466px wide.
    expect(
      await page.eval(
        `(()=>{const t=document.getElementById('summary'),c=getComputedStyle(t),s=document.createElement('span');for(const k of ['fontFamily','fontSize','fontWeight','letterSpacing','fontVariationSettings'])s.style[k]=c[k];s.style.position='absolute';s.textContent='BetterJira media and issue-detail parity test';document.body.append(s);const w=Math.round(s.getBoundingClientRect().width);s.remove();return [c.lineHeight,w]})()`,
      ),
    ).toEqual(["32px", 466]);
    await page.key("s");
    await page.waitFor(`!!document.querySelector('[cmdk-item][data-selected=true]')`);
    // The status picker (S) is one of the App pickers; Linear's S/P pickers share the menu surface.
    expect(
      await page.eval(
        `(()=>{const i=document.querySelector('[cmdk-item][data-selected=true]'),m=i.closest('[role="dialog"]'),c=getComputedStyle(m);return [c.backgroundColor,c.borderTopColor,getComputedStyle(i,'::before').backgroundColor]})()`,
      ),
    ).toEqual(["lch(12.72 0.85 272)", "lch(21.36 1.93 272)", "lch(20.82 1.3 272)"]);
  });

  await test.step("titles stay one line and board filter shortcuts cannot change the hidden board behind a full-page document", async () => {
    const prefs = {
      1: {
        filters: {
          id: "root",
          join: "and",
          children: [
            { id: "r1", field: "labels", op: "is", values: ["test"] },
            { id: "r2", field: "labels", op: "is", values: ["test"] },
          ],
        },
      },
    };
    const page = await open(DOC_PAGE, {
      setup: `if(!sessionStorage.seeded){sessionStorage.seeded=1;localStorage.setItem(${JSON.stringify(PREFS_KEY)},${JSON.stringify(JSON.stringify(prefs))});}`,
    });
    await create(page, "Alpha", "One line title");
    await page.click('[aria-label="Document title"]');
    await page.key("End");
    await page.cmd("Input.insertText", { text: "\nBeta\r\nGamma" });
    await page.waitFor(
      `document.querySelector('[aria-label="Document title"]').value==='Alpha Beta Gamma'`,
    );
    await page.key("Escape");
    const filters = `JSON.parse(localStorage.getItem(${JSON.stringify(PREFS_KEY)}))['1'].filters.children.length`;
    for (const [key, ...mods] of [["f", "shift"], ["f", "alt", "shift"], ["f"]] as const) {
      await page.key(key, ...mods);
      await sleep(150); // a filter change or menu would show within this window
      expect(await page.eval(filters)).toBe(2);
      expect(await page.eval(`!!document.querySelector('[role=dialog]')`)).toBe(false);
    }
    expect(await page.eval(`new URLSearchParams(location.search).has('document')`)).toBe(true);
  });

  await test.step("Remind me schedules from the menu and Shift+H, accepts a custom time, and delivers once", async () => {
    const page = await open(DOC_PAGE);
    await create(page);
    await page.eval("document.activeElement?.blur()");
    await page.key("h", "shift");
    await page.waitFor(`document.activeElement?.getAttribute('aria-label')==='Reminder time'`);
    await page.type("custom");
    await page.key("Enter");
    await page.waitFor(
      `document.activeElement?.getAttribute('aria-label')==='Custom reminder time'`,
    );
    await page.eval(
      `(()=>{const d=new Date(Date.now()+2*86400000);d.setSeconds(0,0);const v=new Date(d-d.getTimezoneOffset()*60000).toISOString().slice(0,16);const i=document.activeElement;Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(i,v);i.dispatchEvent(new Event('input',{bubbles:true}))})()`,
    );
    await page.click("text=Set reminder");
    await page.waitFor(
      `document.body.textContent.includes('Reminder set')&&!document.querySelector('[aria-label="Custom reminder time"]')`,
    );
    await page.click('[aria-label="Document options"]');
    await page.hover('[cmdk-item][data-value="Remind me"]');
    await page.waitFor(
      `!!document.querySelector('[role="dialog"][aria-label="Remind me"] [cmdk-item]')`,
    );
    expect(
      await page.eval(
        `[...document.querySelectorAll('[role="dialog"][aria-label="Remind me"] [cmdk-item]')].map(n=>n.getAttribute('data-value')).at(-1)`,
      ),
    ).toBe("Custom…");
    await page.click('[cmdk-item][data-value="An hour from now"]');
    await page.waitFor(`document.body.textContent.includes('Reminder set')`);
    await page.waitFor(SAVED);
    await page.page.addInitScript("const now=Date.now;Date.now=()=>now()+3601000");
    await page.reload();
    await page.waitFor(`document.body.textContent.includes('Reminder: Reference document')`);
    await page.waitFor(SAVED);
    await page.reload();
    await page.waitFor(
      `document.querySelector('[aria-label="Document title"]')?.value==='Reference document'`,
    );
    await sleep(500); // a second delivery would show within this window
    expect(
      await page.eval(`document.body.textContent.includes('Reminder: Reference document')`),
    ).toBe(false);
  });
});

test("a paste that finishes after leaving, switching issues or reopening lands where it was made without dropping newer edits", async ({
  open,
}) => {
  const page = await open(DOC_PAGE);
  const go = (key: string) =>
    page.eval(
      `history.pushState({},'','?issue=${key}&view=page');dispatchEvent(new PopStateEvent('popstate'))`,
    );

  await test.step("a document paste that finishes after leaving and reopening the document adds its file without dropping the newer edits", async () => {
    await create(page, "Late upload", "Original body");
    await page.click("#resource-document");
    await page.key("End");
    // Hold the image probe so the upload completes only after the document was reopened and edited.
    await page.eval(
      `window.createImageBitmap=()=>new Promise(resolve=>{window.releaseBitmap=()=>resolve({width:10,height:10,close(){}})});(()=>{const d=new DataTransfer();d.items.add(new File([new Uint8Array([137,80,78,71])],'late.png',{type:'image/png'}));document.getElementById('resource-document').dispatchEvent(new ClipboardEvent('paste',{clipboardData:d,bubbles:true,cancelable:true}))})()`,
    );
    await page.waitFor(`typeof window.releaseBitmap==='function'`);
    await page.click('[aria-label="Back to issue"]');
    await page.waitFor(`!!document.getElementById('summary')`);
    await page.click("text=Late upload");
    await page.waitFor(`!!document.getElementById('resource-document')`);
    await page.click("#resource-document");
    await page.key("End", "meta");
    await page.cmd("Input.insertText", { text: " EDITED AFTER REOPEN" });
    await page.click('[aria-label="Document title"]');
    await page.eval("window.releaseBitmap()");
    await page.waitFor(
      `document.querySelectorAll('#resource-document [data-media-action], #resource-document img, #resource-document .media-frame').length>0||document.getElementById('resource-document').textContent.includes('late.png')`,
      8000,
    );
    expect(await page.eval(`document.getElementById('resource-document').textContent`)).toContain(
      "EDITED AFTER REOPEN",
    );
    // Keep editing the open document after the file lands: the file must stay through that save and a reload.
    await page.click("#resource-document p");
    await page.key("End");
    await page.cmd("Input.insertText", { text: " TYPED AFTER LATE FILE" });
    await page.click('[aria-label="Document title"]');
    await page.waitFor(documentSaved("EDITED AFTER REOPEN", "TYPED AFTER LATE FILE"));
    await page.reload();
    await page.waitFor(`!!document.getElementById('resource-document')`);
    expect(
      await page.eval(
        `[document.getElementById('resource-document').textContent.includes('EDITED AFTER REOPEN'),document.getElementById('resource-document').textContent.includes('TYPED AFTER LATE FILE'),document.querySelectorAll('#resource-document [data-media-action], #resource-document img, #resource-document .media-frame').length>0]`,
      ),
    ).toEqual([true, true, true]);
  });

  await test.step("a file pasted into a document just before Back still lands in that document after reload", async () => {
    await fresh(page, "Paste then leave", "Body before paste");
    await page.click("#resource-document");
    await page.key("End");
    await page.eval(
      `(()=>{const data=new DataTransfer();data.items.add(new File(['nav bytes'],'nav.txt',{type:'text/plain'}));document.getElementById('resource-document').dispatchEvent(new ClipboardEvent('paste',{clipboardData:data,bubbles:true,cancelable:true}));document.querySelector('[aria-label="Back to issue"]').click()})()`,
    );
    await page.waitFor(`!!document.getElementById('summary')`);
    await page.waitFor(documentSaved("Body before paste"));
    await page.waitFor(SAVED);
    await page.reload();
    await page.waitFor(`!!document.getElementById('comment')`);
    await page.click("text=Paste then leave");
    await page.waitFor(
      `document.getElementById('resource-document')?.textContent.includes('nav.txt')`,
      8000,
    );
    expect(await page.eval(`document.getElementById('resource-document').textContent`)).toContain(
      "Body before paste",
    );
  });

  await test.step("a description paste that finishes after switching issues and editing again keeps both the file and the newer text", async () => {
    await page.goto(DOC_PAGE);
    await page.waitFor(`!!document.getElementById('comment')`);
    await page.click("#description");
    await page.waitFor(
      `!!document.querySelector('[aria-label="Issue description"][contenteditable]')`,
    );
    await page.key("End", "meta");
    await page.eval(
      `window.createImageBitmap=()=>new Promise(resolve=>{window.releaseBitmap=()=>resolve({width:10,height:10,close(){}})});(()=>{const d=new DataTransfer();d.items.add(new File([new Uint8Array([137,80,78,71])],'late-description.png',{type:'image/png'}));document.getElementById('description').dispatchEvent(new ClipboardEvent('paste',{clipboardData:d,bubbles:true,cancelable:true}))})()`,
    );
    await page.waitFor(`typeof window.releaseBitmap==='function'`);
    await go("TEST-3");
    await page.waitFor(
      `new URL(location.href).searchParams.get('issue')==='TEST-3'&&!!document.getElementById('description')`,
    );
    await go("TEST-2");
    await page.waitFor(
      `new URL(location.href).searchParams.get('issue')==='TEST-2'&&!!document.getElementById('description')`,
    );
    await page.click("#description");
    await page.key("End", "meta");
    await page.cmd("Input.insertText", { text: " DESCRIPTION AFTER RETURN" });
    await page.click("#summary");
    const media = `document.querySelectorAll('#description img, #description [data-media-action], #description .media-frame').length`,
      before = await page.eval<number>(media);
    await page.eval("window.releaseBitmap()");
    await page.waitFor(`${media}>${before}`, 8000);
    expect(await page.eval(`document.getElementById('description').textContent`)).toContain(
      "DESCRIPTION AFTER RETURN",
    );
    // With the description not open (another issue showing), the late file is merged into the saved description.
    await page.click("#description");
    await page.key("End", "meta");
    await page.eval(
      `window.releaseBitmap=undefined;window.createImageBitmap=()=>new Promise(resolve=>{window.releaseBitmap=()=>resolve({width:10,height:10,close(){}})});(()=>{const d=new DataTransfer();d.items.add(new File([new Uint8Array([137,80,78,71])],'away.png',{type:'image/png'}));document.getElementById('description').dispatchEvent(new ClipboardEvent('paste',{clipboardData:d,bubbles:true,cancelable:true}))})()`,
    );
    await page.waitFor(`typeof window.releaseBitmap==='function'`);
    const count = await page.eval<number>(media);
    await page.waitFor(`${savedDescriptionMedia}.then(n=>n===1)`); // the first late file is saved
    await go("TEST-3");
    await page.waitFor(
      `new URL(location.href).searchParams.get('issue')==='TEST-3'&&!!document.getElementById('description')`,
    );
    await page.eval("window.releaseBitmap()");
    await page.waitFor(`${savedDescriptionMedia}.then(n=>n===2)`); // merged while away
    await go("TEST-2");
    await page.waitFor(
      `new URL(location.href).searchParams.get('issue')==='TEST-2'&&${media}>${count}`,
      8000,
    );
    // Returning briefly renders a transitional description; the merged file must still be there once it settles.
    await sleep(1000);
    expect(await page.eval<number>(media)).toBeGreaterThan(count);
    expect(await page.eval(`document.getElementById('description').textContent`)).toContain(
      "DESCRIPTION AFTER RETURN",
    );
  });

  await test.step("a comment paste that finishes after switching issues lands in the composer without dropping newer text, also when finished away", async () => {
    const back = async (key: string) => {
      await go(key);
      await page.waitFor(
        `new URL(location.href).searchParams.get('issue')==='${key}'&&!!document.getElementById('comment')`,
      );
    };
    const paste = (name: string) =>
      page.eval(
        `window.releaseBitmap=undefined;window.createImageBitmap=()=>new Promise(resolve=>{window.releaseBitmap=()=>resolve({width:10,height:10,close(){}})});(()=>{const d=new DataTransfer();d.items.add(new File([new Uint8Array([137,80,78,71])],'${name}',{type:'image/png'}));document.getElementById('comment').dispatchEvent(new ClipboardEvent('paste',{clipboardData:d,bubbles:true,cancelable:true}))})()`,
      );
    const media = `document.querySelectorAll('#comment img, #comment [data-media-action], #comment .media-frame').length`;
    await page.goto(DOC_PAGE);
    await page.waitFor(`!!document.getElementById('comment')`);
    await page.click("#comment");
    await paste("late-comment.png");
    await page.waitFor(`typeof window.releaseBitmap==='function'`);
    await back("TEST-3");
    await back("TEST-2");
    await page.click("#comment");
    await page.key("End", "meta");
    await page.cmd("Input.insertText", { text: "COMMENT AFTER RETURN" });
    await page.eval("window.releaseBitmap()");
    await page.waitFor(`${media}>0`, 8000);
    expect(await page.eval(`document.getElementById('comment').textContent`)).toContain(
      "COMMENT AFTER RETURN",
    );
    // Finished while another issue shows: merged into the saved draft, so returning shows the file and the text.
    await page.click("#comment");
    await page.key("End", "meta");
    const count = await page.eval<number>(media);
    await page.waitFor(`${commentDraftMedia}===1`);
    await paste("away-comment.png");
    await page.waitFor(`typeof window.releaseBitmap==='function'`);
    await back("TEST-3");
    await page.eval("window.releaseBitmap()");
    await page.waitFor(`${commentDraftMedia}===2`); // merged into the draft while away
    await back("TEST-2");
    await page.waitFor(`${media}>${count}`, 8000);
    expect(await page.eval(`document.getElementById('comment').textContent`)).toContain(
      "COMMENT AFTER RETURN",
    );
  });
});
