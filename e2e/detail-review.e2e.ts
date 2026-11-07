import {afterAll,expect,test} from 'bun:test';
import {open,stop} from './harness';
afterAll(stop);
test('measured grid columns interpolate and properties remain fixed while scrolling',async()=>{
 const page=await open('?issue=TEST-2&view=page',{width:1864,height:900});try{
  await page.waitFor(`!!document.getElementById('comment')`);await page.eval('document.fonts.ready');
  const geometry=()=>page.eval<number[]>(`getComputedStyle(document.querySelector('.issue-detail-grid')).gridTemplateColumns.split(' ').map(parseFloat)`);
  let cols=await geometry();for(const [i,value] of [117.25,807.5,400,117.25].entries())expect(Math.abs(cols[i]!-value)).toBeLessThan(3);
  expect(await page.eval(`getComputedStyle(document.querySelector('.issue-detail-grid')).columnGap`)).toBe('56px');
  await page.cmd('Emulation.setDeviceMetricsOverride',{width:1400,height:900,deviceScaleFactor:1,mobile:false});cols=await geometry();
  for(const [i,value] of [0,647.9,365,0].entries())expect(Math.abs(cols[i]!-value)).toBeLessThan(3);
  expect(Math.abs(await page.eval<number>(`parseFloat(getComputedStyle(document.querySelector('.issue-detail-grid')).columnGap)`)-44.35)).toBeLessThan(.2);
  await page.eval(`document.querySelector('.issue-detail-content').insertAdjacentHTML('beforeend','<div style="height:1500px">Scroll fixture</div>');document.querySelector('.issue-detail-body').scrollTop=2000`);
  await page.waitFor(`document.querySelector('.issue-detail-body').scrollTop>500`);
  // RAJ-52 scrolled 800px: the Properties heading stays 74.75px under the scroller's top, where it started (127.75 with the scroller at 53).
  expect(Math.abs(await page.eval<number>(`document.querySelector('.issue-detail-properties h3').getBoundingClientRect().top-document.querySelector('.issue-detail-body').getBoundingClientRect().top`)-74.75)).toBeLessThan(.3);
 }finally{await page.close();}
});
test('pills follow Linear order, omit unset dates and milestones, and switch below an 820px container',async()=>{
 const page=await open('?issue=TEST-2&view=page',{width:1074,height:900});try{
  await page.waitFor(`!!document.getElementById('comment')`);
  expect(await page.eval(`getComputedStyle(document.querySelector('[data-properties]')).display`)).toBe('block');
  await page.cmd('Emulation.setDeviceMetricsOverride',{width:1073,height:900,deviceScaleFactor:1,mobile:false});
  await page.waitFor(`getComputedStyle(document.querySelector('[data-properties]')).display==='flex'`);
  expect(await page.eval(`document.getElementById('summary').getBoundingClientRect().left-document.querySelector('.issue-detail-body').getBoundingClientRect().left`)).toBe(14);
  expect(await page.eval(`document.getElementById('prop-status').getBoundingClientRect().left-document.getElementById('summary').getBoundingClientRect().left`)).toBe(6);
  expect(await page.eval(`document.getElementById('prop-due')`)).toBeNull();expect(await page.eval(`document.getElementById('prop-milestone')`)).toBeNull();
  expect(await page.eval(`[...document.querySelectorAll('[data-properties] button[id]')].sort((a,b)=>a.getBoundingClientRect().y-b.getBoundingClientRect().y||a.getBoundingClientRect().x-b.getBoundingClientRect().x).map(b=>b.id)`)).toEqual(['prop-status','prop-priority','prop-assignee','prop-project','prop-labels']);
  await page.click('#prop-project');await page.click('text=No project');
  expect(await page.eval(`document.getElementById('prop-project').innerText`)).toBe('Project');
 }finally{await page.close();}
});
test('whitespace comments stay disabled and subscriber choices expose checked state',async()=>{
 const page=await open('?issue=TEST-2&view=page');try{
  await page.waitFor(`!!document.getElementById('comment')`);await page.click('#comment');await page.key('Enter');await page.key('Enter');await page.type(' ');
  expect(await page.eval(`document.querySelector('.rich-editor:has(#comment) .rich-editor-submit').disabled`)).toBe(true);
  await page.key('Escape');await page.click('[aria-label="Change subscribers"]');await page.type('Audit Me');
  expect(await page.eval(`document.querySelector('[cmdk-item][data-selected=true]').getAttribute('aria-checked')`)).toBe('false');
  await page.key('Enter');expect(await page.eval(`document.querySelector('[cmdk-item][data-selected=true]').getAttribute('aria-checked')`)).toBe('true');
 }finally{await page.close();}
});
test('timestamps name precise times, deep-link to comments, and clear on issue navigation',async()=>{
 const page=await open('?issue=TEST-2&view=page');try{
  await page.waitFor(`!!document.getElementById('comment')`);await page.click('#comment');await page.cmd('Input.insertText',{text:'Earlier comment\n'.repeat(90)});await page.key('Enter','meta');await page.waitFor(`document.getElementById('comment')?.textContent===''`);await page.click('#comment');await page.cmd('Input.insertText',{text:'Timestamp regression comment'});await page.key('Enter','meta');
  const selector='[data-thread]:last-child [data-comment^="local-"] a:has(time)';await page.waitFor(`!!document.querySelector(${JSON.stringify(selector)})`);
  const href=await page.eval<string>(`document.querySelector(${JSON.stringify(selector)}).href`);
  expect(new URL(href).hash).toMatch(/^#comment-local-/);
  expect(await page.eval(`document.querySelector(${JSON.stringify(selector)}).getAttribute('aria-label')`)).toContain(':');
  await page.waitFor(`document.querySelector('[aria-label="Local save status"]')?.textContent.includes('Saved')`);
  // Linear: hovering the time shows "Sat Nov 7, 2026, 07:49:03" centred 8px above it.
  expect(await page.eval(`document.querySelector(${JSON.stringify(selector)}).getAttribute('aria-label')`)).toMatch(/^[A-Z][a-z]{2} [A-Z][a-z]{2} \d{1,2}, \d{4}, \d{2}:\d{2}:\d{2}$/);
  // Settle the scroll first: a scroll hides the tooltip, as in Linear.
  await page.eval(`document.querySelector(${JSON.stringify(selector)}).scrollIntoView({block:'center'})`);await Bun.sleep(200);await page.hover(selector);await page.waitFor(`!!document.querySelector('.app-tooltip')`,2000);
  expect(await page.eval(`(()=>{const t=document.querySelector('.app-tooltip').getBoundingClientRect(),a=document.querySelector(${JSON.stringify(selector)}).getBoundingClientRect();return [Math.round(a.top-t.bottom),Math.round(Math.abs(t.x+t.width/2-a.x-a.width/2)),document.querySelector('.app-tooltip').textContent===document.querySelector(${JSON.stringify(selector)}).getAttribute('aria-label')]})()`)).toEqual([8,0,true]);
  await page.click(selector);expect(await page.eval('location.hash')).toBe(new URL(href).hash);
  await page.click('[title="Next (J / ↓)"]');expect(await page.eval('location.hash')).toBe('');
  await page.cmd('Page.navigate',{url:href});await page.waitFor(`!!document.querySelector('[data-comment]')`);expect(await page.eval('location.hash')).toBe(new URL(href).hash);expect(await page.eval(`[...document.querySelectorAll('[data-comment]')].map(e=>e.id)`)).toContain(new URL(href).hash.slice(1));
  expect(await page.eval(`(()=>{const r=document.getElementById(decodeURIComponent(location.hash.slice(1))).getBoundingClientRect();return r.bottom>0&&r.top<innerHeight})()`)).toBe(true);
 }finally{await page.close();}
});
test('comment cards and composer have the measured 8px outsets and subscription text is 12px',async()=>{
 const page=await open('?issue=TEST-2&view=page');try{
  await page.waitFor(`!!document.getElementById('comment')`);await page.click('#comment');await page.type('Measure card edges');await page.key('Enter','meta');await page.waitFor(`!!document.querySelector('[data-thread]')`);
  const geometry=await page.eval<{card:number;composer:number;font:string}>(`(()=>{const text=document.getElementById('description').getBoundingClientRect().left;return {card:text-document.querySelector('[data-thread]').getBoundingClientRect().left,composer:text-document.querySelector('.issue-activity > div:last-child').getBoundingClientRect().left,font:getComputedStyle(document.getElementById('issue-subscribers').previousElementSibling).fontSize}})()`);
  expect(geometry.card).toBeCloseTo(8,1);expect(geometry.composer).toBeCloseTo(8,1);expect(geometry.font).toBe('12px');
 }finally{await page.close();}
});
