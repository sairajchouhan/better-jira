import { afterAll, expect, test } from "bun:test";
import { open, stop, type Page } from "./harness";
afterAll(stop);

/** A writable site faked in the page: ops land in `window.__ops`, clipboard writes in `window.__copied`. */
const setup = `(()=>{const real=fetch;window.__ops=[];
window.fetch=async(input,init)=>{const path=new URL(String(input),location.href).pathname;
 if(path==='/api/client'){const client=await (await real(input,init)).json();return Response.json({...client,writable:true});}
 const m=path.match(/^\\/api\\/issues\\/([^/]+)\\/ops$/);if(!m)return real(input,init);
 window.__ops.push({key:m[1],ops:JSON.parse(init.body).ops});
 return Response.json({key:m[1],created:{},others:[]});
};
Object.defineProperty(navigator,'clipboard',{value:{writeText:async t=>{window.__copied=t}}});})()`;
const MENU = '[role="dialog"][aria-label="Issue options"]';
const items = `[...document.querySelectorAll('${MENU} [cmdk-item]')].map(n=>n.dataset.value)`;
const selectedItem = `document.querySelector('[cmdk-item][data-selected=true]')?.dataset.value`;

/** A real right button press on the element's centre, as Chrome fires `contextmenu` from it. */
async function rightClick(page: Page, selector: string) {
  const r = await page.rect(selector);
  const x = r.x + r.width / 2,
    y = r.y + r.height / 2;
  await page.cmd("Input.dispatchMouseEvent", { type: "mouseMoved", x, y });
  for (const type of ["mousePressed", "mouseReleased"])
    await page.cmd("Input.dispatchMouseEvent", {
      type,
      x,
      y,
      button: "right",
      buttons: type === "mousePressed" ? 2 : 0,
      clickCount: 1,
    });
  await page.waitFor(`!!document.querySelector('${MENU}')`);
  return { x, y };
}

test("right-click a board card: the menu opens at the pointer on that card, and Status lands a status op", async () => {
  const page = await open("", { setup });
  try {
    const card = '[data-key="TEST-2"]';
    // Opening stays well under 100 ms.
    const ms = await page.eval<number>(
      `(async()=>{const n=document.querySelector('${card}'),r=n.getBoundingClientRect(),t=performance.now();
n.dispatchEvent(new MouseEvent('contextmenu',{bubbles:true,cancelable:true,clientX:r.x+10,clientY:r.y+10}));
while(!document.querySelector('${MENU}'))await new Promise(requestAnimationFrame);
await new Promise(requestAnimationFrame);return performance.now()-t})()`,
    );
    expect(ms).toBeLessThan(100);
    await page.key("Escape");
    await page.waitFor(`!document.querySelector('${MENU}')`);

    const { x, y } = await rightClick(page, card);
    const menu = await page.rect(MENU);
    expect(Math.abs(menu.left - x)).toBeLessThan(10);
    expect(Math.abs(menu.top - y)).toBeLessThan(10);
    // The right-clicked card is highlighted while the menu is open.
    expect(await page.eval(`document.querySelector('[data-selected]')?.dataset.key`)).toBe(
      "TEST-2",
    );
    expect(await page.eval(items)).toEqual(
      expect.arrayContaining([
        "Status",
        "Priority",
        "Assignee",
        "Due date",
        "Labels",
        "More properties",
        "Create related",
        "Mark as",
        "Copy",
        "Make a copy…",
        "Delete",
      ]),
    );
    const before = await page.eval<string>(
      `document.querySelector('${card}').querySelector('[title]')?.title`,
    );
    await page.click(`${MENU} [cmdk-item][data-value="Status"]`);
    await page.waitFor(`!!document.querySelector('[role="dialog"][aria-label="Change status"]')`);
    const target = await page.eval<string>(
      `[...document.querySelectorAll('[role="dialog"][aria-label="Change status"] [cmdk-item]')].map(n=>n.dataset.value).find(v=>v&&!v.includes(${JSON.stringify(before ?? "")}))`,
    );
    await page.click(
      `[role="dialog"][aria-label="Change status"] [cmdk-item][data-value="${target}"]`,
    );
    await page.waitFor(
      `window.__ops.some(w=>w.key==='TEST-2'&&w.ops.some(o=>o.op==='status'))`,
      8000,
    );
  } finally {
    await page.close();
  }
});

test("right-click a list row: Copy › Copy ID copies that row's key", async () => {
  const page = await open("", { setup });
  try {
    await page.key("b", "meta");
    await page.waitFor(`!!document.querySelector('[data-key="TEST-3"].min-h-11')`);
    await rightClick(page, '[data-key="TEST-3"]');
    await page.type("copy id");
    await page.waitFor(`!!document.querySelector('[cmdk-item][data-value="Copy › Copy ID"]')`);
    await page.key("Enter");
    await page.waitFor(`window.__copied==='TEST-3'`);
    await page.waitFor(`!document.querySelector('${MENU}')`);
  } finally {
    await page.close();
  }
});

test("the card menu: arrow keys walk rows and open submenus, Escape steps back then closes", async () => {
  const page = await open("", { setup });
  try {
    await rightClick(page, '[data-key="TEST-2"]');
    await page.waitFor(`document.activeElement?.getAttribute('aria-label')==='Find issue options'`);
    // Linear opens with no row highlighted; ↓ highlights the first.
    await page.key("ArrowDown");
    expect(await page.eval(selectedItem)).toBe("Status");
    await page.key("ArrowDown");
    await page.key("ArrowDown");
    await page.key("ArrowDown");
    expect(await page.eval(selectedItem)).toBe("Due date");
    await page.key("ArrowRight");
    await page.waitFor(
      `!!document.activeElement?.closest('[role="dialog"][aria-label="Due date"]')`,
    );
    await page.key("ArrowLeft");
    await page.waitFor(`!document.querySelector('[role="dialog"][aria-label="Due date"]')`);
    expect(await page.active()).toBe("Find issue options");
    await page.key("ArrowRight");
    await page.waitFor(`!!document.querySelector('[role="dialog"][aria-label="Due date"]')`);
    await page.key("Escape");
    await page.waitFor(`!document.querySelector('[role="dialog"][aria-label="Due date"]')`);
    expect(await page.eval(`!!document.querySelector('${MENU}')`)).toBe(true);
    await page.key("Escape");
    await page.waitFor(`!document.querySelector('${MENU}')`);
    // Nothing changed, the card keeps the selection, and the board's shortcuts work again.
    expect(await page.eval(`window.__ops.length`)).toBe(0);
    expect(await page.eval(`document.querySelector('[data-selected]')?.dataset.key`)).toBe(
      "TEST-2",
    );
    await page.key("s");
    await page.waitFor(`!!document.querySelector('[role="dialog"][aria-label="Change status"]')`);
  } finally {
    await page.close();
  }
});
