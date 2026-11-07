import {afterAll,expect,test} from 'bun:test';
import {open,stop,type Page} from './harness';
afterAll(stop);
// Sending while a pasted file is still saving (Opus review 4, P1–P5): posted once, never resurrected into a draft, and a sub-issue keeps its image.
const hold=`window.createImageBitmap=()=>new Promise(r=>{window.release=()=>r({width:10,height:10,close(){}})});`;
async function paste(p:Page,sel:string,name='late.png'){await p.eval(`${hold}(()=>{const d=new DataTransfer();d.items.add(new File([new Uint8Array([137,80,78,71])],'${name}',{type:'image/png'}));document.querySelector(${JSON.stringify(sel)}).dispatchEvent(new ClipboardEvent('paste',{clipboardData:d,bubbles:true,cancelable:true}))})()`);await p.waitFor(`typeof window.release==='function'`);}
const go=async(p:Page,key:string)=>{await p.eval(`history.pushState({},'','?issue=${key}&view=page');dispatchEvent(new PopStateEvent('popstate'))`);await p.waitFor(`!!document.querySelector('[data-key="${key}"]')&&!!document.getElementById('comment')`);};
const state=(p:Page)=>p.eval(`({composer:document.getElementById('comment')?.textContent,composerMedia:document.querySelectorAll('#comment [contenteditable=false]').length,comments:[...document.querySelectorAll('[data-thread]')].map(n=>n.textContent.slice(0,120)),drafts:Object.fromEntries(Object.entries(localStorage).filter(([k])=>/draft/i.test(k)).map(([k,v])=>[k,v.slice(0,300)]))})`);

test('P1 comment sent while upload pending, then user leaves the issue: posted once, draft not resurrected',async()=>{
  const p=await open('?issue=TEST-2&view=page');const log:any={};
  try{
    await p.click('#comment');await p.type('SEND PENDING');await paste(p,'#comment');
    await p.key('Enter','meta');await Bun.sleep(200);
    log.beforeLeave=await state(p);
    await go(p,'TEST-3');await p.eval('window.release()');await Bun.sleep(800);
    await go(p,'TEST-2');await Bun.sleep(400);
    log.back=await state(p);
    await p.reload();await p.waitFor(`!!document.getElementById('comment')`);await Bun.sleep(300);
    log.reloaded=await state(p);
  }finally{await p.close();}
  expect(log.reloaded.comments.filter((t:string)=>t.includes('SEND PENDING')).length).toBe(1);
  expect(log.reloaded.composerMedia).toBe(0);
});

test('P2 comment sent while upload pending, user leaves and returns before it finishes: live composer stays empty',async()=>{
  const p=await open('?issue=TEST-2&view=page');const log:any={};
  try{
    await p.click('#comment');await p.type('SEND PENDING 2');await paste(p,'#comment');
    await p.key('Enter','meta');await Bun.sleep(200);
    await go(p,'TEST-3');await go(p,'TEST-2');
    await p.eval('window.release()');await Bun.sleep(800);
    log.back=await state(p);
    await p.reload();await p.waitFor(`!!document.getElementById('comment')`);await Bun.sleep(300);
    log.reloaded=await state(p);
  }finally{await p.close();}
  expect(log.back.composerMedia).toBe(0);
  expect(log.reloaded.comments.filter((t:string)=>t.includes('SEND PENDING 2')).length).toBe(1);
});

const PNG='iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';
async function pastePng(p:Page,sel:string,name='real.png'){await p.eval(`window.release=undefined;window.createImageBitmap=()=>new Promise(r=>{window.release=()=>r({width:10,height:10,close(){}})});(()=>{const b=Uint8Array.from(atob('${PNG}'),c=>c.charCodeAt(0));const d=new DataTransfer();d.items.add(new File([b],'${name}',{type:'image/png'}));document.querySelector(${JSON.stringify(sel)}).dispatchEvent(new ClipboardEvent('paste',{clipboardData:d,bubbles:true,cancelable:true}))})()`);await p.waitFor(`typeof window.release==='function'`);}
const openSub=async(p:Page)=>{await p.eval('document.activeElement?.blur()');await p.key('o','meta','shift');await p.waitFor(`document.activeElement?.getAttribute('aria-label')==='Sub-issue title'`);};
const subState=(p:Page)=>p.eval(`({rows:[...document.querySelectorAll('[data-sub-issue], [data-key]')].map(n=>n.textContent.slice(0,60)).filter(t=>t.includes('PENDING CHILD')),draft:Object.fromEntries(Object.entries(localStorage).filter(([k])=>k.includes('sub-issue-draft')).map(([k,v])=>[k,v.slice(0,300)]))})`);

test('P3 sub-issue created with Cmd+Enter while its pasted image is still saving: child keeps the image',async()=>{
  const p=await open('?issue=TEST-2&view=page');const log:any={};
  try{
    await p.waitFor(`!!document.getElementById('summary')`);await openSub(p);await p.type('PENDING CHILD A');await p.click('[aria-label="Sub-issue description"]');await pastePng(p,'[aria-label="Sub-issue description"]');
    await p.key('Enter','meta');await Bun.sleep(150);await p.eval('window.release()');await Bun.sleep(1000);
    log.after=await subState(p);
    log.composerAfterCreate=await p.eval(`({title:document.querySelector('[aria-label="Sub-issue title"]')?.value,media:document.querySelectorAll('[aria-label="Sub-issue description"] [contenteditable=false]').length})`);
    const store=await p.eval(`(()=>{const out={};for(const [k,v] of Object.entries(localStorage)){if(v.includes('PENDING CHILD A'))out[k]=v.slice(0,1500);}return out;})()`);log.store=store;
    await go(p,'TEST-NEW1');await Bun.sleep(500);
    log.child=await p.eval(`({url:location.search,desc:document.getElementById('description')?.innerHTML.slice(0,800),broken:document.body.textContent.includes('Could not display')})`);
  }finally{await p.close();}
  expect(log.child.desc).toContain('data-media-group');
  expect(log.composerAfterCreate.media).toBe(0);
});

test('P4 sub-issue created while image saving, then user leaves: created once, draft not resurrected',async()=>{
  const p=await open('?issue=TEST-2&view=page');const log:any={};
  try{
    await p.waitFor(`!!document.getElementById('summary')`);await openSub(p);await p.type('PENDING CHILD B');await p.click('[aria-label="Sub-issue description"]');await pastePng(p,'[aria-label="Sub-issue description"]');
    await p.key('Enter','meta');await Bun.sleep(150);
    await go(p,'TEST-3');await p.eval('window.release()');await Bun.sleep(800);await go(p,'TEST-2');await Bun.sleep(300);
    log.back=await subState(p);
    log.count=await p.eval(`Object.values(localStorage).join('\\n').split('PENDING CHILD B').length-1`);
    await p.reload();await p.waitFor(`!!document.getElementById('summary')`);await openSub(p);await Bun.sleep(300);
    log.reopened=await p.eval(`({title:document.querySelector('[aria-label="Sub-issue title"]').value,media:document.querySelectorAll('[aria-label="Sub-issue description"] [contenteditable=false]').length,childRows:[...document.querySelectorAll('[data-sub-issue]')].filter(n=>n.textContent.includes('PENDING CHILD B')).length+(document.querySelector('[data-key="TEST-NEW2"]')?1:0)})`);
  }finally{await p.close();}
  expect(log.reopened.title).toBe('');expect(log.reopened.media).toBe(0);expect(log.reopened.childRows).toBe(1);
});

test('P5 reply sent while upload pending, then user leaves: reply posted once, reply draft not resurrected',async()=>{
  const p=await open('?issue=TEST-2&view=page');const log:any={};
  try{
    await p.click('#comment');await p.type('ROOT P5');await p.key('Enter','meta');await p.waitFor(`!!document.querySelector('[aria-label="Reply to thread"]')`);
    await p.click('[aria-label="Reply to thread"]');await p.type('REPLY PENDING');await pastePng(p,'[id^="reply-"]');
    await p.key('Enter','meta');await Bun.sleep(150);
    await go(p,'TEST-3');await p.eval('window.release()');await Bun.sleep(800);await go(p,'TEST-2');await Bun.sleep(300);
    await p.reload();await p.waitFor(`!!document.getElementById('comment')`);await Bun.sleep(300);
    log.threads=await p.eval(`[...document.querySelectorAll('[data-thread]')].map(n=>n.textContent.slice(0,200))`);
    log.drafts=await p.eval(`Object.fromEntries(Object.entries(localStorage).filter(([k])=>/draft/i.test(k)).map(([k,v])=>[k,v.slice(0,300)]))`);
    await p.click('[aria-label="Reply to thread"]');await Bun.sleep(300);
    log.replyComposer=await p.eval(`({text:document.querySelector('[id^="reply-"]')?.textContent,media:document.querySelectorAll('[id^="reply-"] [contenteditable=false]').length})`);
  }finally{await p.close();}
  expect(log.replyComposer.media).toBe(0);
});

test('P3c control: sub-issue created after its image finished saving keeps the image',async()=>{
  const p=await open('?issue=TEST-2&view=page');const log:any={};
  try{
    await p.waitFor(`!!document.getElementById('summary')`);await openSub(p);await p.type('PENDING CHILD C');await p.click('[aria-label="Sub-issue description"]');await pastePng(p,'[aria-label="Sub-issue description"]');
    await p.eval('window.release()');await Bun.sleep(800);
    log.composerBefore=await p.eval(`document.querySelectorAll('[aria-label="Sub-issue description"] [contenteditable=false]').length`);
    await p.key('Enter','meta');await Bun.sleep(800);
    await go(p,'TEST-NEW1');await Bun.sleep(500);
    log.child=await p.eval(`({title:document.getElementById('summary')?.value??document.getElementById('summary')?.textContent,desc:document.getElementById('description')?.innerHTML.slice(0,300)})`);
  }finally{await p.close();}
  expect(log.child.desc).toContain('data-media-group');
});
