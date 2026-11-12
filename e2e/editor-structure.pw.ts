import { expect, test, fixture, type App as Page } from "./app";

// Editor parity package B: blocks, menus and structure, checked through what reaches the fake Jira.

/** The last description the app wrote to the fake Jira for `key`. */
const savedDescription = async (key = "TEST-2") => {
  const writes = (await fixture.log()).writes.filter((w: { key: string }) => w.key === key);
  for (const write of writes.reverse())
    for (const op of write.ops) if (op.op === "fields" && op.fields.description) return op.fields.description;
  return null;
};
const waitSaved = (match: (doc: any) => boolean) =>
  expect
    .poll(
      async () => {
        const doc = await savedDescription();
        return !!doc && match(doc);
      },
      { timeout: 8000 },
    )
    .toBe(true);
const types = (doc: any) => doc.content.map((n: any) => n.type);
/** A fresh line at the end of the description's first paragraph. */
async function newLine(page: Page) {
  await page.waitFor(`!!document.querySelector('#description p')`);
  await page.click("#description p");
  await page.key("End");
  await page.key("Enter");
}
// macOS Home/End go to the document's ends; ⌘←/⌘→ go to the line's.
const lineStart = (page: Page, ...mods: string[]) => page.key("ArrowLeft", "meta", ...mods);
const lineEnd = (page: Page) => page.key("ArrowRight", "meta");
const menuItems = (page: Page, label: string) =>
  page.waitFor<string[]>(
    `(()=>{const items=[...document.querySelectorAll('[aria-label="${label}"] [cmdk-item] .menu-name')].map(n=>n.textContent);return items.length&&items})()`,
  );

test("BJ-173: `[ ]` starts a checklist; a click and ⌘↵ tick it, done items dim, and Jira gets a taskList", async ({ open }) => {
  await fixture.reset({ writable: true });
  const page = await open("?issue=TEST-2&view=page");
  await newLine(page);
  await page.type("[ ]Buy milk");
  await page.waitFor(`document.querySelector('#description li[data-task-state]')?.textContent==='Buy milk'`);
  await test.step("the checkbox ticks the item without taking the caret", async () => {
    await page.click('#description [role="checkbox"]');
    await page.waitFor(`document.querySelector('#description li[data-task-state]').dataset.done==='true'`);
    expect(await page.active()).toBe("Issue description");
    // Linear's --editor-todo-checked-opacity: .75 light, .65 dark.
    expect(["0.75", "0.65"]).toContain(await page.eval(`getComputedStyle(document.querySelector('#description .todo-content')).opacity`));
    await waitSaved((doc) =>
      doc.content.some(
        (n: any) =>
          n.type === "taskList" &&
          n.attrs?.localId &&
          n.content[0].attrs.state === "DONE" &&
          n.content[0].attrs.localId &&
          n.content[0].content[0].text === "Buy milk",
      ),
    );
  });
  await test.step("⌘↵ in the item unticks it", async () => {
    await page.click("#description .todo-content");
    await page.key("Enter", "meta");
    await page.waitFor(`document.querySelector('#description li[data-task-state]').dataset.done==='false'`);
    await page.click("#description h2");
    await waitSaved((doc) => doc.content.some((n: any) => n.type === "taskList" && n.content[0].attrs.state === "TODO"));
  });
  await test.step("Enter adds an item; Enter on the empty one leaves the checklist", async () => {
    await page.click("#description .todo-content");
    await lineEnd(page);
    await page.key("Enter");
    await page.type("Eggs");
    await page.key("Enter");
    await page.key("Enter");
    await page.type("after");
    await page.waitFor(`document.querySelectorAll('#description li[data-task-state]').length===2`);
    await page.click("#description h2");
    await waitSaved((doc) => {
      const i = doc.content.findIndex((n: any) => n.type === "taskList");
      return i >= 0 && doc.content[i].content.length === 2 && doc.content[i + 1]?.content?.[0]?.text === "after";
    });
  });
});

test("BJ-173: ⌘⇧7, the slash Checklist and the toolbar's list menu all make a checklist", async ({ open }) => {
  await fixture.reset({ writable: true });
  const page = await open("?issue=TEST-2&view=page");
  await newLine(page);
  await page.type("one");
  await page.key("7", "meta", "shift");
  await page.waitFor(`document.querySelectorAll('#description li[data-task-state]').length===1`);
  await page.key("7", "meta", "shift");
  await page.waitFor(`!document.querySelector('#description li[data-task-state]')`);
  await page.key("Enter");
  await page.type("/check");
  expect((await menuItems(page, "Insert block"))[0]).toBe("Checklist");
  await page.key("Enter");
  await page.waitFor(`document.querySelectorAll('#description li[data-task-state]').length===1`);
  // The list menu turns the checklist into a bulleted list.
  await page.type("two");
  await lineStart(page, "shift");
  await page.click('[aria-label="List"]');
  await page.eval(`[...document.querySelectorAll('[aria-label="List"] [cmdk-item]')].find(n=>n.querySelector('.menu-name').textContent==='List').click()`);
  await page.waitFor(`!document.querySelector('#description li[data-task-state]')`);
  expect(await page.eval(`[...document.querySelectorAll('#description ul > li')].some(li=>li.textContent==='two')`)).toBe(true);
});

test("BJ-173: before the editor arrives, the read-only checkbox ticks the item and saves it", async ({ open }) => {
  await fixture.reset({ writable: true });
  // The issue's description is a one-item checklist (the fixture has none of its own).
  const app = await open("", {
    setup: `(()=>{const real=fetch;window.fetch=async(input,init)=>{const path=new URL(String(input),location.href).pathname;
      if(path!=='/api/issues/TEST-2'||(init?.method??'GET')!=='GET')return real(input,init);const full=await (await real(input,init)).json();
      full.fields.description={type:'doc',version:1,content:[{type:'taskList',attrs:{localId:'list'},content:[
        {type:'taskItem',attrs:{localId:'a',state:'TODO'},content:[{type:'text',text:'Ship'}]}]}]};
      return Response.json(full);};})()`,
  });
  let release!: () => void;
  const gate = new Promise<void>((resolve) => (release = resolve));
  await app.page.route("**/*.js", async (route) => {
    const response = await route.fetch();
    if ((await response.text()).includes("Invalid content for node")) await gate;
    await route.fulfill({ response });
  });
  await app.click("[data-key=TEST-2]");
  try {
    const box = app.page.locator('[aria-busy="true"] [role="checkbox"]').first();
    await expect(box).toBeVisible();
    await box.click();
    await expect(box).toHaveAttribute("aria-checked", "true");
    await waitSaved((d) => d.content.some((n: any) => n.type === "taskList" && n.content[0].attrs.state === "DONE"));
  } finally {
    release();
  }
});

test("BJ-182: the slash Callout and `> [!WARNING]` save as Jira panels", async ({ open }) => {
  await fixture.reset({ writable: true });
  const page = await open("?issue=TEST-2&view=page");
  await newLine(page);
  await page.type("/callout");
  await page.key("Enter");
  await page.waitFor(`!!document.querySelector('#description .rich-panel[data-panel-type="info"]')`);
  await page.type("Heads up");
  await page.click("#description h2");
  await lineEnd(page);
  await page.key("Enter");
  await page.type("> [!WARNING]");
  await page.waitFor(`!!document.querySelector('#description .rich-panel[data-panel-type="warning"]')`);
  await page.type("Careful");
  await page.click("#description h2");
  await waitSaved((doc) => {
    const panels = doc.content.filter((n: any) => n.type === "panel");
    return (
      panels.some((n: any) => n.attrs.panelType === "info" && JSON.stringify(n).includes("Heads up")) &&
      panels.some((n: any) => n.attrs.panelType === "warning" && JSON.stringify(n).includes("Careful"))
    );
  });
});

test("rows 21/36/38, BJ-175, §4: dividers, Date, ⇧↵, ⌃⇧2, heading ⌫ and two-space indent", async ({ open }) => {
  await fixture.reset({ writable: true });
  const page = await open("?issue=TEST-2&view=page");
  await newLine(page);
  await test.step("`---` becomes a divider in place; ⌘⇧- inserts one", async () => {
    await page.type("---");
    await page.waitFor(`!!document.querySelector('#description hr')`);
    await page.type("text");
    await page.key("-", "meta", "shift");
    await page.waitFor(`document.querySelectorAll('#description hr').length===2`);
  });
  await test.step("the slash Date inserts today", async () => {
    await page.type("/today");
    expect(await menuItems(page, "Insert block")).toEqual(["Date"]);
    await page.key("Enter");
  });
  await test.step("⇧↵ breaks the line; ⌃⇧2 makes a heading; ⌫ at its start makes it text again", async () => {
    await page.type("a");
    await page.key("Enter", "shift");
    await page.type("b");
    await page.key("Enter");
    await page.type("Title");
    await page.key("2", "ctrl", "shift");
    await page.waitFor(`[...document.querySelectorAll('#description h2')].some(h=>h.textContent==='Title')`);
    await lineStart(page);
    await page.key("Backspace");
    await page.waitFor(`![...document.querySelectorAll('#description h2')].some(h=>h.textContent==='Title')`);
  });
  await test.step("two spaces at a list item's start indent it", async () => {
    await lineEnd(page);
    await page.key("Enter");
    await page.type("- one");
    await page.key("Enter");
    await page.type("  two");
    await page.waitFor(`!!document.querySelector('#description li li')`);
  });
  await page.click("#description h2");
  await waitSaved((doc) => {
    const json = JSON.stringify(doc);
    return (
      types(doc).filter((t: string) => t === "rule").length === 2 &&
      json.includes('"type":"date"') &&
      json.includes('{"type":"text","text":"a"},{"type":"hardBreak"},{"type":"text","text":"b"}') &&
      json.includes('"type":"bulletList","content":[{"type":"listItem","content":[{"type":"paragraph","content":[{"type":"text","text":"one"}]},{"type":"bulletList"')
    );
  });
});

test("rows 51/52/72: the slash menu is Linear's (240px, icons, order) and an empty line hints at it", async ({ open }) => {
  await fixture.reset({ writable: true });
  const page = await open("?issue=TEST-2&view=page");
  await newLine(page);
  expect(
    await page.eval(`getComputedStyle(document.querySelector('#description .rich-slash-tip'),'::before').content`),
  ).toBe('"Type / for commands…"');
  await page.type("/");
  expect(await menuItems(page, "Insert block")).toEqual([
    "Heading 1",
    "Heading 2",
    "Heading 3",
    "Bulleted list",
    "Numbered list",
    "Checklist",
    "Insert media…",
    "Attach files…",
    "Code block",
    "Collapsible section",
    "Blockquote",
    "Callout",
    "Table",
    "Divider",
  ]);
  const menu = await page.rect('[aria-label="Insert block"]');
  expect(menu.width).toBe(240);
  expect(await page.eval(`document.querySelectorAll('[aria-label="Insert block"] [cmdk-item] svg').length`)).toBeGreaterThanOrEqual(14);
  await page.type("warn");
  expect(await menuItems(page, "Insert block")).toEqual(["Callout"]);
});

test("rows 57/58/62: the selection toolbar is Linear's; ⌘⇧O creates an issue from the selection; no block handle", async ({ open }) => {
  await fixture.reset({ writable: true });
  const page = await open("?issue=TEST-2&view=page");
  await page.waitFor(`!!document.querySelector('#description h2')`);
  await page.click("#description h2");
  expect(await page.eval(`!!document.querySelector('[aria-label="Block actions"]')`)).toBe(false);
  await lineEnd(page);
  await lineStart(page, "shift");
  expect(
    await page.waitFor<string[]>(
      `(()=>{const t=document.querySelector('[aria-label="Description formatting"]');return t&&[...t.querySelectorAll('button')].map(b=>b.getAttribute('aria-label'))})()`,
    ),
  ).toEqual([
    "Text style",
    "Bold",
    "Italic",
    "Strikethrough",
    "Underline",
    "Insert link",
    "Block quote",
    "Collapsible section",
    "Inline code",
    "Code block",
    "List",
    "Create issue from selection",
  ]);
  await page.click('[aria-label="Text style"]');
  expect(await menuItems(page, "Text style")).toEqual(["Regular text", "Heading 1", "Heading 2", "Heading 3", "Heading 4"]);
  await page.key("Escape");
  await page.click("#description h2");
  await lineEnd(page);
  await lineStart(page, "shift");
  await page.key("o", "meta", "shift");
  expect(await page.waitFor<string>(`document.querySelector('[role="dialog"] [aria-label="Issue title"]')?.value`)).toBe(
    "Rich fixture heading",
  );
});

test("row 70: a description ending in a non-text block has a line after it to type in", async ({ open }) => {
  await fixture.reset({ writable: true });
  const page = await open("?issue=TEST-2&view=page");
  await page.waitFor(`document.getElementById('description')?.lastElementChild?.tagName==='P'`);
  await page.click("#description > p:last-child");
  await page.type("Tail");
  await page.click("#description h2");
  await waitSaved((doc) => doc.content.at(-1)?.content?.[0]?.text === "Tail");
});
