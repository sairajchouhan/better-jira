import { expect, test, fixture, type App as Page } from "./app";

// Package E (backlog round 2026-11-12): editor blocks, menus and references, checked through what reaches Jira.

/** The last description the app wrote to the fake Jira for `key`. */
const savedDescription = async (key = "TEST-2") => {
  const writes = (await fixture.log()).writes.filter((w: { key: string }) => w.key === key);
  for (const write of writes.reverse())
    for (const op of write.ops) if (op.op === "fields" && op.fields.description) return op.fields.description;
  return null;
};
const waitSaved = (match: (doc: any) => boolean) =>
  expect.poll(async () => {
    const doc = await savedDescription();
    return !!doc && match(doc);
  }, { timeout: 8000 }).toBe(true);
/** A fresh line at the end of the description's first paragraph. */
async function newLine(page: Page) {
  await page.waitFor(`!!document.querySelector('#description p')`);
  await page.click("#description p");
  await page.key("End");
  await page.key("Enter");
}

test("BJ-68: a collapsible section from >>> saves as Jira's expand with its title", async ({ open }) => {
  await fixture.reset({ writable: true });
  const page = await open("?issue=TEST-2&view=page");
  await newLine(page);
  await page.type(">>> ");
  await page.waitFor(`!!document.querySelector('#description .rich-expand')`);
  await page.type("Hidden body");
  await page.click('[aria-label="Collapsible section title"]');
  await page.type("Details");
  await page.click("#description p");
  await waitSaved((doc) =>
    doc.content.some(
      (n: any) => n.type === "expand" && n.attrs.title === "Details" && JSON.stringify(n.content).includes("Hidden body"),
    ),
  );
  // It shows collapsed after a reload, and the disclosure opens it.
  await page.reload();
  await page.waitFor(`document.querySelector('#description .rich-expand')?.dataset.open==='false'`);
  await page.click('[aria-label="Expand section"]');
  await page.waitFor(`document.querySelector('#description .rich-expand')?.dataset.open==='true'`);
  expect(await page.eval(`document.querySelector('[aria-label="Collapsible section title"]').value`)).toBe("Details");
});

test("BJ-42 / BJ-57 / BJ-43: the slash, emoji and @ menus insert blocks, emoji and issue references", async ({ open }) => {
  await fixture.reset({ writable: true });
  const page = await open("?issue=TEST-2&view=page");
  const menu = (label: string) =>
    page.waitFor<string[]>(
      `(()=>{const items=[...document.querySelectorAll('[aria-label="${label}"] [cmdk-item]')].map(n=>n.textContent);return items.length&&items})()`,
    );
  await test.step("BJ-42: / then a name, Enter: a divider", async () => {
    await newLine(page);
    await page.type("/");
    expect(await menu("Insert block")).toContain("Collapsible section");
    await page.type("divi");
    expect(await menu("Insert block")).toEqual(["Divider"]);
    await page.key("Enter");
    await page.waitFor(`!document.querySelector('[aria-label="Insert block"]')`);
    expect(await page.eval(`document.getElementById('description').textContent.includes('/divi')`)).toBe(false);
  });
  await test.step("BJ-57: :tad then Enter inserts 🎉", async () => {
    await page.type("Shipped :tad");
    expect((await menu("Insert emoji"))[0]).toContain(":tada:");
    await page.key("Enter");
  });
  await test.step("BJ-43: @ an issue key picks the issue; a typed key becomes a reference too", async () => {
    await page.type(" see @TEST-3");
    await page.waitFor(
      `[...document.querySelectorAll('[aria-label="Mention people"] [cmdk-item]')].some(n=>n.textContent.startsWith('TEST-3'))`,
    );
    await page.eval(
      `[...document.querySelectorAll('[aria-label="Mention people"] [cmdk-item]')].find(n=>n.textContent.startsWith('TEST-3')).click()`,
    );
    await page.type("and TEST-4 ");
  });
  await page.click("#description h2");
  await waitSaved((doc) => {
    const json = JSON.stringify(doc);
    return (
      doc.content.some((n: any) => n.type === "rule") &&
      json.includes('"shortName":":tada:"') &&
      json.includes("/browse/TEST-3") &&
      json.includes("/browse/TEST-4")
    );
  });
  expect(await page.eval(`[...document.querySelectorAll('#description a.rich-token')].map(n=>n.textContent)`)).toEqual([
    "TEST-3",
    "TEST-4",
  ]);
});

test("links in the description open on click: other sites in a new tab, an issue reference in the app", async ({
  open,
}) => {
  const page = await open("?issue=TEST-2&view=page");
  await page.waitFor(`!!document.querySelector('#description .ProseMirror a[href="https://example.test/reference"], #description a[href="https://example.test/reference"]')`);
  await page.eval(`window.open=(url)=>{window.__opened=url;return null}`);
  await page.click('#description a[href="https://example.test/reference"]');
  expect(await page.eval(`window.__opened`)).toBe("https://example.test/reference");
  await page.click("#description h2");
  await page.key("End");
  await page.key("Enter");
  await page.type("see TEST-4 ");
  await page.waitFor(`[...document.querySelectorAll('#description a.rich-token')].some(n=>n.textContent==='TEST-4')`);
  await page.eval(`[...document.querySelectorAll('#description a.rich-token')].find(n=>n.textContent==='TEST-4').click()`);
  await page.waitFor(`new URLSearchParams(location.search).get('issue')==='TEST-4'`);
});

test("BJ-69: Create issue from selection opens the composer titled with the selected text, related to this issue", async ({
  open,
}) => {
  await fixture.reset({ writable: true });
  const page = await open("?issue=TEST-2&view=page");
  await page.waitFor(`!!document.querySelector('#description h2')`);
  await page.click("#description h2");
  await page.key("End");
  await page.key("Home", "shift");
  await page.click('[aria-label="Create issue from selection"]');
  expect(await page.waitFor<string>(`document.querySelector('[role="dialog"] [aria-label="Issue title"]')?.value`)).toBe(
    "Rich fixture heading",
  );
  await page.eval(
    `[...document.querySelectorAll('[role="dialog"] button')].find(b=>b.textContent==='Create issue').click()`,
  );
  await expect
    .poll(async () => (await fixture.log()).writes.flatMap((w: any) => w.ops.map((op: any) => [w.key, op.op, op.fields?.summary ?? op.kind])), {
      timeout: 8000,
    })
    .toEqual([
      ["TEST-NEW1", "create", "Rich fixture heading"],
      ["TEST-2", "link", "related"],
      ["TEST-2", "fields", undefined], // BJ-69: the selected text became a reference to the new issue
    ]);
});

// The fixture refuses creates; this site lands them as TEST-90 and passes every other write through.
const landing = `(()=>{const real=fetch;window.__ops=[];
window.fetch=async(input,init)=>{const m=new URL(String(input),location.href).pathname.match(/^\\/api\\/issues\\/([^/]+)\\/ops$/);
 if(!m)return real(input,init);
 const {ops}=JSON.parse(init.body);window.__ops.push({key:m[1],ops});
 if(ops[0]?.op!=='create')return real(input,init);
 const f=ops[0].fields;return Response.json({key:'TEST-90',created:{[m[1]]:'TEST-90'},others:[],issue:{key:'TEST-90',board:1,summary:f.summary,status:f.status,type:'Task',assignee:null,labels:[],comments:0,updated:'2026-11-08T10:00:00Z',resolved:null,project:{key:'TEST',name:'Audit'}}});
};})()`;

test("BJ-69: the created issue replaces the selected text with a reference, saved under its Jira key", async ({ open }) => {
  await fixture.reset({ writable: true });
  const page = await open("?issue=TEST-2&view=page", { setup: landing });
  await page.waitFor(`!!document.querySelector('#description h2')`);
  await page.click("#description h2");
  await page.key("End");
  await page.key("Home", "shift");
  await page.click('[aria-label="Create issue from selection"]');
  await page.waitFor(`document.querySelector('[role="dialog"] [aria-label="Issue title"]')?.value === "Rich fixture heading"`);
  await page.key("Enter", "meta");
  // The heading's text is now Jira's smart link to the new issue.
  await page.waitFor(`!document.querySelector('#description h2')?.textContent.includes("Rich fixture heading")`);
  const description = await page.waitFor<string>(
    `JSON.stringify(window.__ops.filter(w=>w.key==='TEST-2').flatMap(w=>w.ops).find(op=>op.fields?.description)?.fields.description ?? "")`,
    8000,
  );
  expect(description).toMatch(/"type":"inlineCard","attrs":\{"url":"[^"]*\/browse\/TEST-90"\}/);
  expect(description).not.toContain("Rich fixture heading");
});

test("BJ-56 / BJ-55: block controls, the block menu and ⌥↓ act on the caret's block", async ({ open }) => {
  await fixture.reset({ writable: true });
  const page = await open("?issue=TEST-2&view=page");
  await page.waitFor(`!!document.querySelector('#description h2')`);
  const blocks = () =>
    page.eval<string[]>(`[...document.getElementById('description').children].map(n=>n.tagName+':'+n.textContent)`);
  const before = await blocks();
  await page.click("#description h2");
  await test.step("⌥F10 focuses the block controls; Esc returns to the text", async () => {
    await page.key("F10", "alt");
    expect(await page.active()).toBe("Block actions");
    await page.key("Escape");
    await page.waitFor(`document.activeElement?.id==='description'`);
  });
  await test.step("⇧F10 opens the block menu; Duplicate copies the block", async () => {
    await page.key("F10", "shift");
    await page.waitFor(`!!document.querySelector('[aria-label="Block menu"]')`);
    await page.eval(
      `[...document.querySelectorAll('[aria-label="Block menu"] [cmdk-item]')].find(n=>n.textContent.startsWith('Duplicate')).click()`,
    );
    await page.waitFor(`document.getElementById('description').children.length===${before.length + 1}`);
    expect((await blocks()).slice(0, 2)).toEqual([before[0], before[0]]);
  });
  await test.step("⌥↓ moves the block below its neighbours", async () => {
    await page.waitFor(`document.activeElement?.id==='description'`);
    await page.key("ArrowDown", "alt");
    await page.key("ArrowDown", "alt");
    await page.waitFor(`document.getElementById('description').children[1].textContent===${JSON.stringify(before[1]!.replace(/^[A-Z0-9]+:/, ""))}`);
    expect((await blocks())[2]).toBe(before[0]);
  });
});

test("BJ-54: dragging an image's width handle saves its width to Jira", async ({ open }) => {
  await fixture.reset({ writable: true, includeMedia: true });
  const page = await open("?issue=TEST-2&view=page");
  const handle = '#description .media-resize-handle[data-side="right"]';
  await page.waitFor(`!!document.querySelector('${handle}')`);
  const box = await page.rect(handle);
  await page.hover(handle);
  await page.pointerDrag(box.x + 3, box.y + box.height / 2, box.x + 3 - 120, box.y + box.height / 2);
  await waitSaved((doc) => {
    const image = doc.content.find((n: any) => n.type === "mediaSingle");
    return Number(image?.attrs?.width) > 0 && Number(image.attrs.width) < 100;
  });
});

test("BJ-44 / BJ-66: a URL pasted over selected text links it; |-- starts a table", async ({ open }) => {
  await fixture.reset({ writable: true });
  const page = await open("?issue=TEST-2&view=page");
  await newLine(page);
  await page.type("read the docs");
  await page.key("ArrowLeft", "alt", "shift");
  await page.eval(
    `(()=>{const data=new DataTransfer();data.setData('text/plain','https://example.test/docs');document.getElementById('description').dispatchEvent(new ClipboardEvent('paste',{clipboardData:data,bubbles:true,cancelable:true}))})()`,
  );
  await page.waitFor(`[...document.querySelectorAll('#description a')].some(a=>a.textContent==='docs'&&a.href==='https://example.test/docs')`);
  await page.key("ArrowRight");
  await page.key("Enter");
  await page.type("|--");
  await page.waitFor(`document.querySelectorAll('#description table').length===2`);
  await page.click("#description h2");
  await waitSaved((doc) => doc.content.filter((n: any) => n.type === "table").length === 2 && JSON.stringify(doc).includes("https://example.test/docs"));
});
