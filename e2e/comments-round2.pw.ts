import { expect, test, sleep, type App as Page, fixture } from "./app";

// A writable site faked in the page (as in comment-undo.e2e.ts), with Jira's comment list kept here. `__remote` adds
// another person's comment and marks TEST-2 updated in the property poll; comments with "REJECT" and creates while
// `__refuseCreate` are refused; `__usersDelay` slows the people search. The 8 s comment-delete undo window runs in 1.5 s.
const setup = `(()=>{const real=fetch,st=window.setTimeout;window.setTimeout=(f,ms,...a)=>st(f,ms===8000?1500:ms,...a);
window.__ops=[];window.__usersDelay=0;window.__refuseCreate=false;let list=null,files=[],next=20000,me=null,updated=null,att=30000;
const doc=(text)=>({type:'doc',version:1,content:[{type:'paragraph',content:[{type:'text',text}]}]});
const full=async()=>{const base=await (await real('/api/issues/TEST-2')).json();list??=base.fields.comment?.comments??[];
 return {...base,fields:{...base.fields,attachment:[...(base.fields.attachment??[]),...files],comment:{comments:list,total:list.length}}};};
window.__remote=async(text)=>{await full();list=[...list,{id:String(++next),body:doc(text),created:new Date().toISOString(),author:{accountId:'alex',displayName:'Alex'}}];updated=new Date().toISOString();};
window.__drop=async(id)=>{await full();list=list.filter(c=>c.id!==id);updated=new Date().toISOString();};
window.fetch=async(input,init)=>{const path=new URL(String(input),location.href).pathname;
 if(path==='/api/client'){const client=await (await real(input,init)).json();me=client.user;return Response.json({...client,writable:true});}
 if(path==='/api/options')return Response.json({priorities:[],users:[],labels:[],versions:{}});
 if(path==='/api/users'){await new Promise(r=>st(r,window.__usersDelay));return real(input,init);}
 if(path==='/api/properties'&&updated){const issues=await (await real('/api/issues')).json();
  return Response.json({entries:Object.fromEntries(issues.map(i=>[i.key,{key:i.key,updated:i.key==='TEST-2'?updated:i.updated}])),progress:{total:0,pending:0,completed:0,errors:0}});}
 if(path==='/api/issues/TEST-2')return Response.json(await full());
 if(/^\\/api\\/issues\\/[^/]+\\/attachments$/.test(path)&&init?.method==='POST'){const id=String(++att),file={id,mediaId:'m-'+id,filename:'upload.png',mimeType:'image/png',size:1};files=[...files,file];return Response.json({attachment:file,collection:'c'});}
 const m=path.match(/^\\/api\\/issues\\/([^/]+)\\/ops$/);if(!m)return real(input,init);
 const {ops}=JSON.parse(init.body);window.__ops.push(ops);
 if(m[1]!=='TEST-2'){const create=ops.find(o=>o.op==='create');
  if(create&&window.__refuseCreate)return Response.json({key:m[1],created:{},others:[],error:'Jira refused the new issue.'});
  return Response.json({key:create?'TEST-99':m[1],created:create?{[m[1]]:'TEST-99'}:{},others:[]});}
 await full();const created={};
 const issue=(await (await real('/api/issues')).json()).find(i=>i.key===m[1]);
 for(const op of ops){
  if(op.op==='comment'&&JSON.stringify(op.body).includes('REJECT'))return Response.json({key:m[1],created,others:[],issue,full:await full(),error:'The text is longer than Jira allows.'});
  if(op.op==='comment'){const id=String(++next);created[op.ref]=id;list=[...list,{id,body:op.body,created:new Date().toISOString(),author:{accountId:me.id,displayName:me.name},...(op.parentId?{parentId:op.parentId}:{})}];}
  if(op.op==='comment.edit')list=list.map(c=>c.id===op.id?{...c,body:op.body,updated:new Date().toISOString()}:c);
  if(op.op==='comment.delete')list=list.filter(c=>c.id!==op.id);}
 return Response.json({key:m[1],created,others:[],issue,full:await full()});
};})()`;
const comment = (id: string) => `!!document.querySelector('[data-comment="${id}"]')`;
async function send(page: Page, text: string) {
  await page.waitFor(`!!document.getElementById('comment')`);
  await page.click("#comment");
  await page.type(text);
  await page.key("Enter", "meta");
}

test("R2 comments: undo/redo, refusals, image comments and the first @", async ({ open }) => {
  const page = await open("?issue=TEST-2&view=page", { setup });
  await test.step("R2-comments-D6: the first @ after a load lists people at once", async () => {
    await page.eval(`window.__usersDelay=400`);
    await page.waitFor(`!!document.getElementById('comment')`);
    await page.click("#comment");
    await sleep(700);
    await page.eval(`window.__at=performance.now()`);
    await page.type("@");
    const shown = await page.waitFor<number>(
      `document.querySelector('[aria-label="Mention people"] [role=option]')&&performance.now()-window.__at`,
    );
    // type() itself waits 60 ms after the key.
    expect(shown).toBeLessThan(200);
  });
  await test.step("R2-comments-D1: after undo and redo of a new comment, other people's comments still arrive", async () => {
    await send(page, "Mine");
    await page.waitFor(comment("20001"));
    await page.eval(`document.activeElement.blur()`);
    await page.key("z", "meta");
    await page.waitFor(`!${comment("20001")}`);
    await page.key("z", "meta", "shift");
    await page.waitFor(comment("20001"));
    await sleep(2000);
    await page.eval(`window.__remote('From Alex')`);
    await page.eval(`window.queryClient.refetchQueries({queryKey:['properties']})`);
    await page.waitFor(comment("20002"), 5000);
  });
  await test.step("R2-comments-D4: a comment Jira refuses goes back into the composer; an edit of a comment deleted elsewhere is kept", async () => {
    await send(page, "REJECT this long text");
    await page.waitFor(
      `document.getElementById('comment')?.textContent.includes('REJECT this long text')`,
    );
    await page.click("#comment");
    await page.key("a", "meta");
    await page.key("Backspace");
    await send(page, "Keep me");
    await page.waitFor(comment("20001"));
    await page.hover('[data-comment="20001"]');
    await page.click('[data-comment="20001"] [aria-label="Comment options"]');
    await page.click("text=Edit");
    await page.waitFor(`document.activeElement?.getAttribute('aria-label')==='Edit comment'`);
    await page.type(" with my unsaved edit");
    await page.eval(`window.__drop('20001')`);
    await page.eval(`window.loadFull('TEST-2', true)`);
    await page.waitFor(`!${comment("20001")}`);
    await page.waitFor(
      `document.querySelector('[data-lost-edit="20001"]')?.textContent.includes('with my unsaved edit')`,
    );
    expect(
      await page.eval(
        `document.querySelector('[data-lost-edit="20001"] [role=alert]').textContent`,
      ),
    ).toContain("deleted in Jira");
  });
  await test.step("R2-comments-D3: a new issue from an image comment shows the image and sends Jira's media id; a refused create keeps the draft", async () => {
    await fetch(`${fixture.url}__fixture`, {
      method: "POST",
      body: JSON.stringify({ includeMedia: true, mediaInComment: true }),
    });
    const page = await open("?issue=TEST-2&view=page", { setup });

    try {
      const fromComment = async () => {
        await page.waitFor(`!!document.querySelector('[data-comment="jira-media-comment"] img')`);
        await page.hover('[data-comment="jira-media-comment"]');
        await page.click('[data-comment="jira-media-comment"] [aria-label="Comment options"]');
        await page.click("text=New issue from comment…");
        await page.waitFor(`!!document.querySelector('[role="dialog"] #create-description img')`);
      };
      await fromComment();
      expect(
        await page.eval(`document.querySelector('[role="dialog"]').textContent`),
      ).not.toContain("Attachment unavailable");
      await page.eval(`window.__refuseCreate=true`);
      await page.type("Refused title");
      await page.key("Enter", "meta");
      // Jira refused it: the composer comes back with the title and image.
      await page.waitFor(`window.__ops.flat().some(o=>o.op==='create')`);
      await page.waitFor(
        `document.querySelector('[aria-label="Issue title"]')?.value==='Refused title'&&!!document.querySelector('[role="dialog"] #create-description img')`,
        8000,
      );
      await page.eval(`window.__refuseCreate=false`);
      await page.key("Enter", "meta");
      await page.waitFor(
        `window.__ops.some(ops=>ops.some(o=>o.op==='fields'&&JSON.stringify(o.fields.description??'').includes('"m-')))`,
        10000,
      );
      const sent = JSON.stringify(await page.eval(`window.__ops`));
      expect(sent).not.toContain('"collection":""');
      expect(sent).not.toContain('"collection":"local"');
    } finally {
      await page.close();
      await fetch(`${fixture.url}__fixture`, { method: "POST", body: "{}" });
    }
  });
});
