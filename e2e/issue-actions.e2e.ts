import {afterAll,expect,test} from 'bun:test';
import {open,stop} from './harness';
afterAll(stop);
test('issue options follow Linear\'s action tree, with descendant search and submenus that act on the issue',async()=>{
 const page=await open('?issue=TEST-2&view=page');try{
  await page.waitFor(`!!document.getElementById('comment')`);await page.click('#issue-options');await page.waitFor(`document.activeElement?.getAttribute('aria-label')==='Find issue options'`);
  expect(await page.eval(`[...document.querySelectorAll('[role="dialog"][aria-label="Issue options"] [cmdk-item]')].map(n=>n.getAttribute('data-value'))`)).toEqual(['Due date','Add link…','Add pull request…','Add document…','Create related','Mark as','Copy','Make a copy…','Favorite','Remind me','Show description history','Restore mirrored Jira version','Delete']);
  // Linear's Create related (square with +) and Copy (clipboard) glyphs.
  expect(await page.eval(`['Create related','Copy'].map(v=>document.querySelector('[role="dialog"][aria-label="Issue options"] [cmdk-item][data-value="'+v+'"] svg path').getAttribute('d').slice(0,12))`)).toEqual(['M8 13.5H4.5a','M5.5 3h-1A1.']);
  // Linear's look: filter focused but hidden until typing, grouped with separators, an icon per item, shortcut hints on submenus, content-fitted width.
  const look=`(()=>{const m=document.querySelector('[role="dialog"][aria-label="Issue options"]'),input=m.querySelector('input'),items=[...m.querySelectorAll('[cmdk-item]')];return {input:input.getBoundingClientRect().width>1,separators:m.querySelectorAll('[cmdk-separator]').length,icons:items.filter(n=>n.querySelector('svg:not(:last-child)')||n.firstElementChild?.querySelector('svg')).length,items:items.length,due:items[0].textContent,width:Math.round(m.getBoundingClientRect().width)}})()`;
  const before=await page.eval<{input:boolean;separators:number;icons:number;items:number;due:string;width:number}>(look);
  expect(before).toMatchObject({input:false,separators:4,icons:before.items});expect(before.due.replace(/\s/g,'')).toBe('Duedate⇧D');expect(before.width).toBeGreaterThanOrEqual(200);expect(before.width).toBeLessThan(280);
  await page.type('blocked');await page.waitFor(`!!document.querySelector('[cmdk-item][data-value="Create related › Blocked issue…"]')`);expect(await page.eval(`[...document.querySelectorAll('[role="dialog"][aria-label="Issue options"] [cmdk-item]')].map(n=>n.getAttribute('data-value'))`)).toEqual(['Create related › Blocked issue…','Mark as › Blocked by…']);expect(await page.eval<{input:boolean;separators:number}>(look)).toMatchObject({input:true,separators:0});await page.key('Escape');
  // Due date › Tomorrow sets tomorrow's local date.
  const tomorrow=await page.eval<string>(`(()=>{const d=new Date();d.setDate(d.getDate()+1);return d.toLocaleDateString('en-CA')})()`);
  await page.click('#issue-options');await page.hover('[cmdk-item][data-value="Due date"]');await page.click('[cmdk-item][data-value="Tomorrow"]');await page.waitFor(`document.getElementById('prop-due')?.textContent.includes('${tomorrow}')`);
  // Favorite toggles the issue favorite and closes.
  await page.click('#issue-options');await page.click('[cmdk-item][data-value="Favorite"]');await page.waitFor(`document.querySelector('[aria-label="Remove issue from favorites"]')?.getAttribute('aria-checked')==='true'`);expect(await page.eval(`!!document.querySelector('[role="dialog"][aria-label="Issue options"]')`)).toBe(false);
  // Copy ›: every row has an icon, and title as link shows ⌘C, as in Linear's issue menu.
  await page.click('#issue-options');await page.hover('[cmdk-item][data-value="Copy"]');await page.waitFor(`!!document.querySelector('[role="dialog"][aria-label="Copy"] [cmdk-item]')`);
  expect(await page.eval(`(()=>{const m=document.querySelector('[role="dialog"][aria-label="Copy"]');return [[...m.querySelectorAll('[cmdk-item]')].every(n=>n.querySelector('svg')),m.querySelector('[cmdk-item][data-value="Copy title as link"]').textContent]})()`)).toEqual([true,'Copy title as link⌘ C']);await page.key('Escape');await page.waitFor(`!document.querySelector('[role="dialog"][aria-label="Copy"]')`);if(await page.eval(`!!document.querySelector('[role="dialog"][aria-label="Issue options"]')`))await page.key('Escape');await page.waitFor(`!document.querySelector('[role="dialog"][aria-label="Issue options"]')&&!!document.getElementById('issue-options')`);
  // Mark as › Parent of… makes the chosen issue a sub-issue of this one.
  await page.click('#issue-options');await page.hover('[cmdk-item][data-value="Mark as"]');await page.click('[cmdk-item][data-value="Parent of…"]');await page.waitFor(`document.querySelector('[role="dialog"][aria-label="Issue relations"] [data-kind]')?.dataset.kind==='child'`);await page.click('[aria-label="Find related issue"]');await page.type('TEST-3');await page.click('[role="dialog"][aria-label="Issue relations"] [cmdk-item][data-value="TEST-3"]');await page.waitFor(`!!document.querySelector('[data-sub-issue="TEST-3"]')`);
  // Create related › Blocked issue… creates a new issue blocked by this one, undone in one step.
  await page.click('#issue-options');await page.hover('[cmdk-item][data-value="Create related"]');await page.click('[cmdk-item][data-value="Blocked issue…"]');await page.waitFor(`document.activeElement?.getAttribute('aria-label')==='Issue title'`);await page.type('Blocked follow-up');await page.key('Enter','meta');
  await page.waitFor(`!!document.querySelector('[data-relation="blocked:TEST-2"]')`);const created=await page.eval<string>(`new URL(location.href).searchParams.get('issue')`);expect(created).not.toBe('TEST-2');expect(await page.eval(`document.getElementById('summary')?.value??document.getElementById('summary')?.textContent`)).toContain('Blocked follow-up');
  await page.goto('?issue=TEST-2&view=page');await page.waitFor(`!!document.querySelector('[data-relation="blocking:${created}"]')`);await page.eval('document.activeElement?.blur()');await page.key('z','meta');await page.waitFor(`!document.querySelector('[data-relation^="blocking:"]')`);
 }finally{await page.close();}
});
test('property edits appear in Activity grouped like Linear: merged, removed on round trip, ordered, undoable and durable',async()=>{
 const page=await open('?issue=TEST-2&view=page');try{
  const rows=`[...document.querySelectorAll('[data-activity]')].map(n=>n.textContent.replace(/\\s+/g,' ').trim())`;
  const pick=async(key:string,value:string)=>{await page.eval('document.activeElement?.blur()');await page.key(key);await page.waitFor(`!!document.querySelector('[cmdk-item][data-value="${value}"]')`);await page.click(`[cmdk-item][data-value="${value}"]`);await page.waitFor(`!document.querySelector('[cmdk-item][data-value="${value}"]')`);};
  await page.waitFor(`!!document.getElementById('comment')`);const original='Low',other='Urgent';// fixture TEST-2 priority
  await pick('p',other);await page.waitFor(`${rows}.length===1`);expect((await page.eval<string[]>(rows))[0]).toMatch(new RegExp(`Audit user set priority to ${other} · just now$`));
  await pick('p','High');await page.waitFor(`${rows}.join().includes('set priority to High')`);expect(await page.eval(`${rows}.length`)).toBe(1);
  await pick('s','Doing');await page.waitFor(`${rows}.length===2`);expect((await page.eval<string[]>(rows))[0]).toContain('moved from Todo to Doing');expect((await page.eval<string[]>(rows))[1]).toContain('set priority to High');
  await pick('p',original);await page.waitFor(`${rows}.length===1`);
  await page.eval('document.activeElement?.blur()');await page.key('z','meta');await page.waitFor(`${rows}.length===2`);
  await page.waitFor(`document.querySelector('[aria-label="Local save status"]').textContent.includes('Saved')`);await page.reload();await page.waitFor(`${rows}.length===2`);expect(await page.eval(`!!document.querySelector('[data-activity="status"] a[href*="#activity-"]')`)).toBe(true);
  expect(await page.eval(`(()=>{const row=document.querySelector('[data-activity="status"]'),name=row.querySelector('.font-medium');return [getComputedStyle(name).color===getComputedStyle(row).color,getComputedStyle(name).fontWeight]})()`)).toEqual([true,'500']);
 }finally{await page.close();}
});
test('related issue search is keyboard-driven: focused on open, ArrowDown and Enter pick the issue',async()=>{
 const page=await open('?issue=TEST-2&view=page');try{
  await page.waitFor(`!!document.getElementById('comment')`);await page.click('#issue-options');await page.type('related to');await page.waitFor(`!!document.querySelector('[cmdk-item][data-value="Mark as › Related to…"]')`);await page.key('Enter');
  await page.waitFor(`document.activeElement?.getAttribute('aria-label')==='Find related issue'`);await page.type('TEST');await page.waitFor(`document.querySelectorAll('[role="dialog"][aria-label="Issue relations"] [cmdk-item]').length>1`);
  const second=await page.eval<string>(`document.querySelectorAll('[role="dialog"][aria-label="Issue relations"] [cmdk-item]')[1].getAttribute('data-value')`);
  await page.key('ArrowDown');await page.key('Enter');await page.waitFor(`!!document.querySelector('[data-relation="related:${second}"]')`);expect(await page.eval(`!!document.querySelector('[role="dialog"][aria-label="Issue relations"]')`)).toBe(false);
  // Focus returns to Issue options (the menu item that opened the picker is gone), after a pick and after Escape.
  await page.waitFor(`document.activeElement?.id==='issue-options'`);
  await page.key('Enter');await page.type('related to');await page.waitFor(`!!document.querySelector('[cmdk-item][data-value="Mark as › Related to…"]')`);await page.key('Enter');await page.waitFor(`document.activeElement?.getAttribute('aria-label')==='Find related issue'`);
  await page.key('Escape');await page.waitFor(`!document.querySelector('[role="dialog"][aria-label="Issue relations"]')`);await page.waitFor(`document.activeElement?.id==='issue-options'`);
 }finally{await page.close();}
});
test('restoring a description from history keeps the version it replaces',async()=>{
 const page=await open('?issue=TEST-2&view=page');try{
  await page.waitFor(`!!document.getElementById('comment')`);await page.click('#description');await page.waitFor(`!!document.querySelector('[aria-label="Issue description"][contenteditable]')`);await page.key('a','meta');await page.cmd('Input.insertText',{text:'Newest description at risk'});await page.click('#summary');
  await page.click('#issue-options');await page.click('[cmdk-item][data-value="Show description history"]');await page.click('text=Restore this description');await page.waitFor(`!document.getElementById('description')?.textContent.includes('Newest description at risk')`);
  await page.click('#issue-options');await page.click('[cmdk-item][data-value="Show description history"]');expect(await page.eval(`document.querySelector('[aria-label="Description history"]').textContent`)).toContain('Newest description at risk');
 }finally{await page.close();}
});
