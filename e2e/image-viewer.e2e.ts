import {afterAll,expect,test} from 'bun:test';
import {APP,open,stop} from './harness';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
afterAll(stop);
test('image preview opens without losing the issue, zooms, and Escape returns focus in layers',async()=>{
 const page=await open();try{
  await fetch(`${APP}__fixture`,{method:'POST',body:JSON.stringify({includeMedia:true})});await page.click('[data-key="TEST-2"]');
  await page.waitFor(`document.querySelector('#description img')?.naturalWidth===320`,15000);
  await page.click('#description img');await page.click('#description [aria-label="Full screen"]');
  await page.waitFor(`!!document.querySelector('[aria-label="Preview"] img')`);
  expect(await page.eval(`new URLSearchParams(location.search).get('issue')`)).toBe('TEST-2');
  await page.key('Tab','shift');expect(await page.active()).toBe('Close');
  await page.key('Tab');expect(await page.active()).toBe('Toggle image zoom');
  const before=await page.eval<number>(`document.querySelector('[aria-label="Preview"] img').getBoundingClientRect().width`);
  await page.click('[aria-label="Toggle image zoom"]');
  expect(await page.eval<number>(`document.querySelector('[aria-label="Preview"] img').getBoundingClientRect().width`)).toBeCloseTo(before*2,0);
  await page.key('Escape');expect(await page.eval(`!!document.querySelector('[aria-label="Preview"]')`)).toBe(true);
  await page.key('Escape');await page.waitFor(`!document.querySelector('[aria-label="Preview"]')`);
  expect(await page.active()).toBe('Full screen');
 }finally{await fetch(`${APP}__fixture`,{method:'POST',body:'{}'});await page.close();}
});

test('crop changes and image comments persist locally across reloads',async()=>{
 const page=await open();try{
  await fetch(`${APP}__fixture`,{method:'POST',body:JSON.stringify({includeMedia:true})});await page.click('[data-key="TEST-2"]');
  await page.waitFor(`document.querySelector('#description img')?.naturalWidth===320`,15000);
  await page.click('#description img');await page.click('#description [aria-label="Crop image"]');
  await page.waitFor(`!!document.querySelector('[aria-label="Resize from top left"]')`);
  await page.click('[aria-label="Resize from top left"]');await page.key('ArrowRight');
  await page.click('text=Save');await page.waitFor(`document.querySelector('#description img')?.getAttribute('src')?.startsWith('blob:')`);
  await page.key('Escape');await page.waitFor(`!document.querySelector('[aria-label="Preview"]')`);
  await page.hover('#description img');await page.click('#description [aria-label="Add image comment"]');
  await page.waitFor(`document.activeElement?.getAttribute('aria-label')==='Image comment'`);await page.type('First image review');
  await page.click('[aria-label="Submit image comment"]');await page.waitFor(`document.querySelector('[aria-label="Comment thread on image"]').textContent.includes('First image review')`);
  expect(await page.eval(`!!document.querySelector('[data-key="TEST-2"] [aria-label="1 comments"]')`)).toBe(true);
  await page.waitFor(`document.querySelector('[aria-label="Local save status"]')?.textContent.includes('Saved')`);
  await page.reload();await page.waitFor(`document.querySelector('#description img')?.getAttribute('src')?.startsWith('blob:')`,15000);
  await page.hover('#description img');await page.click('#description [aria-label="Add image comment"]');
  expect(await page.eval(`document.querySelector('[aria-label="Comment thread on image"]').textContent`)).toContain('First image review');
  expect(await page.eval(`!!document.querySelector('[data-key="TEST-2"] [aria-label="1 comments"]')`)).toBe(true);
  await page.key('Escape');await page.waitFor(`!document.querySelector('.image-comment-thread')`);
  expect(await page.active()).toBe('Add image comment');
  await page.click('text=View image');await page.waitFor(`document.activeElement?.getAttribute('aria-label')==='Image comment'`);
  expect(await page.eval(`document.querySelector('[aria-label="Comment thread on image"]').textContent`)).toContain('First image review');
  await page.click('[aria-label="Image comment options"]');await page.click('text=Edit image comment');await page.key('a','meta');await page.type('Edited image review');await page.key('Enter','meta');
  await page.waitFor(`document.querySelector('[aria-label="Comment thread on image"]').textContent.includes('Edited image review')`);
  expect(await page.eval(`!!document.querySelector('[aria-label="Preview"]')`)).toBe(false);
  await page.click('[aria-label="Image comment options"]');await page.click('text=Edit image comment');await page.key('a','meta');await page.type('Draft survives deletion');
  await page.click('[aria-label="Image comment options"]');await page.click('text=Delete image comment');await page.waitFor(`!document.querySelector('[data-image-comment]')`);
  expect(await page.eval(`document.querySelector('[aria-label="Image comment"]').value`)).toBe('Draft survives deletion');
  expect(await page.eval(`!!document.querySelector('[aria-label="Submit image comment"]')`)).toBe(true);
  await page.key('Escape');await page.click('[aria-label="Leave a comment…"]');await page.type('Normal comment after deleting image review');await page.key('Enter','meta');
  await page.waitFor(`!!document.querySelector('[data-key="TEST-2"] [aria-label="1 comments"]')`);
  const log=await(await fetch(`${APP}__fixture`)).json();expect(log.requests.some((r:any)=>r.method!=='GET')).toBe(false);
 }finally{await fetch(`${APP}__fixture`,{method:'POST',body:'{}'});await page.close();}
});

test('image copy produces PNG bytes and copy-link contains the local proxy URL',async()=>{
 const page=await open();try{
  await page.cmd('Browser.grantPermissions',{origin:new URL(APP).origin,browserContextId:page.browserContextId,permissions:['clipboardReadWrite','clipboardSanitizedWrite']});
  await page.eval(`(async()=>{window.previousClipboard=await navigator.clipboard.read();window.clipboardCaptured=true;return true})()`);
  await fetch(`${APP}__fixture`,{method:'POST',body:JSON.stringify({includeMedia:true})});await page.click('[data-key="TEST-2"]');
  await page.waitFor(`document.querySelector('#description img')?.naturalWidth===320`,15000);await page.click('#description img');await page.click('#description [aria-label="Full screen"]');
  await page.click('[aria-label="Preview"] [aria-label="Copy link"]');
  await page.waitFor(`document.querySelector('.image-preview-notice')?.textContent==='Link copied'`);
  expect(await page.eval(`navigator.clipboard.readText()`)).toBe(`${APP}api/issues/TEST-2/attachments/102`);
  await page.click('[aria-label="Preview"] [aria-label="Copy image"]');await page.waitFor(`document.querySelector('.image-preview-notice')?.textContent==='Image copied'`);
  expect(await page.eval(`(async()=>{const items=await navigator.clipboard.read();const bitmap=await createImageBitmap(await items[0].getType('image/png'));const size=[bitmap.width,bitmap.height];bitmap.close();return size})()`)).toEqual([320,480]);
  await page.click('[aria-label="Preview"] [aria-label="Crop image"]');await page.click('[aria-label="Resize from top left"]');await page.key('ArrowRight');await page.click('text=Save');
  await page.waitFor(`document.querySelector('[aria-label="Preview"] img')?.naturalWidth===319`);
  await page.click('[aria-label="Preview"] [aria-label="Copy link"]');await page.waitFor(`document.querySelector('.image-preview-notice')?.textContent==='Link copied'`);
  expect(await page.eval(`navigator.clipboard.readText()`)).toBe(`${APP}api/issues/TEST-2/attachments/102`);
  await page.click('[aria-label="Preview"] [aria-label="Copy image"]');await page.waitFor(`document.querySelector('.image-preview-notice')?.textContent==='Image copied'`);
  expect(await page.eval(`(async()=>{const items=await navigator.clipboard.read();const bitmap=await createImageBitmap(await items[0].getType('image/png'));const width=bitmap.width;bitmap.close();return width})()`)).toBe(319);
 }finally{await page.eval(`(async()=>{if(window.clipboardCaptured){if(window.previousClipboard?.length)await navigator.clipboard.write(window.previousClipboard);else await navigator.clipboard.writeText('')}})()`).catch(()=>{});await fetch(`${APP}__fixture`,{method:'POST',body:'{}'});await page.close();}
});

test('keyboard and pointer cropping keep their geometry, and unreadable sources never save',async()=>{
 const page=await open();try{
  await fetch(`${APP}__fixture`,{method:'POST',body:JSON.stringify({includeMedia:true})});await page.click('[data-key="TEST-2"]');
  await page.waitFor(`document.querySelector('#description img')?.naturalWidth===320`,15000);await page.hover('#description img');await page.click('#description [aria-label="Crop image"]');
  await page.click('[aria-label="Resize from bottom right"]');await page.key('ArrowLeft','shift');
  expect(await page.eval(`parseFloat(document.querySelector('.image-crop-selection').style.width)`)).toBeCloseTo(100-10/320*100,4);
  await page.key('Escape');await page.key('Escape');await page.hover('#description img');await page.click('#description [aria-label="Crop image"]');
  const handle=await page.rect('[aria-label="Resize from bottom right"]'),stage=await page.rect('.image-crop-stage');
  const x=handle.x+handle.width/2,y=handle.y+handle.height/2;
  await page.cmd('Input.dispatchMouseEvent',{type:'mousePressed',x,y,button:'left',buttons:1,clickCount:1});
  await page.cmd('Input.dispatchMouseEvent',{type:'mouseMoved',x:x-stage.width/2,y:y-stage.height/2,button:'left',buttons:1});
  await page.cmd('Input.dispatchMouseEvent',{type:'mouseReleased',x:x-stage.width/2,y:y-stage.height/2,button:'left',buttons:0});
  expect(await page.eval(`parseFloat(document.querySelector('.image-crop-selection').style.width)`)).toBeCloseTo(50,1);
  expect(await page.eval(`parseFloat(document.querySelector('.image-crop-selection').style.height)`)).toBeCloseTo(50,1);
  await fetch(`${APP}__fixture`,{method:'POST',body:JSON.stringify({includeMedia:true,contentFailure:403})});
  await page.click('text=Save');await page.waitFor(`document.querySelector('[aria-label="Crop image"] [role="alert"]')?.textContent.includes('Could not crop')`);
  await fetch(`${APP}__fixture`,{method:'POST',body:JSON.stringify({includeMedia:true})});
  await page.key('Escape');await page.waitFor(`!!document.querySelector('[aria-label="Preview"]')`);await page.key('Escape');
  expect(await page.eval(`new URLSearchParams(location.search).get('issue')`)).toBe('TEST-2');
  await page.reload();await page.waitFor(`!!document.querySelector('#description img')`,15000);
  expect(await page.eval(`document.querySelector('#description img').getAttribute('src')`)).toBe('/api/issues/TEST-2/attachments/102');
 }finally{await fetch(`${APP}__fixture`,{method:'POST',body:'{}'});await page.close();}
});

test('external images keep stable comment navigation while unreadable editing controls are disabled',async()=>{
 const page=await open();try{
  const bytes=Buffer.from(await Bun.file('e2e/fixtures/media-image.png').arrayBuffer()).toString('base64');
  const failures:string[]=[];
  page.onEvent('Fetch.requestPaused',params=>{void page.cmd('Fetch.fulfillRequest',{requestId:params.requestId,responseCode:200,responseHeaders:[{name:'Content-Type',value:'image/png'}],body:bytes}).catch(error=>failures.push(String(error)));});
  await page.cmd('Fetch.enable',{patterns:[{urlPattern:'https://images.example.test/*',requestStage:'Request'}]});
  await fetch(`${APP}__fixture`,{method:'POST',body:JSON.stringify({includeMedia:true,mediaVariant:'layouts'})});await page.click('[data-key="TEST-2"]');
  const external='#description .media-frame:has(img[alt="External portrait"])';
  await page.hover(`${external} img`);await page.waitFor(`document.querySelector('${external} img')?.naturalWidth===320`,15000);
  await page.waitFor(`document.querySelector('${external} [aria-label="Copy image"]')?.title.includes('cannot be read')`);
  expect(await page.eval(`document.querySelector('${external} [aria-label="Copy image"]').disabled`)).toBe(true);
  expect(await page.eval(`document.querySelector('${external} [aria-label="Crop image"]').disabled`)).toBe(true);
  const id=await page.eval<string>(`document.querySelector('${external}').dataset.mediaId`);expect(id).toMatch(/^external-[a-f0-9]{16}$/);
  await page.click(`${external} [aria-label="Add image comment"]`);await page.type('External image review');await page.key('Enter','meta');
  await page.waitFor(`document.querySelector('[aria-label="Local save status"]')?.textContent.includes('Saved')`);await page.reload();await page.hover(`${external} img`);
  await page.waitFor(`document.querySelector('${external} img')?.naturalWidth===320`,15000);
  expect(await page.eval(`document.querySelector('${external}').dataset.mediaId`)).toBe(id);
  await page.click('text=View image');await page.waitFor(`document.activeElement?.getAttribute('aria-label')==='Image comment'`);
  expect(await page.eval(`document.querySelector('[aria-label="Comment thread on image"]').textContent`)).toContain('External image review');
  await page.key('Escape');expect(await page.active()).toBe('Add image comment');expect(failures).toEqual([]);
 }finally{await fetch(`${APP}__fixture`,{method:'POST',body:'{}'});await page.close();}
});

test('cropped downloads contain PNG bytes and a PNG filename even for a JPEG-named source',async()=>{
 const page=await open(),dir=await mkdtemp(join(tmpdir(),'better-jira-image-download-'));try{
  page.onEvent('Fetch.requestPaused',params=>{void page.cmd('Fetch.fulfillRequest',{requestId:params.requestId,responseCode:200,responseHeaders:[{name:'Content-Type',value:'application/json'}],body:Buffer.from(JSON.stringify({id:'102',mediaId:'22222222-2222-4222-8222-222222222222',url:'/api/issues/TEST-2/attachments/102',name:'portrait.jpg',type:'image/png',size:1000})).toString('base64')});});
  await page.cmd('Fetch.enable',{patterns:[{urlPattern:'*/api/issues/TEST-2/media/22222222*',requestStage:'Request'}]});
  await fetch(`${APP}__fixture`,{method:'POST',body:JSON.stringify({includeMedia:true})});await page.click('[data-key="TEST-2"]');
  await page.waitFor(`document.querySelector('#description img')?.naturalWidth===320`,15000);await page.hover('#description img');await page.click('#description [aria-label="Full screen"]');
  await page.waitFor(`!!document.querySelector('[aria-label="Download image"]')`);
  expect(await page.eval(`document.querySelector('[aria-label="Download image"]').download`)).toBe('portrait.jpg');
  expect(await page.eval(`document.querySelector('[aria-label="Download image"]').getAttribute('href')`)).toBe('/api/issues/TEST-2/attachments/102?download=1');
  await page.click('[aria-label="Preview"] [aria-label="Crop image"]');await page.click('[aria-label="Resize from top left"]');await page.key('ArrowRight','shift');await page.click('text=Save');
  await page.waitFor(`document.querySelector('[aria-label="Preview"] img')?.naturalWidth===310`);
  expect(await page.eval(`document.querySelector('[aria-label="Download image"]').download`)).toBe('portrait.png');
  await page.cmd('Page.setDownloadBehavior',{behavior:'allow',downloadPath:dir});await page.click('[aria-label="Download image"]');
  const path=join(dir,'portrait.png');for(let i=0;i<100&&!await Bun.file(path).exists();i++)await Bun.sleep(40);
  expect(await Bun.file(path).exists()).toBe(true);const data=new Uint8Array(await Bun.file(path).arrayBuffer());expect([...data.slice(0,8)]).toEqual([137,80,78,71,13,10,26,10]);
  expect(new DataView(data.buffer).getUint32(16)).toBe(310);
 }finally{await fetch(`${APP}__fixture`,{method:'POST',body:'{}'});await page.close();await rm(dir,{recursive:true});}
});

test('an unfinished image comment draft survives closing and reopening its thread',async()=>{
 const page=await open();try{
  await fetch(`${APP}__fixture`,{method:'POST',body:JSON.stringify({includeMedia:true})});await page.click('[data-key="TEST-2"]');await page.waitFor(`document.querySelector('#description img')?.naturalWidth===320`,15000);
  await page.hover('#description img');await page.click('#description [aria-label="Add image comment"]');await page.waitFor(`document.activeElement?.getAttribute('aria-label')==='Image comment'`);await page.type('Unfinished image review');await page.key('Escape');
  await page.click('#description [aria-label="Add image comment"]');expect(await page.eval(`document.querySelector('[aria-label="Image comment"]').value`)).toBe('Unfinished image review');
  await page.click('#description [aria-label="Hide image comments"]');await page.click('#description [aria-label="Add image comment"]');expect(await page.eval(`document.querySelector('[aria-label="Image comment"]').value`)).toBe('Unfinished image review');
 }finally{await fetch(`${APP}__fixture`,{method:'POST',body:'{}'});await page.close();}
});
