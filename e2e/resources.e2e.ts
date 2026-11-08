import { afterAll, expect, test } from "bun:test";
import { APP, open, stop } from "./harness";
afterAll(stop);
async function options(page: Awaited<ReturnType<typeof open>>, name: string) {
  await page.click("#issue-options");
  await page.click(`text=${name}`);
}
test("documents autosave, retain immediate-reload drafts, deep-link, and return through the issue breadcrumb", async () => {
  const page = await open("?issue=TEST-2&view=page");
  try {
    await page.waitFor(`!!document.getElementById('comment')`);
    await page.click("#issue-created a");
    await options(page, "Add document…");
    await page.waitFor(`document.activeElement?.getAttribute('aria-label')==='Document title'`);
    const url = await page.eval<string>("location.href");
    expect(new URL(url).searchParams.get("document")).toBeTruthy();
    expect(new URL(url).hash).toBe("");
    expect(await page.eval(`document.querySelector('[aria-label="Document title"]').value`)).toBe(
      "",
    );
    await page.type("Personal investigation");
    await page.click("#resource-document");
    await page.cmd("Input.insertText", {
      text: "Document draft survives a reload before the debounce",
    });
    expect(await page.eval(`document.getElementById('resource-document').textContent`)).toContain(
      "Document draft survives",
    );
    expect(
      await page.eval(
        `Object.entries(localStorage).filter(([k])=>k.includes('resource-draft')).map(([,v])=>v).join('')`,
      ),
    ).toContain("Document draft survives");
    await page.reload();
    expect(await page.eval("location.href")).toBe(url);

    await page.waitFor(
      `document.getElementById('resource-document')?.textContent.includes('Document draft survives')`,
    );
    expect(await page.eval(`document.querySelector('[aria-label="Document title"]').value`)).toBe(
      "Personal investigation",
    );
    await page.click('[aria-label="Back to issue"]');
    await page.waitFor(`!!document.getElementById('comment')`);
    expect(
      await page.eval(`document.querySelector('[aria-label="Resources"]').innerText`),
    ).toContain("Personal investigation");
    await page.click("text=Personal investigation");
    await page.waitFor(`!!document.getElementById('resource-document')`);
    expect(await page.eval("location.href")).toBe(url);
    await page.key("Escape");
    await page.waitFor(`!!document.getElementById('comment')`);
    await page.cmd("Page.navigate", { url });
    await page.waitFor(`!!document.getElementById('resource-document')`);
  } finally {
    await page.close();
  }
});
test("named URL and pull-request resources validate schemes, persist, collapse, remove and undo locally", async () => {
  const page = await open("?issue=TEST-2&view=page");
  try {
    await page.waitFor(`!!document.getElementById('comment')`);
    await page.click("#issue-options");
    await page.click('[cmdk-item][data-value="Add link…"]');
    await page.type("javascript:alert(1)");
    await page.click("text=Add link");
    await page.waitFor(`!!document.querySelector('[role=alert]')`);
    await page.click('[aria-label="Link URL"]');
    await page.key("a", "meta");
    await page.type("https://example.com/design");
    await page.click('[aria-label="Link title"]');
    await page.type("Design reference");
    await page.click("text=Add link");
    await page.waitFor(`!!document.querySelector('a[href="https://example.com/design"]')`);
    expect(
      await page.eval(`document.querySelector('a[href="https://example.com/design"]').textContent`),
    ).toBe("Design reference");
    await options(page, "Add pull request…");
    await page.type("https://github.com/example/project/pull/17");
    await page.click("text=Add pull request");
    await page.waitFor(`!!document.querySelector('a[href*="/pull/17"]')`);
    await page.waitFor(
      `document.querySelector('[aria-label="Local save status"]').textContent.includes('Saved')`,
    );
    await page.reload();
    await page.waitFor(`!!document.querySelector('a[href*="/pull/17"]')`);
    await page.click('[aria-label="Collapse resources section"]');
    expect(await page.eval(`document.querySelector('a[href*="/pull/17"]')`)).toBeNull();
    await page.click('[aria-label="Expand resources section"]');
    await page.hover('a[href="https://example.com/design"]');
    await page.click('[aria-label="Options for Design reference"]');
    await page.click('[cmdk-item][data-value="Remove…"]');
    await page.click(
      '[role=dialog][aria-label="Remove this link from the issue?"] button[data-autofocus]',
    );
    await page.waitFor(`!document.querySelector('a[href="https://example.com/design"]')`);
    await page.eval("document.activeElement?.blur()");
    await page.key("z", "meta");
    await page.waitFor(`!!document.querySelector('a[href="https://example.com/design"]')`);
    const { requests } = (await (await fetch(`${APP}__fixture`)).json()) as {
      requests: { method: string; path: string }[];
    };
    expect(requests.some((r) => r.method !== "GET" && r.path.startsWith("/api/"))).toBe(false);
  } finally {
    await page.close();
  }
});
test("document media persists, deletion is undoable and missing document URLs recover to the issue", async () => {
  const page = await open("?issue=TEST-2&view=page");
  try {
    await page.waitFor(`!!document.getElementById('comment')`);
    await options(page, "Add document…");
    await page.waitFor(`!!document.getElementById('resource-document')`);
    await page.eval(
      `(()=>{const data=new DataTransfer();data.items.add(new File(['Document attachment'],'document.txt',{type:'text/plain'}));document.getElementById('resource-document').dispatchEvent(new ClipboardEvent('paste',{clipboardData:data,bubbles:true,cancelable:true}))})()`,
    );
    await page.waitFor(
      `document.getElementById('resource-document').textContent.includes('document.txt')`,
    );
    await page.click('[aria-label="Back to issue"]');
    expect(
      await page.eval(
        `document.querySelector('.issue-detail-content').textContent.includes('document.txt')`,
      ),
    ).toBe(false);
    await page.click("text=New document");
    await page.waitFor(
      `document.getElementById('resource-document')?.textContent.includes('document.txt')`,
    );
    await page.click('[aria-label="Document options"]');
    await page.click('[cmdk-item][data-value="Delete"]');
    await page.waitFor(
      `document.activeElement?.textContent==='Delete'&&!!document.querySelector('[role=dialog][aria-label^=Delete]')`,
    );
    await page.key("Escape");
    await page.waitFor(
      `!document.querySelector('[role=dialog][aria-label^=Delete]')&&!!document.getElementById('resource-document')`,
    );
    await page.click('[aria-label="Document options"]');
    await page.click('[cmdk-item][data-value="Delete"]');
    await page.click("text=Delete");
    await page.waitFor(`!!document.getElementById('comment')`);
    expect(await page.eval(`document.querySelector('[aria-label="Resources"]')`)).toBeNull();
    expect(
      await page.eval(
        `document.querySelector('.issue-detail-content').textContent.includes('document.txt')`,
      ),
    ).toBe(false);
    await page.eval("document.activeElement?.blur()");
    await page.key("z", "meta");
    await page.waitFor(
      `document.querySelector('[aria-label="Resources"]').innerText.includes('New document')`,
    );
    await page.goto("?issue=TEST-2&view=page&document=missing");
    await page.waitFor(`document.body.textContent.includes('Document not found')`);
    await page.click("text=Back to issue");
    await page.waitFor(`!!document.getElementById('comment')`);
  } finally {
    await page.close();
  }
});

test("a document does not run issue edit, navigation or delete bindings behind its page", async () => {
  const page = await open("?issue=TEST-2&view=page");
  try {
    await page.click("#issue-options");
    await page.click("text=Add document…");
    await page.waitFor(`!!document.getElementById('resource-document')`);
    const url = await page.eval("location.href");
    await page.eval("document.activeElement?.blur()");
    for (const [key, mods] of [
      ["p", []],
      ["j", []],
      ["Backspace", ["meta"]],
    ] as [string, string[]][]) {
      await page.key(key, ...mods);
      expect(await page.eval("location.href")).toBe(url);
      expect(await page.eval(`!!document.querySelector('[role=dialog]')`)).toBe(false);
    }
    await page.key("Escape");
    await page.waitFor(`!!document.getElementById('summary')`);
    expect(await page.eval(`document.getElementById('summary').value`)).toBe("Browser fixture 2");
  } finally {
    await page.close();
  }
});
test("resource row menus follow Linear: links open, copy, edit the title and confirm removal; documents open, copy their URL and confirm deletion", async () => {
  const page = await open("?issue=TEST-2&view=page");
  try {
    const items = `[...document.querySelectorAll('[role="dialog"][aria-label="Resource options"] [cmdk-item]')].map(n=>n.getAttribute('data-value'))`;
    await page.waitFor(`!!document.getElementById('comment')`);
    await page.click("#issue-options");
    await page.click('[cmdk-item][data-value="Add link…"]');
    await page.type("https://example.com/spec");
    await page.click('[aria-label="Link title"]');
    await page.type("Spec");
    await page.click("text=Add link");
    await page.waitFor(`!!document.querySelector('a[href="https://example.com/spec"]')`);
    // Linear confirms the link and lists it in Activity while it stays attached.
    await page.waitFor(
      `[...document.querySelectorAll('[role=status],[role=alert],[aria-live]')].some(n=>n.textContent.includes('URL successfully linked.'))&&!document.querySelector('[aria-label="Local save status"]').textContent.includes('URL successfully linked.')`,
    );
    const linked = `document.querySelector('[data-activity="link"]')?.textContent.replace(/\\s+/g,' ').trim()`;
    await page.waitFor(`/linked Spec ·/.test(${linked})`);
    // One line, like Linear's "linked <icon> title · time": every part of the row shares a baseline row.
    expect(
      await page.eval(
        `(()=>{const row=document.querySelector('[data-activity="link"]'),tops=[...row.querySelectorAll('a,svg,time,[data-time],span')].filter(n=>n.getBoundingClientRect().height).map(n=>n.getBoundingClientRect());return row.getBoundingClientRect().height<=24.8&&Math.max(...tops.map(r=>r.top))-Math.min(...tops.map(r=>r.top))<8})()`,
      ),
    ).toBe(true);
    expect(
      await page.eval(
        `(()=>{const b=document.querySelector('[aria-label="Add resource to issue"]'),r=b.getBoundingClientRect();return [r.width,r.height,parseFloat(getComputedStyle(b).borderRadius)>=14]})()`,
      ),
    ).toEqual([28, 28, true]); // Linear's round + button
    // Linear (RAJ-52): actor and link title keep the row's dim colour, set apart only by weight 500.
    expect(
      await page.eval(
        `(()=>{const row=document.querySelector('[data-activity="link"]'),dim=getComputedStyle(row).color,name=row.querySelector('.font-medium'),link=row.querySelector('a');return [getComputedStyle(name).color===dim,getComputedStyle(link).color===dim,getComputedStyle(name).fontWeight,getComputedStyle(link).fontWeight]})()`,
      ),
    ).toEqual([true, true, "500", "500"]);
    await page.waitFor(
      `document.querySelector('[aria-label="Local save status"]').textContent.includes('Saved')`,
    );
    await page.reload();
    await page.waitFor(`/linked Spec ·/.test(${linked})`);
    await page.eval(
      `document.querySelector('a[href="https://example.com/spec"]').dispatchEvent(new MouseEvent('contextmenu',{bubbles:true,cancelable:true}))`,
    );
    await page.waitFor(
      `document.activeElement?.getAttribute('aria-label')==='Find resource options'`,
    );
    await page.key("Escape");
    await page.waitFor(`!document.querySelector('[aria-label="Resource options"]')`);
    await page.eval(
      `window.opened=[];window.open=(...args)=>{window.opened.push(args);return null};window.copied=[];navigator.clipboard.writeText=async text=>{window.copied.push(text)}`,
    );
    const menu = async (name: string) => {
      await page.hover(`[aria-label="Options for ${name}"]`);
      await page.click(`[aria-label="Options for ${name}"]`);
      await page.waitFor(`${items}.length>0`);
    };
    await menu("Spec");
    expect(await page.eval(items)).toEqual(["Open link", "Copy link", "Edit…", "Remove…"]);
    expect(
      await page.eval(
        `(()=>{const m=document.querySelector('[role="dialog"][aria-label="Resource options"]');return [m.querySelectorAll('[cmdk-separator]').length,[...m.querySelectorAll('[cmdk-item]')].every(n=>n.querySelector('svg'))]})()`,
      ),
    ).toEqual([2, true]);
    await page.click('[cmdk-item][data-value="Open link"]');
    expect(await page.eval(`window.opened[0].slice(0,2)`)).toEqual([
      "https://example.com/spec",
      "_blank",
    ]);
    await menu("Spec");
    await page.click('[cmdk-item][data-value="Copy link"]');
    await page.waitFor(`window.copied.length===1`);
    expect(await page.eval("window.copied[0]")).toBe("https://example.com/spec");
    await menu("Spec");
    await page.click('[cmdk-item][data-value="Edit…"]');
    await page.waitFor(`document.activeElement?.getAttribute('aria-label')==='Link title'`);
    expect(
      await page.eval(
        `[document.querySelector('[aria-label="Link URL"]').disabled,document.querySelector('[aria-label="Link URL"]').value,document.activeElement.value]`,
      ),
    ).toEqual([true, "https://example.com/spec", "Spec"]);
    await page.key("a", "meta");
    await page.type("Final spec");
    await page.key("Enter");
    await page.waitFor(
      `document.querySelector('a[href="https://example.com/spec"]')?.textContent==='Final spec'`,
    );
    await page.waitFor(`/linked Final spec ·/.test(${linked})`);
    await menu("Final spec");
    await page.click('[cmdk-item][data-value="Remove…"]');
    await page.waitFor(
      `document.activeElement?.textContent==='Remove'&&!!document.querySelector('[role=dialog][aria-label="Remove this link from the issue?"]')`,
    );
    await page.key("Escape");
    await page.waitFor(`!document.querySelector('[role=dialog][aria-label^="Remove this link"]')`);
    expect(await page.eval(`!!document.querySelector('a[href="https://example.com/spec"]')`)).toBe(
      true,
    );
    await menu("Final spec");
    await page.click('[cmdk-item][data-value="Remove…"]');
    await page.waitFor(`document.activeElement?.textContent==='Remove'`);
    await page.key("Enter");
    await page.waitFor(`!document.querySelector('a[href="https://example.com/spec"]')`);
    expect(await page.eval(`!!document.querySelector('[data-activity="link"]')`)).toBe(false);
    await page.click("#issue-options");
    await page.click('[cmdk-item][data-value="Add document…"]');
    await page.waitFor(`document.activeElement?.getAttribute('aria-label')==='Document title'`);
    await page.type("Row doc");
    const id = await page.eval<string>(`new URL(location.href).searchParams.get('document')`);
    await page.click('[aria-label="Back to issue"]');
    await page.waitFor(`!!document.getElementById('comment')`);
    await menu("Row doc");
    expect(await page.eval(items)).toEqual(["Open document", "Copy URL", "Delete"]);
    expect(
      await page.eval(
        `(()=>{const m=document.querySelector('[role="dialog"][aria-label="Resource options"]');return [m.querySelectorAll('[cmdk-separator]').length,[...m.querySelectorAll('[cmdk-item]')].every(n=>n.querySelector('svg'))]})()`,
      ),
    ).toEqual([0, true]);
    await page.click('[cmdk-item][data-value="Copy URL"]');
    await page.waitFor(`window.copied.length===2`);
    expect(new URL(await page.eval<string>("window.copied[1]")).searchParams.get("document")).toBe(
      id,
    );
    await menu("Row doc");
    await page.click('[cmdk-item][data-value="Open document"]');
    await page.waitFor(
      `new URL(location.href).searchParams.get('document')==='${id}'&&!!document.getElementById('resource-document')`,
    );
    await page.click('[aria-label="Back to issue"]');
    await page.waitFor(`!!document.getElementById('comment')`);
    await menu("Row doc");
    await page.click('[cmdk-item][data-value="Delete"]');
    await page.waitFor(
      `document.activeElement?.textContent==='Delete'&&!!document.querySelector('[role=dialog][aria-label='+JSON.stringify('Delete "Row doc"?')+']')`,
    );
    await page.key("Enter");
    await page.waitFor(
      `!document.querySelector('[aria-label="Resources"]')?.innerText.includes('Row doc')`,
    );
  } finally {
    await page.close();
  }
});
test("a link unfurls like Linear: site icon, page description, and the page title when none was given; kept across reload and undo", async () => {
  const page = await open("?issue=TEST-2&view=page");
  try {
    await page.waitFor(`!!document.getElementById('comment')`);
    await page.click("#issue-options");
    await page.click('[cmdk-item][data-value="Add link…"]');
    await page.type("https://example.com/");
    await page.click("text=Add link");
    const row = `document.querySelector('section[aria-label=Resources] a[href="https://example.com/"]').parentElement`;
    const look = `(()=>{const r=${row};return [r.querySelector('a').textContent,r.querySelector('[data-link-description]')?.textContent,r.querySelector('[data-link-icon]')?.naturalWidth>0,document.querySelector('[data-activity=link] a').textContent];})()`;
    const expected = [
      "Example Domain",
      "This domain is for use in documentation examples without needing permission.",
      true,
      "Example Domain",
    ];
    await page.waitFor(`${row}?.querySelector('[data-link-icon]')?.naturalWidth>0`, 8000);
    expect(await page.eval(look)).toEqual(expected);
    // Fetching the preview is not an edit: undoing the link removes it, and redo brings it back with its preview.
    await page.eval("document.activeElement?.blur()");
    await page.key("z", "meta");
    await page.waitFor(`!${row.replace(".parentElement", "")}`);
    await page.key("z", "meta", "shift");
    await page.waitFor(`!!${row.replace(".parentElement", "")}`);
    expect(await page.eval(look)).toEqual(expected);
    await page.waitFor(
      `document.querySelector('[aria-label="Local save status"]')?.textContent.includes('Saved')`,
    );
    await page.reload();
    await page.waitFor(`${row}?.querySelector('[data-link-icon]')?.naturalWidth>0`, 8000);
    expect(await page.eval(look)).toEqual(expected);
  } finally {
    await page.close();
  }
});

test("resource rows and open-menu triggers follow Linear (RAJ-52): 36px rows 1px apart, 13px/500 titles, ⋯ 4px after the time and lit while its menu is open", async () => {
  const page = await open("?issue=TEST-2&view=page", { width: 1272, height: 902 });
  try {
    await page.waitFor(`!!document.getElementById('comment')`);
    await page.click("#issue-options");
    await page.click('[cmdk-item][data-value="Add link…"]');
    await page.type("https://example.com/spec");
    await page.click('[aria-label="Link title"]');
    await page.type("Spec");
    await page.click("text=Add link");
    await page.waitFor(`!!document.querySelector('[aria-label="Options for Spec"]')`);
    await page.click("#issue-options");
    await page.type("Add document");
    await page.key("Enter");
    await page.waitFor(`document.activeElement?.getAttribute('aria-label')==='Document title'`);
    await page.type("Doc");
    await page.eval("history.back()");
    await page.waitFor(`!!document.querySelector('[aria-label="Options for Doc"]')`);
    await page.click("#comment");
    await page.type("Lit");
    await page.key("Enter", "meta");
    await page.waitFor(`!!document.querySelector('[data-comment] [aria-label="Comment options"]')`);
    const park = () =>
      page.cmd("Input.dispatchMouseEvent", { type: "mouseMoved", x: 1265, y: 895 });
    await page.eval(
      `document.querySelector('[aria-label="Options for Spec"]').scrollIntoView({block:'center'})`,
    );
    await park();
    await Bun.sleep(200);
    const shape = `(()=>{const B=n=>n.getBoundingClientRect(),sec=B(document.querySelector('.issue-resources')),tog=B(document.querySelector('[aria-label="Collapse resources section"]')),rows=[...document.querySelectorAll('.issue-resources [aria-label^="Options for "]')].map(b=>b.parentElement),r0=B(rows[0]),r1=B(rows[1]),icon=B(rows[0].firstElementChild),a=rows[0].querySelector('a'),t=B(a),time=B(rows[0].querySelector('time')),btn=rows[0].querySelector('button[aria-label^="Options"]'),b=B(btn),c=getComputedStyle(a);return [tog.height,tog.left-r0.left,r0.left-sec.left,r0.right-sec.right,r0.height,r0.top-tog.bottom,r1.top-r0.bottom,getComputedStyle(rows[0]).borderRadius,icon.left-r0.left,t.left-icon.right,c.fontSize,c.fontWeight,c.color,b.width,b.height,r0.right-b.right,b.left-time.right,getComputedStyle(btn).opacity].map(v=>typeof v==='number'?Math.round(v):v)})()`;
    expect(await page.eval(shape)).toEqual([
      24,
      0,
      -6,
      0,
      36,
      11,
      1,
      "8px",
      8,
      8,
      "13px",
      "500",
      "lch(100 0 272)",
      24,
      24,
      10,
      4,
      "0",
    ]);
    const lit = (sel: string) =>
      page.eval(
        `(()=>{const b=document.querySelector(${JSON.stringify(sel)});return [getComputedStyle(b).opacity,getComputedStyle(b).backgroundColor,getComputedStyle(b.parentElement).backgroundColor]})()`,
      );
    await page.hover('.issue-resources a[href*="example.com"]');
    await Bun.sleep(150);
    expect((await lit('[aria-label="Options for Spec"]'))[2]).toBe("lch(9.345 0.85 272)");
    await page.click('[aria-label="Options for Spec"]');
    await page.waitFor(`!!document.querySelector('[role=dialog] [cmdk-item]')`);
    await park();
    await Bun.sleep(200);
    expect(await lit('[aria-label="Options for Spec"]')).toEqual([
      "1",
      "lch(18.634 1.075 272)",
      "lch(9.345 0.85 272)",
    ]);
    await page.key("Escape");
    await page.waitFor(`!document.querySelector('[role=dialog]')`);
    await page.eval(
      `document.querySelector('[data-comment] [aria-label="Comment options"]').scrollIntoView({block:'center'})`,
    );
    await page.hover("[data-comment] .comment-body");
    await page.click('[data-comment] [aria-label="Comment options"]');
    await page.waitFor(`!!document.querySelector('[role=dialog] [cmdk-item]')`);
    await park();
    await Bun.sleep(200);
    expect(
      await page.eval(
        `[...document.querySelectorAll('[data-comment] .comment-hover-action')].map(b=>[b.getAttribute('aria-label'),getComputedStyle(b).opacity,getComputedStyle(b).backgroundColor])`,
      ),
    ).toEqual([
      ["Add reaction", "1", "rgba(0, 0, 0, 0)"],
      ["Comment options", "1", "lch(22.347 1.525 272)"],
    ]);
    await page.key("Escape");
    await page.waitFor(`!document.querySelector('[role=dialog]')`);
  } finally {
    await page.close();
  }
});
