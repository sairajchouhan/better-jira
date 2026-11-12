import { expect, test, type App } from "./app";

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
const selectedItem = (page: App) => page.page.locator("[cmdk-item][data-selected=true]");

/** A real right button press on the element's centre, as Chrome fires `contextmenu` from it. */
async function rightClick(page: App, selector: string) {
  const r = await page.rect(selector);
  const x = r.x + r.width / 2,
    y = r.y + r.height / 2;
  await page.page.mouse.click(x, y, { button: "right" });
  await expect(page.page.locator(MENU)).toBeVisible();
  return { x, y };
}

test("board card menu: opens fast at the pointer, walks by keyboard, and its actions land on that card", async ({
  open,
}) => {
  const page = await open("", { setup });
  const card = '[data-key="TEST-2"]';
  const menu = page.page.locator(MENU);

  await test.step("opening stays well under 100 ms", async () => {
    const ms = await page.eval<number>(
      `(async()=>{const n=document.querySelector('${card}'),r=n.getBoundingClientRect(),t=performance.now();
n.dispatchEvent(new MouseEvent('contextmenu',{bubbles:true,cancelable:true,clientX:r.x+10,clientY:r.y+10}));
while(!document.querySelector('${MENU}'))await new Promise(requestAnimationFrame);
await new Promise(requestAnimationFrame);return performance.now()-t})()`,
    );
    expect(ms).toBeLessThan(100);
    await page.key("Escape");
    await expect(menu).toHaveCount(0);
  });

  await test.step("the menu opens at the pointer and highlights the card without selecting it", async () => {
    const { x, y } = await rightClick(page, card);
    const box = await page.rect(MENU);
    expect(Math.abs(box.left - x)).toBeLessThan(10);
    expect(Math.abs(box.top - y)).toBeLessThan(10);
    expect(await page.eval(`document.querySelector('[data-menu]')?.dataset.key`)).toBe("TEST-2");
    expect(await page.eval(`!!document.querySelector('[data-key][data-selected]')`)).toBe(false);
    expect(
      await page.eval<string[]>(
        `[...document.querySelectorAll('${MENU} [cmdk-item]')].map(n=>n.dataset.value)`,
      ),
    ).toEqual(
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
    await page.key("Escape");
    await expect(page.page.locator(MENU)).toHaveCount(0);
  });

  await test.step("arrow keys walk rows and open submenus, Escape steps back then closes", async () => {
    await rightClick(page, card);
    await expect.poll(() => page.active()).toBe("Find issue options");
    // Linear opens with no row highlighted; ↓ highlights the first.
    await page.key("ArrowDown");
    await expect(selectedItem(page)).toHaveAttribute("data-value", "Status");
    await page.key("ArrowDown");
    await page.key("ArrowDown");
    await page.key("ArrowDown");
    await expect(selectedItem(page)).toHaveAttribute("data-value", "Due date");
    const dueDate = page.page.locator('[role="dialog"][aria-label="Due date"]');
    await page.key("ArrowRight");
    await page.waitFor(
      `!!document.activeElement?.closest('[role="dialog"][aria-label="Due date"]')`,
    );
    await page.key("ArrowLeft");
    await expect(dueDate).toHaveCount(0);
    expect(await page.active()).toBe("Find issue options");
    await page.key("ArrowRight");
    await expect(dueDate).toBeVisible();
    await page.key("Escape");
    await expect(dueDate).toHaveCount(0);
    await expect(menu).toBeVisible();
    await page.key("Escape");
    await expect(menu).toHaveCount(0);
  });

  await test.step("closing changes nothing: the highlight goes with the menu and board shortcuts work again", async () => {
    expect(await page.eval(`window.__ops.length`)).toBe(0);
    await expect(page.page.locator("[data-key][data-menu],[data-key][data-selected]")).toHaveCount(
      0,
    );
    await page.key("ArrowDown");
    await expect(page.page.locator("[data-key][data-selected]")).toHaveCount(1);
    await page.key("s");
    await expect(page.page.locator('[role="dialog"][aria-label="Change status"]')).toBeVisible();
    await page.key("Escape");
    await expect(page.page.locator('[role="dialog"][aria-label="Change status"]')).toHaveCount(0);
  });

  await test.step("BJ-26: Status › lists the statuses inline and lands a status op on the right-clicked card", async () => {
    await rightClick(page, card);
    await page.hover(`${MENU} [cmdk-item][data-value="Status"]`);
    const STATUS = '[role="dialog"][aria-label="Status"]';
    await page.waitFor(`!!document.querySelector('${STATUS} [cmdk-item] .menu-checkmark')`);
    const target = await page.eval<string>(
      `[...document.querySelectorAll('${STATUS} [cmdk-item]')].find(n=>!n.querySelector('.menu-checkmark'))?.dataset.value`,
    );
    await page.click(`${STATUS} [cmdk-item][data-value="${target}"]`);
    await page.waitFor(
      `window.__ops.some(w=>w.key==='TEST-2'&&w.ops.some(o=>o.op==='status'))`,
      8000,
    );
    await expect(page.page.locator(MENU)).toHaveCount(0);
  });
});

test("list row menu: Copy › Copy ID copies that row's key", async ({ open }) => {
  const page = await open("", { setup });
  await page.key("b", "meta");
  await page.waitFor(`!!document.querySelector('[data-key="TEST-3"].min-h-11')`);
  await rightClick(page, '[data-key="TEST-3"]');
  await page.type("copy id");
  await page.waitFor(`!!document.querySelector('[cmdk-item][data-value="Copy › Copy ID"]')`);
  await page.key("Enter");
  await page.waitFor(`window.__copied==='TEST-3'`);
  await expect(page.page.locator(MENU)).toHaveCount(0);
});
