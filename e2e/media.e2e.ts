import { afterAll, expect, test } from "bun:test";
import { APP, open, stop } from "./harness";
afterAll(stop);
const settings=(patch:object)=>fetch(`${APP}__fixture`,{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({includeMedia:true,...patch})});
async function mediaIssue(page:Awaited<ReturnType<typeof open>>,key="TEST-1"){
  await page.click(`[data-key="${key}"]`);
  await page.waitFor(`document.querySelector('#description video')?.readyState>=1`,15000);
}

test("Jira media uses exact UUID mapping and local byte ranges, inside the description", async () => {
  const page=await open();
  try {
    await settings({});await mediaIssue(page);
    expect(await page.eval(`document.querySelector('#description video').getAttribute('src')`)).toBe('/api/issues/TEST-1/attachments/101');
    expect(await page.eval(`document.querySelector('#description video').duration`)).toBeCloseTo(4,0);
    expect(await page.eval(`document.querySelector('#description video').videoWidth/document.querySelector('#description video').videoHeight`)).toBe(3);
    await page.waitFor(`document.querySelector('#description img')?.naturalWidth===320`);
    expect(await page.eval(`document.querySelector('#description img').naturalHeight`)).toBe(480);
    expect(await page.eval(`document.querySelector('#description img').getAttribute('src')`)).toBe('/api/issues/TEST-1/attachments/102');
    expect(await page.eval(`document.querySelector('#description [data-attachment-id="103"]').textContent`)).toContain('media-file.txt');
    expect(await page.eval(`document.getElementById('description').textContent.includes('[mediaSingle]')`)).toBe(false);
    await page.eval(`(()=>{const video=document.querySelector('#description video');video.currentTime=3;return video.play()})()`);
    await page.waitFor(`document.querySelector('#description video').currentTime>=3`);
    const log=await (await fetch(`${APP}__fixture`)).json();
    expect(log.requests.some((r:any)=>r.path==='/api/issues/TEST-1/attachments/101'&&r.status===206)).toBe(true);
    expect(log.requests.some((r:any)=>r.path.startsWith('/upstream/attachment/101?range=bytes='))).toBe(true);
    expect(log.requests.some((r:any)=>r.method!=='GET')).toBe(false);
  } finally {await fetch(`${APP}__fixture`,{method:'POST',body:'{}'});await page.close();}
});

test("media resolution errors are visible and retry recovers without an issue reload",async()=>{
  const page=await open();
  try {
    await settings({mediaFailure:503});await page.click('[data-key="TEST-1"]');
    await page.waitFor(`document.querySelector('#description [role=alert]')?.textContent.includes('Could not load attachment')`);
    expect(await page.eval(`!!document.querySelector('#description video')`)).toBe(false);
    await settings({});await page.click('text=Retry attachment');
    await page.waitFor(`document.querySelector('#description video')?.readyState>=1`,15000);
  }finally{await fetch(`${APP}__fixture`,{method:'POST',body:'{}'});await page.close();}
});

test("comment media on a middle issue isolates navigation and commands, while Space actually plays",async()=>{
  const page=await open();
  try {
    await settings({mediaInComment:true});await mediaIssue(page,"TEST-2");
    const video=`document.querySelector('[data-comment="jira-media-comment"] video')`;
    await page.waitFor(`${video}?.readyState>=1`,15000);
    for(const key of ['j','k','p','f','m','Escape']){
      await page.eval(`${video}.focus()`);await page.key(key);
      expect(await page.eval(`new URLSearchParams(location.search).get('issue')`)).toBe('TEST-2');
      expect(await page.eval(`!!document.querySelector('[aria-label="Add Filter…"],[cmdk-input],[role=dialog]:not([data-video-player])')`)).toBe(false);
    }
    await page.eval(`${video}.pause();${video}.currentTime=1;${video}.focus()`);
    expect(await page.eval(`${video}.paused`)).toBe(true);
    await page.key(' ');await page.waitFor(`!${video}.paused&&${video}.currentTime>1`);
    expect(await page.eval(`new URLSearchParams(location.search).get('issue')`)).toBe('TEST-2');
  }finally{await fetch(`${APP}__fixture`,{method:'POST',body:'{}'});await page.close();}
});

test("unmapped media shows an unavailable card rather than guessing another attachment",async()=>{
  const page=await open();
  try{
    await settings({unmappedMedia:true});await mediaIssue(page);
    await page.waitFor(`document.querySelector('#description [role=alert]')?.textContent.includes('could not be found')`);
    expect(await page.eval(`document.querySelectorAll('#description video').length`)).toBe(1);
    expect(await page.eval(`document.querySelectorAll('#description img').length`)).toBe(1);
  }finally{await fetch(`${APP}__fixture`,{method:'POST',body:'{}'});await page.close();}
});

test("failed file bytes show a retry action and can recover",async()=>{
  const page=await open();
  try{
    await settings({contentFailure:503});await page.click('[data-key="TEST-1"]');
    await page.waitFor(`!!document.querySelector('#description [data-video-player] [role=alert]')`);
    await settings({});await page.click('#description [aria-label="Retry video"]');
    await page.waitFor(`document.querySelector('#description video')?.readyState>=1&&!document.querySelector('#description [data-video-player] [role=alert]')`,15000);
  }finally{await fetch(`${APP}__fixture`,{method:'POST',body:'{}'});await page.close();}
});

test("board loading with real media available does not resolve or fetch attachments",async()=>{
  const page=await open();
  try{
    await settings({mediaInComment:true});await page.reload();
    await page.waitFor(`!!document.querySelector('[data-key="TEST-1"]')`);
    await page.hover('[data-key="TEST-2"]');await Bun.sleep(400);
    const log=await (await fetch(`${APP}__fixture`)).json();
    expect(log.requests.some((r:any)=>r.path==='/api/issues')).toBe(true);
    expect(log.requests.some((r:any)=>/\/media\/|\/attachments\/|\/upstream\//.test(r.path))).toBe(false);
  }finally{await fetch(`${APP}__fixture`,{method:'POST',body:'{}'});await page.close();}
});

test("ADF dimensions reserve media space before metadata and bytes arrive",async()=>{
  const page=await open();
  try{
    await settings({mediaDelay:1800});await page.click('[data-key="TEST-1"]');
    await page.waitFor(`document.querySelectorAll('#description [data-media-interactive] [role=status]').length===3`);
    const before=await page.eval<number>(`document.getElementById('description').getBoundingClientRect().height`);
    await page.waitFor(`document.querySelector('#description video')?.readyState>=1&&document.querySelector('#description img')?.naturalWidth===320`,15000);
    const after=await page.eval<number>(`document.getElementById('description').getBoundingClientRect().height`);
    expect(Math.abs(after-before)).toBeLessThan(6);
  }finally{await fetch(`${APP}__fixture`,{method:'POST',body:'{}'});await page.close();}
});

test("media without a saved width stays at native size and wrap leaves space for text",async()=>{
  const page=await open();
  try{
    await settings({mediaVariant:'natural'});await page.goto('?issue=TEST-1&view=page');
    await page.waitFor(`document.querySelector('#description video')?.readyState>=1&&document.querySelector('#description img')?.naturalWidth===320`,15000);
    const sizes=await page.eval<any>(`(()=>{const root=document.getElementById('description'),wrap=root.querySelector('[data-media-layout="wrap-left"]'),p=wrap.parentElement.nextElementSibling,range=document.createRange();range.setStart(p.firstChild,0);range.setEnd(p.firstChild,1);return {column:root.clientWidth,image:root.querySelector('img').getBoundingClientRect().width,video:root.querySelector('video').getBoundingClientRect().width,wrap:wrap.getBoundingClientRect().width,right:wrap.getBoundingClientRect().right,text:range.getBoundingClientRect().left}})()`);
    expect(sizes.column).toBeGreaterThan(480);expect(sizes.image).toBeLessThanOrEqual(320);expect(sizes.video).toBeLessThanOrEqual(480);expect(sizes.wrap).toBe(320);expect(sizes.text).toBeGreaterThan(sizes.right);
  }finally{await fetch(`${APP}__fixture`,{method:'POST',body:'{}'});await page.close();}
});

test("clicking an image selects its ADF atom, Backspace deletes it and undo restores it",async()=>{
  const page=await open();
  try{
    await settings({});await mediaIssue(page);
    await page.waitFor(`document.querySelector('#description img')?.naturalWidth===320`);
    await page.click('#description img');
    await page.waitFor(`!!document.querySelector('#description .ProseMirror-selectednode')&&document.activeElement===document.getElementById('description')`);
    await page.key('Backspace');await page.waitFor(`!document.querySelector('#description img')`);
    await page.key('z','meta');await page.waitFor(`document.querySelector('#description img')?.naturalWidth===320`);
    expect(await page.eval(`document.querySelectorAll('#description img').length`)).toBe(1);
  }finally{await fetch(`${APP}__fixture`,{method:'POST',body:'{}'});await page.close();}
});

test("ADF width, wrap, filmstrip, inline chips and external images without CORS render correctly",async()=>{
  const page=await open();
  const failures:string[]=[],externalRequests:any[]=[];
  try{
    const bytes=Buffer.from(await Bun.file('e2e/fixtures/media-image.png').arrayBuffer()).toString('base64');
    page.onEvent('Fetch.requestPaused',params=>{externalRequests.push(params.request);void page.cmd('Fetch.fulfillRequest',{requestId:params.requestId,responseCode:200,responseHeaders:[{name:'Content-Type',value:'image/png'}],body:bytes}).catch(error=>failures.push(String(error)));});
    await page.cmd('Fetch.enable',{patterns:[{urlPattern:'https://images.example.test/*',requestStage:'Request'}]});
    await settings({mediaVariant:'layouts',mediaInComment:true});await mediaIssue(page);
    await page.waitFor(`!!document.querySelector('#description [data-media-layout="wrap-left"]')`);
    const dimensions=await page.eval<any>(`(()=>{const root=document.getElementById('description'),wrap=root.querySelector('[data-media-layout="wrap-left"]'),pixel=root.querySelector('[data-media-layout="align-end"]'),wide=root.querySelector('[data-media-layout="wide"]'),full=root.querySelector('[data-media-layout="full-width"]');return {root:root.clientWidth,wrap:wrap.getBoundingClientRect().width,float:getComputedStyle(wrap.parentElement).float,pixel:pixel.getBoundingClientRect().width,wide:wide.getBoundingClientRect().width,full:full.getBoundingClientRect().width}})()`);
    expect(dimensions.wrap/dimensions.root).toBeCloseTo(0.5,1);expect(dimensions.float).toBe('left');expect(dimensions.pixel).toBe(160);expect(dimensions.wide).toBeGreaterThan(dimensions.root);expect(dimensions.full).toBeGreaterThan(dimensions.wide);
    expect(await page.eval(`getComputedStyle(document.querySelector('#description .media-filmstrip')).display`)).toBe('flex');
    const inline=`document.querySelector('[data-comment="jira-media-comment"] .media-inline')`;
    await page.waitFor(`${inline}?.textContent.includes('media-file.txt')`);
    expect(await page.eval(`${inline}.tagName`)).toBe('SPAN');expect(await page.eval(`!!${inline}.closest('p')?.querySelector('div')`)).toBe(false);
    const image=`document.querySelector('#description img[alt="External portrait"]')`;
    await page.waitFor(`!!${image}`);await page.eval(`${image}.scrollIntoView({block:'center'})`);
    await page.waitFor(`${image}.naturalWidth===320`,15000);
    expect(await page.eval(`${image}.crossOrigin`)).toBe(null);expect(await page.eval(`${image}.referrerPolicy`)).toBe('no-referrer');
    expect(externalRequests.length).toBeGreaterThan(0);expect(externalRequests.every(r=>!Object.keys(r.headers).some(k=>/^(authorization|referer)$/i.test(k)))).toBe(true);expect(failures).toEqual([]);
  }finally{await fetch(`${APP}__fixture`,{method:'POST',body:'{}'});await page.close();}
});

test("the pending media renderer chunk reserves the same height as the loaded editor",async()=>{
  const page=await open();let held:string|undefined;
  const failures:string[]=[];
  try{
    await settings({});
    const {mediaChunk}=await(await fetch(`${APP}__split-media-assets/manifest.json`)).json();
    expect(mediaChunk).toBeDefined();
    page.onEvent('Fetch.requestPaused',params=>{
      if(new URL(params.request.url).pathname.endsWith('/'+mediaChunk))held=params.requestId;
      else void page.cmd('Fetch.continueRequest',{requestId:params.requestId}).catch(error=>failures.push(String(error)));
    });
    await page.cmd('Fetch.enable',{patterns:[{urlPattern:'*',resourceType:'Script',requestStage:'Request'}]});
    await page.goto('/__split-media-assets/index.html');
    await page.waitFor(`!!document.querySelector('#context-editor [data-media-loading]')`);
    // The paused-request event can arrive after the placeholder renders when the machine is busy.
    for(let i=0;i<100&&!held;i++)await Bun.sleep(20);
    expect(held).toBeDefined();
    const before=await page.eval<number>(`document.getElementById('context-editor').getBoundingClientRect().height`);
    expect(await page.eval(`!!document.querySelector('#context-editor [data-media-interactive]')`)).toBe(false);
    await page.cmd('Fetch.continueRequest',{requestId:held});held=undefined;
    await page.waitFor(`document.querySelector('#context-editor video')?.readyState>=1`,15000);
    const after=await page.eval<number>(`document.getElementById('context-editor').getBoundingClientRect().height`);
    expect(Math.abs(before-after)).toBeLessThan(2);expect(failures).toEqual([]);
  }finally{if(held)await page.cmd('Fetch.continueRequest',{requestId:held});await fetch(`${APP}__fixture`,{method:'POST',body:'{}'});await page.close();}
});

test("media node views receive attachment and issue-context updates without remounting the editor",async()=>{
  const page=await open();
  try{
    await settings({});await page.goto('/__editor-media-fixture');
    await page.waitFor(`document.querySelector('#context-editor video')?.readyState>=1`,15000);
    await page.eval(`window.originalEditor=document.getElementById('context-editor');true`);
    await page.click('text=Load local attachment');
    await page.waitFor(`document.querySelector('#context-editor img')?.naturalWidth===320`);
    await page.click('text=Switch issue context');
    await page.waitFor(`document.querySelector('#context-editor video')?.getAttribute('src')==='/api/issues/TEST-2/attachments/101'`);
    expect(await page.eval(`document.getElementById('context-editor')===window.originalEditor`)).toBe(true);
    expect(await page.eval(`document.querySelector('#context-editor img').alt`)).toBe('Updated local image');
  }finally{await fetch(`${APP}__fixture`,{method:'POST',body:'{}'});await page.close();}
});
