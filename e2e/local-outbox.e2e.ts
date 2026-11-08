import { afterAll, expect, test } from "bun:test";
import { open, stop } from "./harness";
afterAll(stop);

// A writable site faked in the page. TEST-2 has a Jira web link; every op the app sends is kept in sessionStorage, so it survives reloads.
// A create is refused the way Jira refuses a Subtask with no parent.
const setup = `(()=>{const real=fetch;
window.fetch=async(input,init)=>{const path=new URL(String(input),location.href).pathname;
 if(path==='/api/client'){const client=await (await real(input,init)).json();return Response.json({...client,writable:true});}
 if(path==='/api/options')return Response.json({priorities:[],users:[],labels:[],versions:{}});
 if(path==='/api/issues/TEST-2'){const full=await (await real(input,init)).json();return Response.json({...full,remotelinks:[{url:'https://example.com/qa',title:'QA link'}]});}
 const m=path.match(/^\\/api\\/issues\\/([^/]+)\\/ops$/);if(!m)return real(input,init);
 const {ops}=JSON.parse(init.body);sessionStorage.setItem('ops',JSON.stringify([...JSON.parse(sessionStorage.getItem('ops')||'[]'),ops]));
 if(ops[0]?.op==='create')return Response.json({error:'Issue type is a sub-task but parent issue key or id not specified.',key:m[1],created:{},others:[]},{status:422});
 const issue=(await (await real('/api/issues')).json()).find(i=>i.key===m[1]);
 return Response.json({key:m[1],created:{},others:[],issue});
};})()`;
const DB = "better-jira:local:v1:https://example.atlassian.net/audit-me";
/** The saved local changes, as `key:fields`. */
const savedChanges = `new Promise(r=>{const o=indexedDB.open(${JSON.stringify(DB)},1);o.onsuccess=()=>{const g=o.result.transaction('state').objectStore('state').get('workspace');g.onsuccess=()=>{r((g.result?.changes??[]).map(c=>c.key+':'+c.issueFields.join(',')));o.result.close();};};})`;
const sentOps = `JSON.parse(sessionStorage.getItem('ops')||'[]')`;

test("R1-D1: opening an issue with a Jira web link writes nothing; a replay sends only what Jira lacks", async () => {
  const p = await open("?issue=TEST-2&view=side", { setup });
  try {
    // The link unfurls, but a preview is not an edit.
    await p.waitFor(`!!document.querySelector('.resource-row [data-link-icon]')`);
    await Bun.sleep(400);
    expect(await p.eval(savedChanges)).toEqual([]);
    // A closed tab left a rename and the link (Jira already has it) unsent: the next load sends the rename only.
    await p.eval(`(async()=>{const issue=(await (await fetch('/api/issues')).json()).find(i=>i.key==='TEST-2');
      const change={key:'TEST-2',issue:{...issue,summary:'Renamed in a closed tab',resources:[{id:'l1',kind:'link',url:'https://example.com/qa',title:'QA link',updated:issue.updated}]},issueFields:['summary','resources','updated'],fullFields:[],created:false,tab:'closed'};
      await new Promise(r=>{const o=indexedDB.open(${JSON.stringify(DB)},1);o.onsuccess=()=>{const s=o.result.transaction('state','readwrite').objectStore('state');const g=s.get('workspace');g.onsuccess=()=>{s.put({version:1,sequence:0,undo:[],redo:[],...g.result,changes:[change],revision:(g.result?.revision??0)+1},'workspace').onsuccess=()=>{o.result.close();r();};};};});})()`);
    await p.reload();
    await p.waitFor(`${sentOps}.length===1`);
    expect(await p.eval(sentOps)).toEqual([
      [{ op: "fields", fields: { summary: "Renamed in a closed tab" } }],
    ]);
    // Nothing is left to send on the next load.
    await p.reload();
    await Bun.sleep(600);
    expect((await p.eval<unknown[]>(sentOps)).length).toBe(1);
  } finally {
    await p.close();
  }
});

test("R1-D24/D5: a create Jira refuses leaves no ghost issue, and the footer keeps saying it wasn't saved", async () => {
  const p = await open("", { setup });
  try {
    await p.key("c");
    await p.waitFor(
      `document.activeElement===document.querySelector('[aria-label="Issue title"]')`,
    );
    await p.type("Refused create");
    await p.key("Enter", "meta");
    expect(
      await p.waitFor<string>(`document.querySelector("[data-toast]")?.textContent`),
    ).toContain("Jira did not save the change to TEST-NEW");
    await p.waitFor(`!document.querySelector('[data-key^="TEST-NEW"]')`);
    expect(
      await p.eval<string>(`document.querySelector('[aria-label="Jira save status"]').textContent`),
    ).toContain("Not saved to Jira");
    await Bun.sleep(400);
    expect(await p.eval(savedChanges)).toEqual([]);
    await p.reload();
    await Bun.sleep(600);
    expect(await p.eval(`!!document.querySelector('[data-key^="TEST-NEW"]')`)).toBe(false);
    expect((await p.eval<unknown[]>(sentOps)).length).toBe(1);
  } finally {
    await p.close();
  }
});
