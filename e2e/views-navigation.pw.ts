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
    // BJ-143: Linear's saved-empty state is an illustration and "No matching issues", with no count or action.
    await page.waitFor(`document.querySelector('[role=status]')?.textContent === 'No matching issues'`);
    expect(await page.eval(`!!document.querySelector('[role=status] svg') && !document.querySelector('[role=status] button')`)).toBe(true);
    // BJ-141: a custom view shows no team tabs.
    expect(await page.eval(`[...document.querySelectorAll('header button')].some(b=>['Active','Backlog','All issues','Add new view'].includes(b.textContent.trim()))`)).toBe(false);
    await page.eval(`fetch('/api/views/${saved.id}',{method:'PUT',headers:{'Content-Type':'application/json'},body:JSON.stringify({filters:{id:'root',join:'and',children:[]}})})`);
    const filter = Buffer.from(JSON.stringify({v:1,filters:draft.filters})).toString('base64url');
    await page.page.goto(`${new URL(page.page.url()).origin}/view/${saved.id}?board=1&filter=${filter}`);
    await page.waitFor(`document.querySelector('[role=status]')?.textContent.includes('No issues matching the filters')`);
    await page.click('text=Clear Filters');
    await page.waitFor(`!new URL(location.href).searchParams.has('filter') && document.querySelectorAll('[data-key]').length===6`);
  } finally { await page.close(); }
});

test("Linear parity: hidden counts, merge conflicts, editor chrome, draft tab, palette Save to…, details tabs", async ({ open }) => {
  const page = await open();
  try {
    const p = defaultPreferences();
    const rule = (values: string[]) => ({id:"root",join:"and",children:[{id:"pr",field:"priority",op:"is",values}]});
    const draft = {board:1,kind:"custom",name:"Conflict base",description:"",icon:"filter",color:"gray",display:p.display,scope:p.scope,mine:false,filters:{id:"root",join:"and",children:[{id:"missing",field:"labels",op:"is",values:["missing-label"]}]}};
    const saved = await page.eval<any>(`fetch('/api/views',{method:'POST',headers:{'Content-Type':'application/json'},body:${JSON.stringify(JSON.stringify(draft))}}).then(r=>r.json())`);
    const origin = new URL(page.page.url()).origin;
    // Saved-empty is Linear's bare "No matching issues".
    await page.page.goto(`${origin}/view/${saved.id}?board=1`);
    await page.waitFor(`document.querySelector('[role=status]')?.textContent === 'No matching issues'`);
    // Display inside a view has no footer actions.
    await page.click('[aria-label="Display options"]');
    const display = await page.eval<string>(`document.querySelector('[aria-label="Display options"][role=dialog]').textContent`);
    expect(display).not.toContain("Reset");
    expect(display).not.toContain("Save my default");
    await page.key("Escape");
    // Details uses an Assignees / Labels switcher.
    await page.click('[aria-label="Open details"]');
    await page.click('[aria-label="View details"] [role=tab]:nth-child(2)');
    expect(await page.eval(`document.querySelector('[aria-label="View details"] [role=tab][aria-selected=true]').textContent`)).toBe("Labels");
    // BJ-145: Linear's 32px pills, sized from their labels.
    expect(await page.eval(`[...document.querySelectorAll('[aria-label="View details"] [role=tab]')].map(t=>t.getBoundingClientRect().height)`)).toEqual([32, 32]);
    // A contradicting temporary filter cannot be merged: Save menu, ⌥S and ⌘K all refuse.
    await page.eval(`fetch('/api/views/${saved.id}',{method:'PUT',headers:{'Content-Type':'application/json'},body:JSON.stringify({filters:${JSON.stringify(rule(["High"]))}})})`);
    const filter = Buffer.from(JSON.stringify({v:1,filters:rule(["Low"])})).toString("base64url");
    await page.page.goto(`${origin}/view/${saved.id}?board=1&filter=${filter}`);
    await page.waitFor(`/\\d+ issues? hidden by filters/.test(document.querySelector('[role=status]')?.textContent ?? '')`);
    // BJ-145: the temporary chip row is flat: transparent, unshadowed, 30px.
    expect(await page.eval(`(s=>[s.backgroundColor,s.boxShadow,s.height])(getComputedStyle(document.querySelector('.view-filter-row')))`)).toEqual(["rgba(0, 0, 0, 0)", "none", "30px"]);
    await page.click('.view-filter-save');
    await page.waitFor(`!!document.querySelector('[aria-label="Save filters"] [aria-disabled=true]')`);
    expect(await page.eval(`document.querySelector('[aria-label="Save filters"] [aria-disabled=true]').textContent`)).toContain("Cannot merge these filters into the view");
    await page.key("Escape");
    await page.eval(`document.body.dispatchEvent(new KeyboardEvent('keydown',{key:'ß',code:'KeyS',altKey:true,bubbles:true}))`);
    await page.page.waitForTimeout(300);
    expect(await page.eval(`!!document.querySelector('.view-filter-chip')`)).toBe(true);
    expect((await page.eval<any[]>(`fetch('/api/views').then(r=>r.json())`)).find(v => v.id === saved.id).filters.children[0].values).toEqual(["High"]);
    await page.key("k", "meta");
    await page.click('[cmdk-item][data-value="cmd:Save to…"]');
    await page.waitFor(`!!document.querySelector('[cmdk-item][data-disabled=true]')`);
    expect(await page.eval(`document.querySelector('[cmdk-item][data-disabled=true]').textContent`)).toContain("Cannot merge these filters into the view");
    await page.key("Escape");
    // Without an overlay ⌘K still lists Save to….
    await page.page.goto(`${origin}/view/${saved.id}?board=1`);
    await page.waitFor(`!!document.querySelector('[role=status]') && !document.querySelector('.view-filter-chip')`);
    await page.key("k", "meta");
    await page.waitFor(`!!document.querySelector('[cmdk-item][data-value="cmd:Save to…"]')`);
    await page.key("Escape");
    // Edit mode: base chips are the definition, not a temporary overlay.
    await page.page.goto(`${origin}/view/${saved.id}/edit`);
    await page.waitFor(`!!document.querySelector('.view-filter-chip')`);
    expect(await page.eval(`document.querySelector('.view-filter-row').getAttribute('aria-label')`)).toBe("View filters");
    expect(await page.eval(`!!document.querySelector('.view-filter-row .view-filter-actions')`)).toBe(false);
    // BJ-141: the custom-view editor shows no team tabs either.
    expect(await page.eval(`[...document.querySelectorAll('header button')].some(b=>['Active','Backlog','All issues','Add new view'].includes(b.textContent.trim()))`)).toBe(false);
    await page.click("text=Cancel");
    // New tab draft replaces Add new view with the selected draft tab.
    await page.page.goto(`${origin}/?board=1`);
    await page.click("text=Add new view");
    await page.waitFor(`[...document.querySelectorAll('header span[aria-current=page]')].some(e=>e.textContent.includes('New view'))`);
    expect(await page.eval(`[...document.querySelectorAll('header button')].some(b=>b.textContent.trim()==='Active')`)).toBe(true);
    expect(await page.eval(`[...document.querySelectorAll('button')].some(b=>b.textContent.includes('Add new view'))`)).toBe(false);
    expect(await page.eval(`document.querySelectorAll('header button[aria-pressed=true]').length`)).toBe(0);
    await page.click("text=Cancel");
    await page.eval(`fetch('/api/views/${saved.id}',{method:'DELETE'})`);
  } finally { await page.close(); }
});
