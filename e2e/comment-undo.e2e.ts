import { afterAll, expect, test } from "bun:test";
import { resolve } from "node:path";
import { open, stop, type Page } from "./harness";
afterAll(stop);

// A writable site faked in the page, with Jira's comment list kept here: creates get new numeric ids, deletes remove.
// The 8 s comment-delete undo window runs in 1.5 s. `window.__delay` holds each write's answer back.
const setup = `(()=>{const real=fetch,st=window.setTimeout;window.setTimeout=(f,ms,...a)=>st(f,ms===8000?1500:ms,...a);
window.__ops=[];window.__delay=0;let list=null,files=[],next=20000,me=null;
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
 await new Promise(r=>st(r,window.__delay));
 const issue=(await (await real('/api/issues')).json()).find(i=>i.key===m[1]);
 return Response.json({key:m[1],created,others:[],issue,full:await full()});
};})()`;
const ops = (page: Page) => page.eval<any[]>(`window.__ops.flat()`);
const text = (id: string) =>
  `document.querySelector('[data-comment="${id}"] .comment-body')?.textContent`;

async function thread(page: Page) {
  await page.waitFor(`!!document.getElementById('comment')`);
  await page.click("#comment");
  await page.type("Root to delete");
  await page.key("Enter", "meta");
  await page.waitFor(`!!document.querySelector('[data-comment="20001"]')`);
  await page.click('[data-thread="20001"] [aria-label="Reply to thread"]');
  await page.type("Reply that stays");
  await page.key("Enter", "meta");
  await page.waitFor(`!!document.querySelector('[data-comment="20002"]')`);
  // R1-D75: the reply editor keeps the focus, empty, as in Linear.
  expect(
    await page.eval(
      `!!document.activeElement?.closest('[data-thread="20001"] .rich-editor')&&document.activeElement.textContent===''`,
    ),
  ).toBe(true);
  await page.eval(`document.activeElement.blur()`);
}
async function deleteRoot(page: Page) {
  await page.hover('[data-comment="20001"]');
  await page.click('[data-comment="20001"] [aria-label="Comment options"]');
  await page.click("text=Delete");
  await page.waitFor(`!!document.querySelector('[aria-label="Delete this comment?"]')`);
  await page.key("Enter");
}

test("deleting a root waits out the undo window; undo puts it back in place with its reply", async () => {
  const page = await open("?issue=TEST-2&view=page", { setup });
  try {
    await thread(page);
    const before = await ops(page);
    await deleteRoot(page);
    // R1-D52: the reply moves to "Original comment removed" at once rather than vanishing until Jira answers.
    await page.waitFor(`!document.querySelector('[data-comment="20001"]')`);
    expect(await page.eval(text("20002"))).toBe("Reply that stays");
    expect(
      await page.eval(`document.querySelector('[data-thread="20002"]').textContent`),
    ).toContain("Original comment removed");
    await page.key("z", "meta");
    await page.waitFor(`!!document.querySelector('[data-thread="20001"] [data-comment="20002"]')`);
    await Bun.sleep(2000);
    // R1-D16: nothing reached Jira, so the comment keeps its id, time, place and reply.
    expect(await ops(page)).toEqual(before);
    expect(await page.eval(`document.querySelectorAll('[data-thread]').length`)).toBe(1);
  } finally {
    await page.close();
  }
});

test("a reply in the orphan thread of a re-created comment stays under the deleted id", async () => {
  const page = await open("?issue=TEST-2&view=page", { setup });
  try {
    await thread(page);
    await deleteRoot(page);
    await page.waitFor(`window.__ops.flat().some(o=>o.op==='comment.delete'&&o.id==='20001')`);
    await Bun.sleep(500);
    // After the window Jira has deleted it: undo can only re-create it, as 20003.
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
  } finally {
    await page.close();
  }
});

test("undoing a saved comment edit shows the old text at once and keeps it (no flicker)", async () => {
  const page = await open("?issue=TEST-2&view=page", { setup });
  try {
    await page.waitFor(`!!document.getElementById('comment')`);
    await page.click("#comment");
    await page.type("Original text");
    await page.key("Enter", "meta");
    await page.waitFor(`!!document.querySelector('[data-comment="20001"]')`);
    await page.hover('[data-comment="20001"]');
    await page.click('[data-comment="20001"] [aria-label="Comment options"]');
    await page.click("text=Edit");
    await page.waitFor(`document.activeElement?.getAttribute('aria-label')==='Edit comment'`);
    await page.key("a", "meta");
    await page.type("Edited text");
    await page.key("Enter", "meta");
    await page.waitFor(`window.__ops.flat().some(o=>o.op==='comment.edit')`);
    await page.waitFor(`${text("20001")}==='Edited text'`);
    await Bun.sleep(300);
    // Every text the comment shows from the undo on.
    await page.eval(
      `window.__delay=1500;window.__seen=[];new MutationObserver(()=>{const t=${text("20001")};if(window.__seen.at(-1)!==t)window.__seen.push(t)}).observe(document.body,{subtree:true,childList:true,characterData:true})`,
    );
    await page.key("z", "meta");
    await page.waitFor(`${text("20001")}==='Original text'`);
    await page.waitFor(`window.__ops.flat().filter(o=>o.op==='comment.edit').length===2`);
    await Bun.sleep(2500);
    expect(await page.eval(`window.__seen`)).toEqual(["Original text"]);
  } finally {
    await page.close();
  }
});

test("an upload the comment draft dropped leaves the issue; an empty edit can't be saved", async () => {
  const page = await open("?issue=TEST-2&view=page", { setup });
  try {
    await page.waitFor(`!!document.getElementById('comment')`);
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
    // R1-D17: after the 5 s grace for the editor's undo, the upload is deleted again.
    await page.waitFor(
      `window.__ops.flat().some(o=>o.op==='attachment.delete'&&o.id==='30001')`,
      10000,
    );

    // R1-D29: an emptied edit keeps the editor open with Save disabled.
    await page.click("#comment");
    await page.type("Keep me");
    await page.key("Enter", "meta");
    await page.waitFor(`!!document.querySelector('[data-comment="20001"]')`);
    await page.hover('[data-comment="20001"]');
    await page.click('[data-comment="20001"] [aria-label="Comment options"]');
    await page.click("text=Edit");
    await page.waitFor(`document.activeElement?.getAttribute('aria-label')==='Edit comment'`);
    await page.key("a", "meta");
    await page.key("Backspace");
    await page.waitFor(`document.querySelector('[aria-label="Save comment"]')?.disabled===true`);
    await page.key("Enter", "meta");
    await Bun.sleep(200);
    expect(await page.eval(`document.activeElement?.getAttribute('aria-label')`)).toBe(
      "Edit comment",
    );
  } finally {
    await page.close();
  }
});
