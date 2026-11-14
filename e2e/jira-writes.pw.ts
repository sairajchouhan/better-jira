import { expect, test, sleep, fixture, shownIssue } from "./app";

// A writable site, faked in the page: the fixture server never reaches Jira. The first write is rejected, later ones accepted.
const setup = `(()=>{const real=fetch;window.__ops=[];let calls=0;
window.fetch=async(input,init)=>{const path=new URL(String(input),location.href).pathname;
 if(path==='/api/client'){const client=await (await real(input,init)).json();return Response.json({...client,writable:true});}
 if(path==='/api/options')return Response.json({priorities:[],users:[],labels:[],versions:{}});
 const m=path.match(/^\\/api\\/issues\\/([^/]+)\\/ops$/);if(!m)return real(input,init);
 const {ops}=JSON.parse(init.body);window.__ops.push(ops);
 const issue=JSON.parse(sessionStorage.getItem('jira')||'null')??(await (await real('/api/issues')).json()).find(i=>i.key===m[1]);
 if(calls++===0)return Response.json({error:'Summary is required.',key:m[1],created:{},others:[],issue},{status:422});
 const next={...issue,...(ops[0]?.fields?.summary?{summary:ops[0].fields.summary}:{})};sessionStorage.setItem('jira',JSON.stringify(next));
 return Response.json({key:m[1],created:{},others:[],issue:next});
};})()`;

const rename = (name: string) =>
  `(()=>{const t=document.getElementById('summary');t.focus();t.value=${JSON.stringify(name)};t.blur();})()`;
const title = `document.getElementById('summary')?.value`;

// Creates get Jira key TEST-90; setting a parent is rejected the way Jira rejects a Task parent (defect 4).
const created = `(()=>{const real=fetch;window.__ops=[];
window.fetch=async(input,init)=>{const path=new URL(String(input),location.href).pathname;
 if(path==='/api/client'){const client=await (await real(input,init)).json();return Response.json({...client,writable:true});}
 if(path==='/api/options')return Response.json({priorities:[],users:[],labels:[],versions:{},types:{TEST:[{name:'Epic',hierarchyLevel:1},{name:'Task',hierarchyLevel:0},{name:'Story',hierarchyLevel:0},{name:'Subtask',hierarchyLevel:-1}]}});
 const m=path.match(/^\\/api\\/issues\\/([^/]+)\\/ops$/);if(!m)return real(input,init);
 const {ops}=JSON.parse(init.body);window.__ops.push(ops);
 if(ops[0]?.op==='create'){const f=ops[0].fields;return Response.json({key:'TEST-90',created:{[m[1]]:'TEST-90'},others:[],issue:{key:'TEST-90',board:1,summary:f.summary,status:f.status,type:f.type,assignee:null,labels:[],comments:0,updated:'2026-11-08T10:00:00Z',resolved:null,project:{key:'TEST',name:'Audit'}}});}
 const issue=(await (await real('/api/issues')).json()).find(i=>i.key===m[1]);
 if(ops.some(op=>op.fields?.parent))return Response.json({error:'The issue type selected is invalid. (pid)',key:m[1],created:{},others:[],issue},{status:422});
 return Response.json({key:m[1],created:{},others:[],issue});
};})()`;

// Writable site that accepts every write: uploads get a Jira id and media id, new comments a Jira comment id.
const accepting = `(()=>{const real=fetch;window.__ops=[];window.__uploads=[];let next=700;
window.fetch=async(input,init)=>{const path=new URL(String(input),location.href).pathname;
 if(path==='/api/client'){const client=await (await real(input,init)).json();return Response.json({...client,writable:true});}
 if(path==='/api/options')return Response.json({priorities:[],users:[],labels:[],versions:{}});
 if(/^\\/api\\/issues\\/[^/]+\\/attachments$/.test(path)&&init?.method==='POST'){const file=init.body.get('file');window.__uploads.push({name:file.name,type:file.type});return Response.json({attachment:{id:'9001',name:file.name,type:file.type,size:file.size,url:'/none',mediaId:'0b6f3c1e-1111-4222-8333-944455556666'},collection:'jira-1'});}
 const m=path.match(/^\\/api\\/issues\\/([^/]+)\\/ops$/);if(!m)return real(input,init);
 const {ops}=JSON.parse(init.body);window.__ops.push(ops);
 const issue=(await (await real('/api/issues')).json()).find(i=>i.key===m[1]);
 return Response.json({key:m[1],created:Object.fromEntries(ops.filter(o=>o.op==='comment').map(o=>[o.ref,String(next++)])),others:[],issue});
};})()`;

test("Jira writes: a rejected write rolls back, created issues open by their Jira key, and parent rules hold", async ({
  open,
}) => {
  await test.step("writes queue to Jira; a rejected write rolls back with a toast and later writes land", async () => {
    const p = await open("?issue=TEST-2&view=page", { setup });
    await p.waitFor(`!!document.getElementById('summary')`);
    const original = await p.eval<string>(title);
    await p.eval(rename("Rejected title"));
    expect(
      await p.waitFor<string>(`document.querySelector("[data-toast]")?.textContent`),
    ).toContain("Jira did not save the change to TEST-2");
    expect(await p.waitFor<string>(`${title}===${JSON.stringify(original)}&&${title}`)).toBe(
      original,
    );
    await p.eval(rename("Accepted title"));
    await p.waitFor(`window.__ops.length===2`);
    expect(await p.eval(`window.__ops`)).toEqual([
      [{ op: "fields", fields: { summary: "Rejected title" } }],
      [{ op: "fields", fields: { summary: "Accepted title" } }],
    ]);
    expect(await p.eval<string>(title)).toBe("Accepted title");
  });

  const p = await open("", { setup: created });

  await test.step("the open-last-toast shortcut opens a created issue by the key Jira assigned, like View issue", async () => {
    await p.key("c");
    await p.waitFor(`document.activeElement?.getAttribute('aria-label')==='Issue title'`);
    await p.type("[QA] toast");
    await p.key("Enter", "meta");
    expect(
      await p.waitFor<string>(
        `(()=>{const t=document.querySelector("[data-toast]")?.textContent;return t?.includes('TEST-90')&&t})()`,
      ),
    ).toBe("Issue createdTEST-90 – [QA] toastView issue");
    await p.key("o", "meta", "alt");
    await p.waitFor(`${shownIssue}==='TEST-90'`);
  });

  await test.step("Create related › Parent issue defaults to the type above the source; a rejected parent says which issue was left and leaves no Activity", async () => {
    await p.goto("?issue=TEST-2&view=page"); // a fresh load: no toasts or recorded ops from the step before
    await p.waitFor(`!!document.getElementById('comment')`);
    await p.click("#issue-options");
    await p.hover('[cmdk-item][data-value="Create related"]');
    await p.click('[cmdk-item][data-value="Parent issue…"]');
    await p.waitFor(`document.activeElement?.getAttribute('aria-label')==='Issue title'`);
    // Only Epic (one level above Task) is offered.
    await p.waitFor(`!!document.querySelector('[aria-label="Issue type: Epic"]')`);
    await p.click('[aria-label="Issue type: Epic"]');
    expect(
      await p.waitFor<string[]>(
        `(()=>{const items=[...document.querySelectorAll('[role="dialog"][aria-label="Change issue type"] [cmdk-item]')].map(n=>n.textContent);return items.length&&items})()`,
      ),
    ).toEqual(["Epic"]);
    await p.click('[role="dialog"][aria-label="Change issue type"] [cmdk-item]');
    await p.waitFor(`!document.querySelector('[role="dialog"][aria-label="Change issue type"]')`);
    await p.eval(
      `document.querySelector('[aria-label="Create issue"] [aria-label="Issue title"]').focus()`,
    );
    await p.type("[QA] parent epic");
    await p.key("Enter", "meta");
    const toast = await p.waitFor<string>(
      `(()=>{const t=document.querySelector("[data-toast]")?.textContent;return t?.includes('Jira did not save')&&t})()`,
    );
    expect(toast).toContain("Jira did not save the change to TEST-2");
    expect(toast).toContain("TEST-90 was created in Jira, but not linked.");
    expect((await p.eval<any[][]>(`window.__ops`))[0]![0]).toMatchObject({
      op: "create",
      fields: { type: "Epic" },
    });
    await p.eval(`window.machines.ui.send({type:'navigate',selected:'TEST-2',panel:true})`);
    await p.waitFor(
      `!!document.querySelector('.issue-activity')&&${shownIssue}==='TEST-2'`,
    );
    expect(
      await p.eval<string>(`document.querySelector('.issue-activity').textContent`),
    ).not.toContain("parent");
  });

  await test.step("Create related › Parent issue on a top-level issue says so and creates nothing", async () => {
    const p = await open("?issue=TEST-2&view=page", {
      setup: created.replace(`{name:'Epic',hierarchyLevel:1},`, ""),
    });
    await p.waitFor(`!!document.getElementById('comment')`);
    await p.click("#issue-options");
    await p.hover('[cmdk-item][data-value="Create related"]');
    await p.click('[cmdk-item][data-value="Parent issue…"]');
    expect(await p.waitFor<string>(`document.querySelector('[role="alert"]')?.textContent`)).toBe(
      "Jira has no issue type above Task, so TEST-2 can't have a parent.",
    );
    await p.type("[QA] nothing");
    await p.key("Enter", "meta");
    await sleep(300); // a create would be sent within this window
    expect(await p.eval(`window.__ops.length`)).toBe(0);
    // Create issue is a plain button since the composer stopped being a form (6f6e37e): find it by its label.
    expect(await p.eval(`[...document.querySelectorAll('button')].find(b=>b.textContent==='Create issue').disabled`)).toBe(true);
  });
});

test("media writes on a writable site: a crop uploads a replacing attachment that undo deletes, and an image comment is a Jira comment", async ({
  open,
}) => {
  await fixture.reset({ includeMedia: true });
  const p = await open("", { setup: accepting });

  await test.step("a crop uploads the cropped image as a new attachment that replaces it in the description, and undo deletes it", async () => {
    await p.click('[data-key="TEST-2"]');
    await p.waitFor(`document.querySelector('#description img')?.naturalWidth===320`, 15000);
    const original = await p.eval<string>(`document.querySelector('#description img').alt`);
    await p.click("#description img");
    await p.click('#description [aria-label="Crop image"]');
    await p.waitFor(`!!document.querySelector('[aria-label="Resize from top left"]')`);
    await p.click('[aria-label="Resize from top left"]');
    await p.key("ArrowRight", "shift");
    await p.click("text=Save");
    await p.waitFor(`window.__ops.length===1`);
    expect(await p.eval(`window.__uploads`)).toEqual([
      { name: original.replace(/\.[^.]+$/, "") + "-cropped.png", type: "image/png" },
    ]);
    const description = JSON.stringify(await p.eval(`window.__ops[0]`));
    expect(description).toContain('"op":"fields"');
    expect(description).toContain(
      '"id":"0b6f3c1e-1111-4222-8333-944455556666","collection":"jira-1"',
    );
    await p.waitFor(`!document.querySelector('.image-crop-editor')`);
    await p.eval(`document.activeElement?.blur()`);
    await p.key("z", "meta");
    await p.waitFor(`window.__ops.length===2`);
    const undone = await p.eval<any[]>(`window.__ops[1]`);
    expect(undone.find((op) => op.op === "attachment.delete")).toEqual({
      op: "attachment.delete",
      id: "9001",
    });
    expect(JSON.stringify(undone.find((op) => op.op === "fields"))).not.toContain("0b6f3c1e");
  });

  await test.step("an image comment is a Jira comment: created, renamed to its Jira id, then deleted", async () => {
    // A fresh page, so the recorded ops and Jira comment ids start over.
    const p = await open("", { setup: accepting });
    await p.click('[data-key="TEST-2"]');
    await p.waitFor(`document.querySelector('#description img')?.naturalWidth===320`, 15000);
    await p.hover("#description img");
    await p.click('#description [aria-label="Add image comment"]');
    await p.waitFor(`document.activeElement?.getAttribute('aria-label')==='Image comment'`);
    await p.type("Jira image review");
    await p.click('[aria-label="Submit image comment"]');
    await p.waitFor(`window.__ops.length===1`);
    const [created] = await p.eval<any[]>(`window.__ops[0]`);
    expect(created).toMatchObject({
      op: "comment",
      body: {
        type: "doc",
        version: 1,
        content: [{ type: "paragraph", content: [{ type: "text", text: "Jira image review" }] }],
      },
    });
    await p.waitFor(`!!document.querySelector('[data-image-comment="700"]')`);
    await p.click('[aria-label="Image comment options"]');
    await p.click("text=Delete image comment");
    // Comment deletes wait out the 8 s undo window before reaching Jira.
    await p.waitFor(`window.__ops.length===2`, 12000);
    expect(await p.eval(`window.__ops[1]`)).toEqual([{ op: "comment.delete", id: "700" }]);
  });
});
