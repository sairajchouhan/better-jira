import { expect, test } from "./app";
import { defaultPreferences } from "../src/view-model";

test("custom identity, directory, favorite, details, palette and tab identity", async ({ open }) => {
  const page = await open();
  try {
    const p = defaultPreferences();
    const definitions = ["custom", "tab"].map(kind => ({board:1,kind,name:kind === "custom" ? "Directory custom" : "Named tab",description:"Personal triage",icon:"filter",color:"gray",filters:p.filters,display:p.display,scope:p.scope,mine:false}));
    await page.eval(`Promise.all(${JSON.stringify(definitions)}.map(body => fetch('/api/views', {method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)})))`);
    await page.reload();
    await page.click('text=Views');
    await page.waitFor(`location.pathname === '/views'`);
    expect(await page.eval(`document.querySelector('[role=table]').textContent.includes('Named tab')`)).toBe(false);
    await page.click('text=Directory customPersonal triage');
    await page.waitFor(`location.pathname.startsWith('/view/')`);
    expect(await page.eval(`document.querySelector('[aria-label=Breadcrumb]').textContent.includes('Directory custom')`)).toBe(true);
    await page.click('[aria-label="Add to favorites"]');
    await page.waitFor(`!!document.querySelector('nav[aria-label="Main navigation"] [aria-current="page"]')`);
    expect(await page.eval(`document.querySelectorAll('nav[aria-label="Main navigation"] [aria-current]').length`)).toBe(1);
    await page.click('[aria-label="Open details"]');
    await page.waitFor(`document.querySelector('[aria-label="View details"]').textContent.includes('Personal triage')`);
    await page.key('k','meta');
    await page.waitFor(`document.body.textContent.includes('View · Directory custom')`);
    await page.key('Escape');
    await page.click('[aria-label=Breadcrumb] button[aria-label="Browser audit"]');
    await page.click('text=Named tab');
    expect(await page.eval(`document.querySelector('[aria-label=Breadcrumb]').textContent.includes('Directory custom')`)).toBe(false);
    expect(await page.eval(`document.querySelector('button[aria-pressed=true]').textContent`)).toBe('Named tab');
    await page.reload();
    expect(await page.eval(`document.querySelector('button[aria-pressed=true]').textContent`)).toBe('Named tab');
    await page.eval(`fetch('/api/views').then(r=>r.json()).then(views=>fetch('/api/views/'+views.find(v=>v.name==='Directory custom').id,{method:'DELETE'}))`);
    await page.reload();
    expect(await page.eval(`document.querySelector('nav[aria-label="Main navigation"]').textContent.includes('Directory custom')`)).toBe(false);
  } finally { await page.close(); }
});

test("empty directory and saved versus temporary empty results", async ({ open }) => {
  const page = await open();
  try {
    await page.click('text=Views');
    await page.waitFor(`document.body.textContent.includes('Create custom views using filters')`);
    expect(await page.eval(`!![...document.querySelectorAll('button')].find(b=>b.textContent==='Create new view')`)).toBe(true);
    const p = defaultPreferences();
    const draft = {board:1,kind:"custom",name:"Empty base",description:"",icon:"filter",color:"gray",display:p.display,scope:p.scope,mine:false,filters:{id:"root",join:"and",children:[{id:"missing",field:"labels",op:"is",values:["missing-label"]}]}};
    const saved = await page.eval(`fetch('/api/views',{method:'POST',headers:{'Content-Type':'application/json'},body:${JSON.stringify(JSON.stringify(draft))}}).then(r=>r.json())`);
    await page.page.goto(`${new URL(page.page.url()).origin}/view/${saved.id}?board=1`);
    await page.waitFor(`document.querySelector('[role=status]')?.textContent.includes('No issues matching your filters')`);
    expect(await page.eval(`!![...document.querySelectorAll('button')].find(b=>b.textContent==='Edit your filters')`)).toBe(true);
    await page.eval(`fetch('/api/views/${saved.id}',{method:'PUT',headers:{'Content-Type':'application/json'},body:JSON.stringify({filters:{id:'root',join:'and',children:[]}})})`);
    const filter = Buffer.from(JSON.stringify({v:1,filters:draft.filters})).toString('base64url');
    await page.page.goto(`${new URL(page.page.url()).origin}/view/${saved.id}?board=1&filter=${filter}`);
    await page.waitFor(`document.querySelector('[role=status]')?.textContent.includes('No issues matching the filters')`);
    await page.click('text=Clear filters');
    await page.waitFor(`!new URL(location.href).searchParams.has('filter') && document.querySelectorAll('[data-key]').length===6`);
  } finally { await page.close(); }
});
