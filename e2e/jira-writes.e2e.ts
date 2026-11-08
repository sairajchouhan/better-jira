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
