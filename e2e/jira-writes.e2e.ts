import {afterAll,expect,test} from 'bun:test';
import {open,stop} from './harness';
afterAll(stop);

// A writable site, faked in the page: the fixture server never reaches Jira. The first write is rejected, later ones accepted.
const setup=`(()=>{const real=fetch;window.__ops=[];let calls=0;
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

const rename=(name:string)=>`(()=>{const t=document.getElementById('summary');t.focus();t.value=${JSON.stringify(name)};t.blur();})()`;
const title=`document.getElementById('summary')?.value`;

test('writes queue to Jira; a rejected write rolls back with a toast and later writes land',async()=>{
  const p=await open('?issue=TEST-2&view=page',{setup});
  try{
    await p.waitFor(`!!document.getElementById('summary')`);
    const original=await p.eval<string>(title);
    await p.eval(rename('Rejected title'));
    expect(await p.waitFor<string>(`document.querySelector("[data-toast]")?.textContent`)).toContain('Jira did not save the change to TEST-2');
    expect(await p.waitFor<string>(`${title}===${JSON.stringify(original)}&&${title}`)).toBe(original);
    await p.eval(rename('Accepted title'));
    await p.waitFor(`window.__ops.length===2`);
    expect(await p.eval(`window.__ops`)).toEqual([[{op:'fields',fields:{summary:'Rejected title'}}],[{op:'fields',fields:{summary:'Accepted title'}}]]);
    expect(await p.eval<string>(title)).toBe('Accepted title');
  }finally{await p.close();}
});

// Creates get Jira key TEST-90; setting a parent is rejected the way Jira rejects a Task parent (defect 4).
const created=`(()=>{const real=fetch;window.__ops=[];
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

test('Create related › Parent issue defaults to the type above the source; a rejected parent says which issue was left and leaves no Activity',async()=>{
  const p=await open('?issue=TEST-2&view=page',{setup:created});
  try{
    await p.waitFor(`!!document.getElementById('comment')`);
    await p.click('#issue-options');await p.hover('[cmdk-item][data-value="Create related"]');await p.click('[cmdk-item][data-value="Parent issue…"]');
    await p.waitFor(`document.activeElement?.getAttribute('aria-label')==='Issue title'`);
    // Only Epic (one level above Task) is offered.
    await p.waitFor(`!!document.querySelector('[aria-label="Issue type: Epic"]')`);await p.click('[aria-label="Issue type: Epic"]');
    expect(await p.waitFor<string[]>(`(()=>{const items=[...document.querySelectorAll('[role="dialog"][aria-label="Issue type"] [cmdk-item]')].map(n=>n.textContent);return items.length&&items})()`)).toEqual(['Epic']);
    await p.click('[role="dialog"][aria-label="Issue type"] [cmdk-item]');await p.waitFor(`!document.querySelector('[role="dialog"][aria-label="Issue type"]')`);await p.eval(`document.querySelector('[aria-label="Create issue"] [aria-label="Issue title"]').focus()`);
    await p.type('[QA] parent epic');await p.key('Enter','meta');
    const toast=await p.waitFor<string>(`(()=>{const t=document.querySelector("[data-toast]")?.textContent;return t?.includes('Jira did not save')&&t})()`);
    expect(toast).toContain('Jira did not save the change to TEST-2');
    expect(toast).toContain('TEST-90 was created in Jira, but not linked.');
    expect((await p.eval<any[][]>(`window.__ops`))[0]![0]).toMatchObject({op:'create',fields:{type:'Epic'}});
    await p.eval(`window.machines.ui.send({type:'navigate',selected:'TEST-2',panel:true})`);
    await p.waitFor(`!!document.querySelector('.issue-activity')&&location.search.includes('issue=TEST-2')`);
    expect(await p.eval<string>(`document.querySelector('.issue-activity').textContent`)).not.toContain('parent');
  }finally{await p.close();}
});

test('Create related › Parent issue on a top-level issue says so and creates nothing',async()=>{
  const p=await open('?issue=TEST-2&view=page',{setup:created.replace(`{name:'Epic',hierarchyLevel:1},`,'')});
  try{
    await p.waitFor(`!!document.getElementById('comment')`);
    await p.click('#issue-options');await p.hover('[cmdk-item][data-value="Create related"]');await p.click('[cmdk-item][data-value="Parent issue…"]');
    expect(await p.waitFor<string>(`document.querySelector('[role="alert"]')?.textContent`)).toBe("Jira has no issue type above Task, so TEST-2 can't have a parent.");
    await p.type('[QA] nothing');await p.key('Enter','meta');await Bun.sleep(300);
    expect(await p.eval(`window.__ops.length`)).toBe(0);
    expect(await p.eval(`document.querySelector('button[type="submit"]').disabled`)).toBe(true);
  }finally{await p.close();}
});

test('the open-last-toast shortcut opens a created issue by the key Jira assigned, like View issue',async()=>{
  const p=await open('',{setup:created});
  try{
    await p.waitFor(`!!document.querySelector('[data-key]')`);
    await p.key('c');await p.waitFor(`document.activeElement?.getAttribute('aria-label')==='Issue title'`);
    await p.type('[QA] toast');await p.key('Enter','meta');
    expect(await p.waitFor<string>(`(()=>{const t=document.querySelector("[data-toast]")?.textContent;return t?.includes('TEST-90')&&t})()`)).toBe('Created TEST-90View issue');
    await p.key('o','meta','alt');
    await p.waitFor(`new URL(location.href).searchParams.get('issue')==='TEST-90'`);
  }finally{await p.close();}
});
