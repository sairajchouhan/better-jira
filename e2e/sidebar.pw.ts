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
  await p.click('[role="dialog"][aria-label="Favorite options"] [role^=menuitem][data-value="Remove favorite"]');
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
    `document.querySelector('[role^=menuitem][data-focused]')?.textContent?.includes('Customize sidebar')`,
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
    await p.waitFor(`document.querySelector('[role^=menuitem][data-focused]')?.textContent?.includes('Customize sidebar')`);
    await p.key("Enter");
    await p.click('[role="dialog"][aria-label="Customize sidebar"] [aria-label="My issues: Always show"]');
    await p.click("text=Don't show");
    await p.key("Escape");
    await p.waitFor(`!document.querySelector('[role="dialog"][aria-label="Customize sidebar"]')`);
    await p.eval(`[...${nav}.querySelectorAll('button')].find(b=>b.textContent.trim()==='More').click()`);
    await p.waitFor(`!!document.querySelector('[role="dialog"][aria-label="More"] [role^=menuitem][data-value="My issues"]')`);
    await p.click('[role="dialog"][aria-label="More"] [role^=menuitem][data-value="My issues"]');
    await p.waitFor(`location.pathname.startsWith('/my-issues')`);
  } finally {
    await p.eval(`fetch('/api/views').then(r=>r.json()).then(views=>Promise.all(views.filter(v=>v.name==='Sidebar view').map(v=>fetch('/api/views/'+v.id,{method:'DELETE'}))))`);
  }
});

test("a favorite opened from the sidebar lights only its own row, never its board, as Linear's SidebarLink does", async ({ open }) => {
  const p = await open("", {
    setup: `localStorage.getItem(${JSON.stringify(FAVORITES)})??localStorage.setItem(${JSON.stringify(FAVORITES)},'["TEST-1","board:1"]')`,
  });
  const nav = 'nav[aria-label="Main navigation"]';
  // The marked rows: a favorite by its id, any other row by its name.
  const marked = `[...document.querySelectorAll('${nav} [aria-current]')].map(n=>n.dataset.favorite??(n.querySelector('.truncate')??n).textContent.trim()).join('|')`;
  await p.waitFor(`document.querySelectorAll('[data-favorite]').length===2`);
  expect(await p.waitFor(`${marked}==='Browser audit'&&${marked}`)).toBe("Browser audit");

  await test.step("clicking the issue favorite marks it alone; the mouse leaves no focus ring", async () => {
    await p.page.locator('[data-favorite="TEST-1"]').click();
    await p.waitFor(`/TEST-1/.test(location.href)`);
    expect(await p.waitFor(`${marked}==='TEST-1'&&${marked}`)).toBe("TEST-1");
    expect(await p.eval(`document.querySelector('[data-favorite="TEST-1"]').getAttribute('aria-current')`)).toBe("page");
    const ring = await p.eval<[boolean, string]>(
      `(()=>{const a=document.querySelector('[data-favorite="TEST-1"]');return [a.matches(':focus-visible'),getComputedStyle(a).outlineStyle]})()`,
    );
    expect(ring).toEqual([false, "none"]);
  });

  await test.step("Back and Forward keep where the entry came from", async () => {
    await p.page.goBack();
    expect(await p.waitFor(`${marked}==='Browser audit'&&${marked}`)).toBe("Browser audit");
    await p.page.goForward();
    expect(await p.waitFor(`${marked}==='TEST-1'&&${marked}`)).toBe("TEST-1");
  });

  await test.step("closing the issue drops the favorite's origin, so the board it shows lights again", async () => {
    await p.key("Escape");
    expect(await p.waitFor(`${marked}==='Browser audit'&&${marked}`)).toBe("Browser audit");
  });

  await test.step("a board favorite stays lit over an issue opened from it; the board row takes over when clicked", async () => {
    await p.page.locator('[data-favorite="board:1"]').click();
    expect(await p.waitFor(`${marked}==='board:1'&&${marked}`)).toBe("board:1");
    await p.page.locator('[data-key="TEST-2"]').first().click({ position: { x: 10, y: 10 } }); // the card itself, not a badge
    await p.waitFor(`/TEST-2/.test(location.href)`);
    expect(await p.eval(marked)).toBe("board:1");
    await p.page.locator(`${nav} a:not([data-favorite])`, { hasText: "Browser audit" }).click();
    expect(await p.waitFor(`${marked}==='Browser audit'&&${marked}`)).toBe("Browser audit");
  });
});
