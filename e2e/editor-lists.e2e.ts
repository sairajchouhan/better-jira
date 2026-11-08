import {afterAll,expect,test} from 'bun:test';
import {open,stop} from './harness';
afterAll(stop);

// QA 2026-11-08: Numbered list did nothing on a bulleted list, and Code block on a list item threw TransformError.
test('a bulleted list switches to numbered, and a list item becomes a code block',async()=>{
  const page=await open('?issue=TEST-2&view=page');
  try{
    await page.waitFor(`!!document.querySelector('#description p')`);
    await page.click('#description p');await page.key('End');await page.key('Enter');await page.type('- QA item');
    await page.waitFor(`!!document.querySelector('#description ul li')`);
    await page.key('a','meta');await page.click('[aria-label="Numbered list"]');
    expect(await page.waitFor<string>(`document.querySelector('#description ol li')?.textContent`)).toContain('QA item');
    expect(await page.eval(`!!document.querySelector('#description ul')`)).toBe(false);
    await page.key('a','meta');await page.click('[aria-label="Code block"]');
    expect(await page.waitFor<string>(`[...document.querySelectorAll('#description pre')].map(n=>n.textContent).join('|')`)).toContain('QA item');
    expect(await page.eval(`!!document.querySelector('#description li')`)).toBe(false);
  }finally{await page.close();}
});

// QA pass 3 #3: Heading 1 on quoted text nested the heading in the quote, which Jira rejects.
test('quoted text becomes a heading outside the quote',async()=>{
  const page=await open('?issue=TEST-2&view=page');
  try{
    await page.waitFor(`!!document.querySelector('#description p')`);
    await page.click('#description p');await page.key('End');await page.key('Enter');await page.type('> QA quote');
    await page.waitFor(`!!document.querySelector('#description blockquote p')`);
    await page.key('a','meta');await page.click('[aria-label="Heading 1"]');
    expect(await page.waitFor<string>(`[...document.querySelectorAll('#description h1')].map(n=>n.textContent).join('|')`)).toContain('QA quote');
    expect(await page.eval(`!!document.querySelector('#description blockquote')`)).toBe(false);
  }finally{await page.close();}
});
