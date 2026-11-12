import { expect, test } from "./app";
import { defaultPreferences } from "../src/shared/view-model";

const FAVORITES = "better-jira:favorites:v1:https://example.atlassian.net/audit-me";
const order = `[...document.querySelectorAll('[data-favorite]')].map(n=>n.dataset.favorite)`;

test("BJ-75: favorites reorder by drag and leave from their context menu", async ({ open }) => {
  const p = await open("", {
    setup: `localStorage.getItem(${JSON.stringify(FAVORITES)})??localStorage.setItem(${JSON.stringify(FAVORITES)},'["TEST-1","TEST-2","board:1"]')`,
  });
  await p.waitFor(`${order}.length===3`);
  const target = await p.rect('[data-favorite="board:1"]');
  await p.drag('[data-favorite="TEST-1"]', target.x + 20, target.y + target.height / 2);
  await p.waitFor(`${order}.join()==="TEST-2,board:1,TEST-1"`);
  await p.eval(
    `(()=>{const n=document.querySelector('[data-favorite="TEST-2"]'),r=n.getBoundingClientRect();n.dispatchEvent(new MouseEvent('contextmenu',{bubbles:true,clientX:r.x+20,clientY:r.y+10}))})()`,
  );
  await p.click('[role="dialog"][aria-label="Favorite options"] [cmdk-item][data-value="Remove from favorites"]');
  await p.waitFor(`${order}.join()==="board:1,TEST-1"`);
  await p.reload();
  expect(await p.waitFor(`${order}.length===2&&${order}`)).toEqual(["board:1", "TEST-1"]);
});

test("BJ-76: sidebar sections collapse and stay so; Customize sidebar hides My issues", async ({ open }) => {
  const p = await open();
  const row = (name: string) =>
    `[...document.querySelectorAll('nav[aria-label="Main navigation"] a')].some(b=>b.textContent.includes('${name}'))`;
  await p.waitFor(row("Browser audit"));
  await p.click('[aria-label="Collapse boards section"]');
  await p.waitFor(`!${row("Browser audit")}`);
  await p.reload();
  await p.waitFor(`!!document.querySelector('[aria-label="Expand boards section"]')`);
  expect(await p.eval(row("Browser audit"))).toBe(false);
  await p.click('[aria-label="Expand boards section"]');
  await p.waitFor(row("Browser audit"));

  await p.key("k", "meta");
  await p.type("Customize sidebar");
  await p.waitFor(
    `document.querySelector('[cmdk-item][data-selected=true]')?.textContent?.includes('Customize sidebar')`,
  );
  await p.key("Enter");
  await p.click('[role="dialog"][aria-label="Customize sidebar"] [aria-label="My issues: Always show"]');
  await p.click("text=Don't show");
  await p.waitFor(`!${row("My issues")}`);
  await p.key("Escape");
  await p.reload();
  expect(await p.eval(row("My issues"))).toBe(false);
});

test("BJ-76: rows set to Don't show stay reachable from More; the Views section collapses", async ({ open }) => {
  const p = await open();
  const nav = `document.querySelector('nav[aria-label="Main navigation"]')`;
  await p.eval(
    `fetch('/api/views',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({board:1,kind:'custom',name:'Sidebar view',description:'',icon:'filter',color:'gray',filters:{id:'root',join:'and',children:[]},display:${JSON.stringify(defaultPreferences().display)},scope:'all',mine:false})})`,
  );
  try {
    await p.reload();
    await p.waitFor(`${nav}.textContent.includes('Sidebar view')`);
    await p.click('[aria-label="Collapse views section"]');
    await p.waitFor(`!${nav}.textContent.includes('Sidebar view')`);
    await p.reload();
    await p.waitFor(`!!document.querySelector('[aria-label="Expand views section"]')`);
    expect(await p.eval(`${nav}.textContent.includes('Sidebar view')`)).toBe(false);

    expect(await p.eval(`[...${nav}.querySelectorAll('button')].some(b=>b.textContent.trim()==='More')`)).toBe(false);
    await p.key("k", "meta");
    await p.type("Customize sidebar");
    await p.waitFor(`document.querySelector('[cmdk-item][data-selected=true]')?.textContent?.includes('Customize sidebar')`);
    await p.key("Enter");
    await p.click('[role="dialog"][aria-label="Customize sidebar"] [aria-label="My issues: Always show"]');
    await p.click("text=Don't show");
    await p.key("Escape");
    await p.waitFor(`!document.querySelector('[role="dialog"][aria-label="Customize sidebar"]')`);
    await p.eval(`[...${nav}.querySelectorAll('button')].find(b=>b.textContent.trim()==='More').click()`);
    await p.waitFor(`!!document.querySelector('[role="dialog"][aria-label="More"] [cmdk-item][data-value="My issues"]')`);
    await p.click('[role="dialog"][aria-label="More"] [cmdk-item][data-value="My issues"]');
    await p.waitFor(`location.pathname.startsWith('/my-issues')`);
  } finally {
    await p.eval(`fetch('/api/views').then(r=>r.json()).then(views=>Promise.all(views.filter(v=>v.name==='Sidebar view').map(v=>fetch('/api/views/'+v.id,{method:'DELETE'}))))`);
  }
});
