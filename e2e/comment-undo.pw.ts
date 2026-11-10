import { resolve } from "node:path";
import { expect, test, sleep, type App as Page } from "./app";

// A writable site faked in the page, with Jira's comment list kept here: creates get new numeric ids, deletes remove.
// The 8 s comment-delete undo window runs in 1.5 s. `window.__delay` holds each write's answer back; `window.__answered` counts answers.
const setup = `(()=>{const real=fetch,st=window.setTimeout;window.setTimeout=(f,ms,...a)=>st(f,ms===8000?1500:ms,...a);
window.__ops=[];window.__delay=0;window.__answered=0;let list=null,files=[],next=20000,me=null;
const full=async()=>{const base=await (await real('/api/issues/TEST-2')).json();list??=base.fields.comment?.comments??[];
 return {...base,fields:{...base.fields,attachment:[...(base.fields.attachment??[]),...files],comment:{comments:list,total:list.length}}};};
window.fetch=async(input,init)=>{const path=new URL(String(input),location.href).pathname;
 if(path==='/api/client'){const client=await (await real(input,init)).json();me=client.user;return Response.json({...client,writable:true});}
 if(path==='/api/options')return Response.json({priorities:[],users:[],labels:[],versions:{}});
 if(path==='/api/issues/TEST-2')return Response.json(await full());
 if(path==='/api/issues/TEST-2/attachments'){const file={id:'30001',mediaId:'m-30001',filename:'media-image.png',mimeType:'image/png',size:1};files=[file];return Response.json({attachment:file,collection:'c'});}
 const m=path.match(/^\\/api\\/issues\\/([^/]+)\\/ops$/);if(!m)return real(input,init);
 const {ops}=JSON.parse(init.body);window.__ops.push(ops);await full();const created={};
 for(const op of ops){
  if(op.op==='comment'){const id=String(++next);created[op.ref]=id;list=[...list,{id,body:op.body,created:new Date().toISOString(),author:{accountId:me.id,displayName:me.name},...(op.parentId?{parentId:op.parentId}:{})}];}
  if(op.op==='comment.edit')list=list.map(c=>c.id===op.id?{...c,body:op.body,updated:new Date().toISOString()}:c);
  if(op.op==='comment.delete')list=list.filter(c=>c.id!==op.id);
  if(op.op==='attachment.delete')files=files.filter(f=>f.id!==op.id);}
 await new Promise(r=>st(r,window.__delay));window.__answered++;
 const issue=(await (await real('/api/issues')).json()).find(i=>i.key===m[1]);
 return Response.json({key:m[1],created,others:[],issue,full:await full()});
};})()`;
const ops = (page: Page) => page.eval<any[]>(`window.__ops.flat()`);
const text = (id: string) =>
  `document.querySelector('[data-comment="${id}"] .comment-body')?.textContent`;

/** Every write Jira was sent has its answer, and the app has saved it. */
const answered = (page: Page) =>
  page.waitFor(
    `window.__answered===window.__ops.length&&document.querySelector('[aria-label="Local save status"]')?.textContent==="Saved locally"`,
  );
async function post(page: Page, body: string, id: string) {
  await page.click("#comment");
  await page.type(body);
  await page.key("Enter", "meta");
  await page.waitFor(`!!document.querySelector('[data-comment="${id}"]')`);
}
async function edit(page: Page, id: string) {
  await page.hover(`[data-comment="${id}"]`);
  await page.click(`[data-comment="${id}"] [aria-label="Comment options"]`);
  await page.click("text=Edit");
  await page.waitFor(`document.activeElement?.getAttribute('aria-label')==='Edit comment'`);
  await page.key("a", "meta");
}
async function deleteRoot(page: Page) {
  await page.hover('[data-comment="20001"]');
  await page.click('[data-comment="20001"] [aria-label="Comment options"]');
  await page.click("text=Delete");
  await page.waitFor(`!!document.querySelector('[aria-label="Delete this comment?"]')`);
  await page.key("Enter");
}

test("deleting a root comment: undo inside the window puts it back; after it, undo re-creates it and orphan replies keep the old id", async ({
  open,
}) => {
  const page = await open("?issue=TEST-2&view=page", { setup });
  await page.waitFor(`!!document.getElementById('comment')`);
  let before: any[] = [];
  await test.step("R1-D75: after sending a reply, the reply editor keeps the focus, empty, as in Linear", async () => {
    await post(page, "Root to delete", "20001");
    await page.click('[data-thread="20001"] [aria-label="Reply to thread"]');
    await page.type("Reply that stays");
    await page.key("Enter", "meta");
    await page.waitFor(`!!document.querySelector('[data-comment="20002"]')`);
    expect(
      await page.eval(
        `!!document.activeElement?.closest('[data-thread="20001"] .rich-editor')&&document.activeElement.textContent===''`,
      ),
    ).toBe(true);
    await page.eval(`document.activeElement.blur()`);
    await answered(page);
    before = await ops(page);
  });
  await test.step('R1-D52: deleting the root moves its reply to "Original comment removed" at once, not when Jira answers', async () => {
    await deleteRoot(page);
    await page.waitFor(`!document.querySelector('[data-comment="20001"]')`);
    expect(await page.eval(text("20002"))).toBe("Reply that stays");
    expect(
      await page.eval(`document.querySelector('[data-thread="20002"]').textContent`),
    ).toContain("Original comment removed");
  });
  await test.step("R1-D16: undo inside the window puts the root back in place with its reply, and nothing reaches Jira", async () => {
    await page.key("z", "meta");
    await page.waitFor(`!!document.querySelector('[data-thread="20001"] [data-comment="20002"]')`);
    await sleep(1700); // past the 1.5 s window that started at the delete: no delete may go out
    expect(await ops(page)).toEqual(before);
    expect(await page.eval(`document.querySelectorAll('[data-thread]').length`)).toBe(1);
  });
  await test.step("after the window Jira has deleted the root: undo re-creates it as 20003, and a reply in the orphan thread stays under 20001", async () => {
    await deleteRoot(page);
    await page.waitFor(`window.__ops.flat().some(o=>o.op==='comment.delete'&&o.id==='20001')`);
    await answered(page);
    await page.key("z", "meta");
    await page.waitFor(`!!document.querySelector('[data-comment="20003"]')`);
    await page.click('[data-thread="20002"] [aria-label="Reply to thread"]');
    await page.type("Orphan reply");
    await page.key("Enter", "meta");
    await page.waitFor(
      `window.__ops.flat().some(o=>o.op==='comment'&&o.body.content[0]?.content?.[0]?.text==='Orphan reply')`,
    );
    const reply = (await ops(page)).find(
      (o) => o.body?.content[0]?.content?.[0]?.text === "Orphan reply",
    );
    expect(reply.parentId).toBe("20001");
  });
});

test("editing comments: a dropped upload leaves the issue, an emptied edit can't be saved, and undoing a saved edit doesn't flicker", async ({
  open,
}) => {
  const page = await open("?issue=TEST-2&view=page", { setup });
  await page.waitFor(`!!document.getElementById('comment')`);
  await test.step("R1-D17: an upload the comment draft dropped is deleted from the issue after the editor's 5 s undo grace", async () => {
    await page.click("#comment");
    const doc = await page.cmd("DOM.getDocument");
    const { nodeId } = await page.cmd("DOM.querySelector", {
      nodeId: doc.root.nodeId,
      selector: ".rich-editor:has(#comment) input[type=file]",
    });
    await page.cmd("DOM.setFileInputFiles", {
      nodeId,
      files: [resolve("e2e/fixtures/media-image.png")],
    });
    await page.waitFor(`!!document.querySelector('#comment img')`, 15000);
    await page.click("#comment");
    await page.key("a", "meta");
    await page.key("Backspace");
    await page.waitFor(`!document.querySelector('#comment img')`);
    await page.waitFor(
      `window.__ops.flat().some(o=>o.op==='attachment.delete'&&o.id==='30001')`,
      10000,
    );
  });
  await test.step("R1-D29: an emptied edit keeps the editor open with Save disabled", async () => {
    await post(page, "Keep me", "20001");
    await edit(page, "20001");
    await page.key("Backspace");
    await page.waitFor(`document.querySelector('[aria-label="Save comment"]')?.disabled===true`);
    await page.key("Enter", "meta");
    await sleep(200); // ⌘↵ must not save or close the emptied editor
    expect(await page.eval(`document.activeElement?.getAttribute('aria-label')`)).toBe(
      "Edit comment",
    );
    await page.key("Escape");
    await page.waitFor(`${text("20001")}==='Keep me'`);
  });
  await test.step("undoing a saved comment edit shows the old text at once and keeps it while Jira answers (no flicker)", async () => {
    await post(page, "Original text", "20002");
    await edit(page, "20002");
    await page.type("Edited text");
    await page.key("Enter", "meta");
    await page.waitFor(`window.__ops.flat().some(o=>o.op==='comment.edit')`);
    await page.waitFor(`${text("20002")}==='Edited text'`);
    await answered(page);
    // Every text the comment shows from the undo on.
    await page.eval(
      `window.__delay=1500;window.__seen=[];new MutationObserver(()=>{const t=${text("20002")};if(window.__seen.at(-1)!==t)window.__seen.push(t)}).observe(document.body,{subtree:true,childList:true,characterData:true})`,
    );
    await page.key("z", "meta");
    await page.waitFor(`${text("20002")}==='Original text'`);
    await page.waitFor(`window.__ops.flat().filter(o=>o.op==='comment.edit').length===2`);
    await answered(page); // the undo's answer, held back 1.5 s
    await sleep(300); // and its render
    expect(await page.eval(`window.__seen`)).toEqual(["Original text"]);
  });
});
