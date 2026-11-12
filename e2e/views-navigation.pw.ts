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
    // Only the active view is marked: its Views-section row and its Favorites row, never another view or the board.
    expect(await page.eval(`[...document.querySelectorAll('nav[aria-label="Main navigation"] [aria-current]')].map(e => e.textContent).join('|')`)).toBe('Directory custom|Directory custom');
    await page.click('button[aria-label="Board details"]');
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
    // BJ-150: temporary empty filters have the illustration as well as the recovery action.
    expect(await page.eval(`!!document.querySelector('[role=status] svg[width="140"]')`)).toBe(true);
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
    // BJ-147: no summaries for an empty result, but both cards and their actions remain.
    await page.click('button[aria-label="Board details"]');
    expect(await page.eval(`document.querySelectorAll('[aria-label="View details"] [role=tab]').length`)).toBe(0);
    expect(await page.eval(`document.querySelectorAll('[data-view-card]').length`)).toBe(2);
    expect(await page.eval(`!!document.querySelector('[aria-label="View details options"]') && !!document.querySelector('[aria-label="Add view to favorites"]')`)).toBe(true);
    // Keep the measured summary assertions on a nonempty view.
    await page.eval(`fetch('/api/views/${saved.id}',{method:'PUT',headers:{'Content-Type':'application/json'},body:JSON.stringify({filters:{id:'root',join:'and',children:[]}})})`);
    await page.reload();
    // Details uses an Assignees / Labels switcher.
    await page.click('[aria-label="View details"] [role=tab]:nth-child(2)');
    expect(await page.eval(`document.querySelector('[aria-label="View details"] [role=tab][aria-selected=true]').textContent`)).toBe("Labels");
    // BJ-145: Linear's 32px pills, sized from their labels.
    expect(await page.eval(`[...document.querySelectorAll('[aria-label="View details"] [role=tab]')].map(t=>t.getBoundingClientRect().height)`)).toEqual([32, 32]);
    // SOLF-03: summary tabs use one roving tab stop and the shared keyboard model.
    const selectedSummary = `document.querySelector('[aria-label="View details"] [role=tab][aria-selected=true]')`;
    for (const [key, label] of [["ArrowRight", "Assignees"], ["End", "Labels"], ["Home", "Assignees"], ["ArrowLeft", "Labels"]]) {
      await page.key(key!);
      expect(await page.eval(`${selectedSummary}.textContent`)).toBe(label);
      expect(await page.eval(`document.activeElement === ${selectedSummary}`)).toBe(true);
      expect(await page.eval(`document.querySelectorAll('[aria-label="View details"] [role=tab][tabindex="0"]').length`)).toBe(1);
      expect(await page.eval(`document.querySelector('[aria-label="View details"] [role=tabpanel]').getAttribute('aria-labelledby') === ${selectedSummary}.id`)).toBe(true);
    }
    // A contradicting temporary filter cannot be merged: Save menu, ⌥S and ⌘K all refuse.
    await page.eval(`fetch('/api/views/${saved.id}',{method:'PUT',headers:{'Content-Type':'application/json'},body:JSON.stringify({filters:${JSON.stringify(rule(["High"]))}})})`);
    const filter = Buffer.from(JSON.stringify({v:1,filters:rule(["Low"])})).toString("base64url");
    await page.page.goto(`${origin}/view/${saved.id}?board=1&filter=${filter}`);
    await page.waitFor(`/\\d+ issues? hidden by filters/.test(document.querySelector('[role=status]')?.textContent ?? '')`);
    // BJ-146: the chip row is Linear's filter card: 10px padding, 8px radius, bgSecondary-ish card fill, 24px chips.
    expect(await page.eval(`(s=>[s.padding,s.borderRadius,s.boxShadow])(getComputedStyle(document.querySelector('.view-filter-row')))`)).toEqual(["10px", "8px", "none"]);
    expect(await page.eval(`getComputedStyle(document.querySelector('.view-filter-chip')).height`)).toBe("24px");
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

test("a view route paints as the view on reload and keeps how it opens issues", async ({ open }) => {
  // The first pressed tab painted after load: the plain board would press its scope tab before the view arrived.
  const setup = `addEventListener('DOMContentLoaded', () => { const o = new MutationObserver(() => { const b = document.querySelector('button[aria-pressed=true]'); if (!b) return; window.__first = b.textContent; o.disconnect(); }); o.observe(document.documentElement, { childList: true, subtree: true, attributes: true }); });`;
  const page = await open("", { setup });
  try {
    const p = defaultPreferences();
    const body = { board: 1, kind: "tab", name: "Page tab", description: "", icon: "filter", color: "gray", filters: p.filters, display: { ...p.display, openIn: "page" }, scope: p.scope, mine: false };
    await page.eval(`fetch('/api/views', {method:'POST',headers:{'Content-Type':'application/json'},body:${JSON.stringify(JSON.stringify(body))}})`);
    await page.reload();
    await page.click('text=Page tab');
    await page.waitFor(`location.pathname.startsWith('/view/')`);
    await page.reload();
    await page.waitFor(`window.__first !== undefined`);
    expect(await page.eval(`window.__first`)).toBe("Page tab");
    await page.eval(`new Promise(r => setTimeout(r, 300))`);
    expect(await page.eval(`fetch('/api/views').then(r => r.json()).then(v => v.find(x => x.name === 'Page tab').display.openIn)`)).toBe("page");
  } finally { await page.close(); }
});

// BJ-148: editing an existing view preserves its identity and right sidebar.
test("editing keeps the view breadcrumb and details open", async ({ open }) => {
  const page = await open();
  try {
    await page.key("v", "alt");
    await page.waitFor(`!!document.querySelector('[aria-label="View name"]')`);
    await page.page.fill('[aria-label="View name"]', 'Editable view');
    await page.click('text=Create view');
    await page.waitFor(`location.pathname.startsWith('/view/') && !location.pathname.endsWith('/edit')`);
    await page.waitFor(`!!document.querySelector('[aria-label="View details"]')`);
    await page.click('[aria-label="Issue view options"]');
    await page.click('text=Edit…');
    await page.waitFor(`location.pathname.endsWith('/edit')`);
    expect(await page.eval(`document.querySelector('[aria-label="Breadcrumb"]').textContent.includes('Editable view')`)).toBe(true);
    expect(await page.eval(`!!document.querySelector('[aria-label="View details"]')`)).toBe(true);
  } finally { await page.close(); }
});

test("BJ-149: reopening Add filter creates a separate AND condition", async ({ open }) => {
  const page = await open();
  try {
    for (const priority of ["High", "Low"]) {
      await page.key("f");
      await page.click('text=Priority');
      await page.click('text=' + priority);
      await page.key("Escape");
    }
    expect(await page.eval(`document.querySelectorAll('.view-filter-chip').length`)).toBe(2);
    expect(await page.eval(`[...document.querySelectorAll('.view-filter-chip')].map(c=>c.textContent).join('|')`)).toContain("High");
    expect(await page.eval(`document.querySelectorAll('[data-key]').length`)).toBe(0);
  } finally { await page.close(); }
});

test("BJ-61: hidden display feedback opens options and reveals completed issues", async ({ open }) => {
  const page = await open();
  try {
    await page.click('[aria-label="Display options"]');
    await page.click('[aria-label="Completed issues: All"]');
    await page.click('[cmdk-item][data-value="None none"]');
    await page.key('Escape');
    await page.waitFor(`document.body.textContent.includes('hidden by display options')`);
    await page.click('text=Show options');
    await page.click('[aria-label="Completed issues: None"]');
    await page.click('[cmdk-item][data-value="All all"]');
    await page.key('Escape');
    await page.waitFor(`!document.body.textContent.includes('hidden by display options')`);
  } finally { await page.close(); }
});
