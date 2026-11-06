import {afterAll,expect,test} from 'bun:test';
import {mkdtemp,readdir,rm} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {APP,open,stop} from './harness';
afterAll(stop);
const holdFileSave=`(()=>{const transact=IDBDatabase.prototype.transaction;IDBDatabase.prototype.transaction=function(names,mode,...rest){const tx=transact.call(this,names,mode,...rest);if(mode==='readwrite'&&[].concat(names).includes('files')){let listener;Object.defineProperty(tx,'oncomplete',{get(){return listener},set(value){listener=value;IDBTransaction.prototype.__lookupSetter__('oncomplete').call(tx,(...args)=>setTimeout(()=>value(...args),900))}})}return tx}})()`;

test('forward Delete beside an upload cannot leave the comment composer blocked',async()=>{
 const page=await open();try{
  await page.click('[data-key="TEST-2"]');await page.waitFor(`!!document.getElementById('comment')`);await page.eval(holdFileSave);
  await page.click('#comment');await page.type('hello world');await page.key('Home');
  await page.eval(`(()=>{const data=new DataTransfer();data.items.add(new File(['note'],'note.txt',{type:'text/plain'}));document.getElementById('comment').dispatchEvent(new ClipboardEvent('paste',{clipboardData:data,bubbles:true,cancelable:true}))})()`);
  await page.waitFor(`!!document.querySelector('#comment .media-upload')`);await page.key('Delete');
  await page.waitFor(`![...document.querySelectorAll('button')].find(b=>b.textContent==='Submit comment').disabled`,10000);
  expect(await page.eval(`document.querySelector('#comment .file-media')?.textContent`)).toContain('note.txt');
  await page.eval(`document.getElementById('comment').focus()`);await page.key('Enter','meta');await page.waitFor(`document.querySelector('[data-comment^="local-"]')?.textContent.includes('note.txt')`);
 }finally{await page.close();}
});

test('active local HTML and SVG download when their blob links are opened, including after reload',async()=>{
 const page=await open(),dir=await mkdtemp(join(tmpdir(),'better-jira-active-files-'));try{
  await page.click('[data-key="TEST-2"]');await page.waitFor(`!!document.getElementById('description')`);
  const payloads=[{name:'active.html',type:'text/html',body:'<script>document.title="EXEC_LOCAL"</script>'},{name:'active.svg',type:'image/svg+xml',body:'<svg xmlns="http://www.w3.org/2000/svg" onload="document.title=\'EXEC_LOCAL\'"></svg>'}];
  await page.eval(`(()=>{const data=new DataTransfer();for(const f of ${JSON.stringify(payloads)})data.items.add(new File([f.body],f.name,{type:f.type}));document.getElementById('description').dispatchEvent(new ClipboardEvent('paste',{clipboardData:data,bubbles:true,cancelable:true}))})()`);
  await page.waitFor(`document.querySelectorAll('#description .file-media').length===2`);await page.cmd('Browser.setDownloadBehavior',{behavior:'allow',downloadPath:dir,browserContextId:page.browserContextId});
  for(const restored of [false,true]){
   if(restored){await page.waitFor(`document.querySelector('[aria-label="Local save status"]')?.textContent.includes('Saved')`);await page.reload();await page.waitFor(`document.querySelectorAll('#description .file-media').length===2`,15000);}
   for(const payload of payloads){
    const href=await page.eval<string>(`[...document.querySelectorAll('#description .file-media')].find(n=>n.textContent.includes(${JSON.stringify(payload.name)})).querySelector('a').href`);
    const mime=await page.eval(`fetch(${JSON.stringify(href)}).then(r=>r.headers.get('content-type'))`);
    const before=new Set(await readdir(dir));const {targetId}=await page.cmd('Target.createTarget',{url:href,browserContextId:page.browserContextId});
    try{let downloaded:string|undefined;for(let i=0;i<100&&!downloaded;i++){downloaded=(await readdir(dir)).find(name=>!before.has(name)&&!name.endsWith('.crdownload'));if(!downloaded)await Bun.sleep(30);}
     const {targetInfos}=await page.cmd('Target.getTargets');expect(targetInfos.filter((target:any)=>target.targetId===targetId).some((target:any)=>target.title.includes('EXEC_LOCAL'))).toBe(false);
     expect(downloaded).toBeDefined();expect(await Bun.file(join(dir,downloaded!)).text()).toBe(payload.body);expect(mime).toBe('application/octet-stream');
    }finally{await page.cmd('Target.closeTarget',{targetId}).catch(()=>{});}
   }
  }
 }finally{await page.close();await rm(dir,{recursive:true});}
});

test('a file drop uses its text coordinates instead of the current editor selection',async()=>{
 const page=await open();try{
  await page.click('[data-key="TEST-2"]');await page.waitFor(`!!document.querySelector('#description p a')`);
  await page.eval(`(()=>{const editor=document.getElementById('description'),heading=editor.querySelector('h2');editor.focus();const range=document.createRange();range.setStart(heading.firstChild,0);range.collapse(true);const selection=getSelection();selection.removeAllRanges();selection.addRange(range)})()`);
  await page.eval(`(()=>{const editor=document.getElementById('description'),node=document.createTreeWalker(editor.querySelector('p a'),NodeFilter.SHOW_TEXT).nextNode(),range=document.createRange();range.setStart(node,9);range.collapse(true);const r=range.getBoundingClientRect(),data=new DataTransfer();data.items.add(new File(['Dropped at coordinates'],'coordinate.txt',{type:'text/plain'}));editor.dispatchEvent(new DragEvent('drop',{dataTransfer:data,bubbles:true,cancelable:true,clientX:r.x,clientY:r.y+r.height/2}))})()`);
  await page.waitFor(`!!document.querySelector('#description .file-media')`);
  expect(await page.eval(`document.querySelector('#description .file-media').closest('#description > div').previousElementSibling.textContent`)).toBe('Formatted');
  expect(await page.eval(`document.querySelector('#description .file-media').closest('#description > div').nextElementSibling.textContent`)).toBe(' fixture');
 }finally{await page.close();}
});

const caretLocation=`(()=>{const editor=document.getElementById('description'),selection=getSelection();let top=selection.anchorNode;while(top&&top.parentNode!==editor&&top!==editor)top=top.parentNode;const children=[...editor.children],media=editor.querySelector('img')?.closest('.ProseMirror-selectednode')??editor.querySelector('img')?.closest('#description > div');return {block:top===editor?selection.anchorOffset:children.indexOf(top),image:children.indexOf(media),selected:!!editor.querySelector('.ProseMirror-selectednode')}})()`;

test('arrows from media land in adjacent caret positions and assistive text stays at its requested position',async()=>{
 for(const key of ['ArrowRight','ArrowLeft','ArrowDown','ArrowUp']){
  const page=await open();try{
   await fetch(`${APP}__fixture`,{method:'POST',body:JSON.stringify({includeMedia:true})});await page.click('[data-key="TEST-1"]');await page.waitFor(`document.querySelector('#description img')?.naturalWidth===320`,15000);
   await page.click('#description img');const before=await page.eval<any>(caretLocation);await page.key(key);await Bun.sleep(150);const after=await page.eval<any>(caretLocation);
   expect(after.block).toBe(before.image+(['ArrowRight','ArrowDown'].includes(key)?1:-1));
   if(key==='ArrowRight'){await page.key('ArrowRight');await page.waitFor(`!!document.querySelector('#description .ProseMirror-selectednode .file-media')`);await page.key('ArrowDown');await Bun.sleep(100);expect((await page.eval<any>(caretLocation)).block).toBe(before.image+3);}
   await page.cmd('Input.insertText',{text:'Beside image'});expect(await page.eval(`document.querySelector('#description h2').textContent`)).toBe('Rich fixture heading');
  }finally{await page.close();}
 }
 const page=await open();try{
  await page.click('[data-key="TEST-1"]');await page.waitFor(`document.querySelector('#description img')?.naturalWidth===320`,15000);await page.click('#description img');
  await page.eval(`getSelection().collapse(document.querySelector('#description h2').firstChild,3)`);await Bun.sleep(100);await page.cmd('Input.insertText',{text:'Q'});
  expect(await page.eval(`document.querySelector('#description h2').textContent`)).toBe('RicQh fixture heading');
 }finally{await fetch(`${APP}__fixture`,{method:'POST',body:'{}'});await page.close();}
});

test('dictation and IME over selected media insert at the media rather than the document start',async()=>{
 for(const ime of [false,true]){
  const page=await open();try{
   await fetch(`${APP}__fixture`,{method:'POST',body:JSON.stringify({includeMedia:true})});await page.click('[data-key="TEST-1"]');await page.waitFor(`document.querySelector('#description img')?.naturalWidth===320`,15000);await page.click('#description img');const before=await page.eval<any>(caretLocation);
   if(ime)await page.cmd('Input.imeSetComposition',{text:'に',selectionStart:1,selectionEnd:1});
   await page.cmd('Input.insertText',{text:ime?'日本':'Dictation'});await Bun.sleep(150);
   const after=await page.eval<any>(caretLocation);expect(after.block).toBeGreaterThanOrEqual(before.image-1);expect(after.block).toBeLessThanOrEqual(before.image+1);
   expect(await page.eval(`document.querySelector('#description h2').textContent`)).toBe('Rich fixture heading');
  }finally{await fetch(`${APP}__fixture`,{method:'POST',body:'{}'});await page.close();}
 }
});

test('multi-step IME next to media commits exactly the requested words',async()=>{
 for(const direction of ['ArrowLeft','ArrowRight']){
  const page=await open();try{
   await fetch(`${APP}__fixture`,{method:'POST',body:JSON.stringify({includeMedia:true})});await page.click('[data-key="TEST-1"]');await page.waitFor(`document.querySelector('#description img')?.naturalWidth===320`,15000);
   await page.click('#description img');await page.key(direction);
   for(const [steps,commit] of [[['n','に','にh','にほ','にほn','にほん'],'日本'],[['g','ご'],'語']] as const){
    for(const text of steps)await page.cmd('Input.imeSetComposition',{text,selectionStart:text.length,selectionEnd:text.length});
    await page.cmd('Input.insertText',{text:commit});await Bun.sleep(100);
   }
   expect(await page.eval(`getSelection().anchorNode.parentElement.closest('p').textContent`)).toBe('日本語');
   await page.waitFor(`!getSelection().anchorNode.parentElement.closest('p').hasAttribute('data-media-caret')`);
   expect(await page.eval(`parseFloat(getComputedStyle(getSelection().anchorNode.parentElement.closest('p')).lineHeight)`)).toBeGreaterThan(10);
  }finally{await fetch(`${APP}__fixture`,{method:'POST',body:'{}'});await page.close();}
 }
});

test('image selection and delete undo survive twenty independent issue openings',async()=>{
 try{await fetch(`${APP}__fixture`,{method:'POST',body:JSON.stringify({includeMedia:true})});
  for(let i=0;i<20;i++){
   const page=await open();try{
    await page.click('[data-key="TEST-1"]');await page.waitFor(`document.querySelector('#description video')?.readyState>=1&&document.querySelector('#description img')?.naturalWidth===320`,15000);
    await page.click('#description img');await Bun.sleep(200);
    expect(await page.eval(`!!document.querySelector('#description .ProseMirror-selectednode')`)).toBe(true);
    await page.key(i%2?'Delete':'Backspace');await page.waitFor(`!document.querySelector('#description img')`);
    await page.key('z','meta');await page.waitFor(`document.querySelector('#description img')?.naturalWidth===320`);
   }finally{await page.close();}
  }
 }finally{await fetch(`${APP}__fixture`,{method:'POST',body:'{}'});}
},120000);

test('Backspace beside a pending upload retains its insertion in the composer',async()=>{
 const page=await open();try{
  await page.click('[data-key="TEST-2"]');await page.waitFor(`!!document.getElementById('comment')`);await page.eval(holdFileSave);await page.click('#comment');await page.type('hello world');
  await page.eval(`(()=>{const data=new DataTransfer();data.items.add(new File(['note'],'backspace.txt',{type:'text/plain'}));document.getElementById('comment').dispatchEvent(new ClipboardEvent('paste',{clipboardData:data,bubbles:true,cancelable:true}))})()`);
  await page.waitFor(`!!document.querySelector('#comment .media-upload')`);await page.key('Backspace');await page.waitFor(`document.querySelector('#comment .file-media')?.textContent.includes('backspace.txt')`,10000);
  expect(await page.eval(`[...document.querySelectorAll('button')].find(b=>b.textContent==='Submit comment').disabled`)).toBe(false);
 }finally{await page.close();}
});

test('removing an entire pending insertion releases Submit after a successful save and explains recovery',async()=>{
 const page=await open();try{
  await page.click('[data-key="TEST-2"]');await page.waitFor(`!!document.getElementById('comment')`);await page.eval(holdFileSave);await page.click('#comment');await page.type('hello world');await page.key('Home');await page.key('ArrowRight');await page.key('ArrowRight');await page.key('ArrowRight');
  await page.eval(`(()=>{const data=new DataTransfer();data.items.add(new File(['note'],'removed.txt',{type:'text/plain'}));document.getElementById('comment').dispatchEvent(new ClipboardEvent('paste',{clipboardData:data,bubbles:true,cancelable:true}))})()`);await page.waitFor(`!!document.querySelector('#comment .media-upload')`);
  await page.key('a','meta');await page.key('Backspace');await page.waitFor(`document.querySelector('.rich-editor:has(#comment) > p[role="status"]')?.textContent.includes('Files saved to issue attachments')`,10000);
  await page.type('Send after recovering the attachment');
  expect(await page.eval(`[...document.querySelectorAll('button')].find(b=>b.textContent==='Submit comment').disabled`)).toBe(false);
  expect(await page.eval(`!!document.querySelector('#comment .media-upload')`)).toBe(false);
  await page.key('Enter','meta');await page.waitFor(`document.querySelector('[data-comment^="local-"]')?.textContent.includes('Send after recovering the attachment')`);
 }finally{await page.close();}
});

for(const container of ['list','table','quote'])test(`nested ${container} media accept selection and uploads after their text`,async()=>{
 const page=await open(),errors:string[]=[];try{
  await page.cmd('Runtime.enable');page.onEvent('Runtime.exceptionThrown',event=>errors.push(event.exceptionDetails.exception?.description??event.exceptionDetails.text));
  await fetch(`${APP}__fixture`,{method:'POST',body:JSON.stringify({includeMedia:true,mediaVariant:`nested-${container}`})});await page.click('[data-key="TEST-2"]');await page.hover('#description img');await page.waitFor(`document.querySelector('#description img')?.naturalWidth===320`,15000);
  await page.click('#description img');await page.key('ArrowLeft');
  await page.eval(`(()=>{const data=new DataTransfer();data.items.add(new File(['Nested file'],'nested-upload.txt',{type:'text/plain'}));document.getElementById('description').dispatchEvent(new ClipboardEvent('paste',{clipboardData:data,bubbles:true,cancelable:true}))})()`);
  await page.waitFor(`document.querySelector('#description .file-media')?.textContent.includes('nested-upload.txt')`,10000);
  expect(await page.eval(`!!document.querySelector('#description img')`)).toBe(true);expect(errors).toEqual([]);
 }finally{await fetch(`${APP}__fixture`,{method:'POST',body:'{}'});await page.close();}
});
