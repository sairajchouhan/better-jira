import { resolve } from "node:path";
import { expect, test, sleep, type App as Page } from "./app";

// QA round 2: description sync, conflicts and media writes.

/** A writable site whose Jira is faked in the page: it keeps TEST-2's description (in sessionStorage, so it survives a reload), refuses a
 * description edit whose base isn't Jira's text, and lets a test play "someone else" (`__theirs(text)`) and block the network (`__block`; `__blocked` counts the writes it stopped). */
const fakeJira = (extra = "") => `(()=>{const real=fetch;window.__ops=[];window.__block=false;
const CONFLICT="Someone changed the description in Jira while you were editing it. Pick a version in the description.";
const jira=()=>JSON.parse(sessionStorage.getItem('jira')||'{"rev":0}');
const save=(v)=>sessionStorage.setItem('jira',JSON.stringify(v));
const squash=(t)=>String(t).replace(/\\s+/g,' ').trim();
const para=(text)=>({type:'doc',version:1,content:[{type:'paragraph',content:[{type:'text',text}]}]});
window.__theirs=(text)=>{const j=jira();save({...j,doc:para(text),theirs:text,rev:j.rev+1});ES.all.forEach(e=>e.onmessage?.({data:'x'}));};
class ES{constructor(){ES.all.push(this)}close(){}}ES.all=[];window.EventSource=ES;
const full=async(key)=>{const f=await (await real('/api/issues/'+key)).json();const j=jira();if(j.doc)f.fields.description=j.doc;return f;};
window.fetch=async(input,init)=>{const path=new URL(String(input),location.href).pathname;
 ${extra}
 if(path==='/api/client'){const client=await (await real(input,init)).json();return Response.json({...client,writable:true});}
 if(path==='/api/options')return Response.json({priorities:[],users:[],labels:[],versions:{}});
 if(path==='/api/properties'){const issues=await (await real('/api/issues')).json(),j=jira();
  return Response.json({entries:Object.fromEntries(issues.map(i=>[i.key,{key:i.key,updated:i.key==='TEST-2'&&j.rev?'2026-11-07T00:00:'+String(j.rev).padStart(2,'0')+'Z':i.updated}])),progress:{total:0,pending:0,completed:0,errors:0}});}
 if(path==='/api/issues/TEST-2')return Response.json(await full('TEST-2'));
 const m=path.match(/^\\/api\\/issues\\/([^/]+)\\/ops$/);if(!m)return real(input,init);
 if(window.__block){window.__blocked=(window.__blocked??0)+1;throw new TypeError('Failed to fetch');}
 const {ops}=JSON.parse(init.body);window.__ops.push(ops);
 const issue=(await (await real('/api/issues')).json()).find(i=>i.key===m[1]),j=jira();
 const f=ops.find(o=>o.op==='fields')?.fields;
 if(f?.description){
  if(window.__refuse&&JSON.stringify(f.description).includes(window.__refuse))
   return Response.json({error:'description: CONTENT_LIMIT_EXCEEDED',key:m[1],created:{},others:[],issue,full:await full(m[1])},{status:422});
  if(f.descriptionBase!==undefined&&j.theirs!==undefined&&squash(f.descriptionBase)!==squash(j.theirs))
   return Response.json({error:CONFLICT,key:m[1],created:{},others:[],issue,full:await full(m[1])},{status:422});
  save({rev:j.rev,doc:f.description});
 }
 setTimeout(()=>ES.all.forEach(e=>e.onmessage?.({data:'x'})),50);
 return Response.json({key:m[1],created:{},others:[],issue,full:await full(m[1])});
};})()`;

const text = (page: Page) =>
  page.eval<string>(`document.getElementById('description').textContent`);
const bar = (page: Page) =>
  page.eval<string>(`document.querySelector('section [role="alert"]')?.textContent ?? ""`);
const sent = (page: Page) =>
  page.eval<string>(
    `JSON.stringify(window.__ops.flat().filter(o=>o.op==='fields'&&o.fields.description))`,
  );
async function edit(page: Page, words: string) {
  await page.click("#description h2");
  await page.key("End");
  await page.type(words);
}

test("someone else's edits and refused saves while I type", async ({ open }) => {
  const page = await open("?issue=TEST-2&view=page", { setup: fakeJira() });
  await page.waitFor(`!!document.querySelector('#description h2')`);
  await test.step("W-F2: a loaded description never shows the empty placeholder over its text", async () => {
    await sleep(300);
    expect(
      await page.eval(
        `!!document.getElementById('description').closest('.rich-editor')?.querySelector('.rich-placeholder')`,
      ),
    ).toBe(false);
  });
  await test.step("R2-D4: a save Jira refuses for its content says why, doesn't hold later edits, and clears once a valid edit saves", async () => {
    await page.eval(`window.__refuse='HUGE'`);
    await edit(page, " HUGE");
    await page.waitFor(`!!document.querySelector('section [role="alert"]')`);
    expect(await bar(page)).toContain("Jira didn't save this description (CONTENT_LIMIT_EXCEEDED)");
    expect(await bar(page)).not.toContain("Jira's copy of this description changed");
    expect(
      await page.eval(
        `[...document.querySelectorAll('section [role="alert"] button')].map(b=>b.textContent)`,
      ),
    ).toEqual(["Use Jira's version"]);
    // The refused text stays in the editor; fixing it saves at once, without Keep mine.
    expect(await text(page)).toContain("HUGE");
    for (let i = 0; i < 5; i++) await page.key("Backspace");
    await page.type(" ok");
    await page.waitFor(`window.__ops.length===2`);
    await page.waitFor(`!document.querySelector('section [role="alert"]')`);
    expect(await sent(page)).toContain("heading ok");
    await page.eval(`window.__refuse=undefined`);
    await page.key("Escape");
  });
  await test.step("R2-D5: picking a version in the conflict bar puts focus back in the description, so typing doesn't run board shortcuts", async () => {
    await edit(page, " mine");
    await page.eval(`__theirs('EXT')`);
    await page.waitFor(`!!document.querySelector('section [role="alert"]')`);
    await page.click("text=Keep mine");
    await page.waitFor(`document.activeElement?.id==='description'`);
    await page.type("Z");
    expect(await text(page)).toContain("Z");
    await page.key("Escape");
    await page.waitFor(`!document.querySelector('section [role="alert"]')`);
  });
  await test.step("R2-D1: Use Jira's version drops the held edit: a later Jira change shows without a bar, and the discarded text is never sent", async () => {
    await edit(page, " mine1");
    // Jira has taken the write (its answer may still be on the way). A change that lands before the write is a real conflict, not this case.
    await page.waitFor(`sessionStorage.getItem('jira')?.includes('mine1')`);
    // Someone else's edit while nothing is unsaved: it simply shows, focused or not.
    await page.eval(`__theirs('EXT3')`);
    await page.waitFor(`document.getElementById('description').textContent==='EXT3'`);
    expect(await bar(page)).toBe("");
    // Typing, then another Jira change before it saves: the bar asks.
    await page.key("End");
    await page.type(" held");
    await page.eval(`__theirs('EXT4')`);
    await page.waitFor(`!!document.querySelector('section [role="alert"]')`);
    await page.click("text=Use Jira's version");
    await page.waitFor(`document.getElementById('description').textContent==='EXT4'`);
    await page.eval(`__theirs('EXT5')`);
    await page.waitFor(`document.getElementById('description').textContent==='EXT5'`);
    await sleep(800); // no bar may come up in this window
    expect(await bar(page)).toBe("");
    expect(await sent(page)).not.toContain("held");
  });
});

test("edits that couldn't be sent: restore, offline and reload", async ({ open }) => {
  const offline = `if(window.__offline&&(path==='/api/issues'||path.startsWith('/api/issues/TEST-2')))throw new TypeError('Failed to fetch');`;
  const page = await open("?issue=TEST-2&view=page", { setup: fakeJira(offline) });
  await page.waitFor(`!!document.querySelector('#description h2')`);
  await test.step("R2-D3: Restore mirrored Jira version cancels the queued write, so the discarded edit never reaches Jira", async () => {
    await page.eval(`window.__block=true`);
    await edit(page, " unsent");
    await page.key("Escape");
    await page.waitFor(`window.__blocked>0`);
    await page.click("#issue-options");
    await page.click("text=Restore mirrored Jira version");
    await page.waitFor(`!document.getElementById('description').textContent.includes('unsent')`);
    await page.eval(`window.__block=false`);
    await sleep(6000); // past the outbox's first retry (5 s): nothing may be sent
    expect(await sent(page)).toBe("[]");
  });
  await test.step("sync check 6: Restore while offline says it failed at once and never drops an edit made afterwards", async () => {
    await page.eval(`window.__block=true;window.__blocked=0`);
    await edit(page, " unsent");
    await page.key("Escape");
    await page.waitFor(`window.__blocked>0`);
    // The browser goes offline: Jira's version can't be read.
    await page.eval(`window.__offline=true;dispatchEvent(new Event('offline'))`);
    await page.click("#issue-options");
    await page.click("text=Restore mirrored Jira version");
    expect(
      await page.waitFor<string>(`document.querySelector("[data-toast]")?.textContent`),
    ).toContain("Could not read the Jira version");
    await edit(page, " later");
    await page.key("Escape");
    await page.eval(`window.__offline=false;dispatchEvent(new Event('online'))`);
    await sleep(2000); // the edit must survive the reconnect's resync
    expect(await text(page)).toContain("unsent later");
  });
  await test.step("R2-D2: an edit that couldn't be sent survives a reload after Jira changed: it is refused against the newer text and asks", async () => {
    const page = await open("?issue=TEST-2&view=page", { setup: fakeJira() });
    page.page.on("dialog", (dialog) => dialog.accept());
    await page.waitFor(`!!document.querySelector('#description h2')`);
    await page.eval(`window.__block=true`);
    await edit(page, " offline1");
    await page.key("Escape");
    await page.waitFor(`window.__blocked>0`);
    await page.eval(
      `(()=>{sessionStorage.setItem('jira',JSON.stringify({rev:1,theirs:'EXT5 while app offline',doc:{type:'doc',version:1,content:[{type:'paragraph',content:[{type:'text',text:'EXT5 while app offline'}]}]}}))})()`,
    );
    await page.reload();
    await page.waitFor(
      `document.querySelector('section [role="alert"]')?.textContent.includes('Someone changed this description')`,
      10000,
    );
    expect(await text(page)).toContain("offline1");
    // Jira kept its newer text.
    expect(await page.eval(`sessionStorage.getItem('jira')`)).not.toContain("offline1");
    // Picking Jira's shows it, and the edit stays in the description history.
    await page.click("text=Use Jira's version");
    await page.waitFor(
      `document.getElementById('description').textContent==='EXT5 while app offline'`,
    );
    await page.click("#issue-options");
    await page.click("text=Show description history");
    await page.waitFor(
      `document.querySelector('[role="dialog"]')?.textContent.includes('offline1')`,
    );
  });
});

test("description media writes and mark buttons", async ({ open }) => {
  await test.step("R2-D7: mark buttons show pressed for a selection that starts at the marked text", async () => {
    const page = await open("?issue=TEST-2&view=page");
    await page.click("#description li p");
    await page.key("End");
    for (let i = 0; i < 4; i++) await page.key("ArrowLeft", "shift");
    await page.waitFor(`!!document.querySelector('[aria-label="Bold"]')`);
    await page.click('[aria-label="Bold"]');
    await page.key("End");
    for (let i = 0; i < 4; i++) await page.key("ArrowLeft", "shift");
    await page.waitFor(
      `document.querySelector('[aria-label="Bold"]')?.getAttribute('aria-pressed')==='true'`,
    );
  });
  // Uploads succeed, or hang while `__hang` is set.
  const page = await open("?issue=TEST-2&view=page", {
    setup:
      fakeJira(`if(path.endsWith('/attachments')&&init?.method==='POST'){if(window.__hang)return new Promise(()=>{});
      const file=init.body.get('file');
      return Response.json({attachment:{id:'9100',name:file.name,type:file.type,size:file.size,url:'/api/issues/TEST-2/attachments/9100',mediaId:'m9100'},collection:'c'});}`),
  });
  page.page.on("dialog", (dialog) => dialog.accept());
  const input = page.page.locator(".rich-editor:has(#description) input[type=file]");
  await page.waitFor(`!!document.querySelector('#description h2')`);
  await test.step("R2-D10: a file placed in the description makes one write, with no empty write before it", async () => {
    await page.click("#description h2");
    await input.setInputFiles(resolve("e2e/fixtures/media-file.txt"));
    await page.waitFor(`window.__ops.some(ops=>JSON.stringify(ops).includes('m9100'))`, 8000);
    expect(await page.eval(`window.__ops.filter(ops=>!ops.length).length`)).toBe(0);
  });
  await test.step("R2-D9: a file still uploading when the page reloads is named after the reload, not silently dropped", async () => {
    await page.eval(`window.__hang=true`);
    await input.setInputFiles(resolve("e2e/fixtures/media-file.txt"));
    await page.waitFor(`Object.keys(localStorage).some(k=>k.startsWith('better-jira:uploading:'))`);
    await page.reload();
    await page.waitFor(`document.body.textContent.includes("media-file.txt wasn't placed")`);
  });
});
