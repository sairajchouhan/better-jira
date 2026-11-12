import { expect, test, sleep, type App as Page, shownView } from "./app";

const dialog = (label: string) => `[role=dialog][aria-label="${label}"]`;
/** Ctrl+Shift+I focuses the description, and the app keeps re-focusing it for a few frames (an issue opening can remount the
 *  editor) until it drops its focus request. A key pressed before then is undone by the next re-focus, so wait for both. */
async function focusDescription(p: Page) {
  await p.key("i", "ctrl", "shift");
  await p.waitFor(
    `document.activeElement?.id==='description'&&!machines.ui.getSnapshot().context.editDesc`,
  );
}

test("keyboard help, Linear sequences, and no shortcuts while typing", async ({ open }) => {
  const p = await open();
  await test.step("Linear help uses Mod+/ and ? opens Help; reference searches supported bindings", async () => {
    await p.key("/", "meta");
    await p.waitFor(`!!document.querySelector('${dialog("Keyboard Shortcuts")}')`);
    const panel = `document.querySelector('${dialog("Keyboard Shortcuts")}')`;
    // 6.7: Linear's right-side panel: 360px, 12px inside the top, right and bottom edges, General first.
    await p.waitFor(`getComputedStyle(${panel}).opacity==='1'&&${panel}.getBoundingClientRect().left+360+12===innerWidth`);
    expect(
      await p.eval(`(({top,bottom,width})=>[top,innerHeight-bottom,width])(${panel}.getBoundingClientRect())`),
    ).toEqual([12, 12, 360]);
    expect(await p.eval(`${panel}.querySelector('section h2').textContent`)).toBe("General");
    expect(await p.eval(`[...${panel}.querySelectorAll('section:first-child dt')].slice(0,3).map(n=>n.textContent)`)).toEqual([
      "Open command menu",
      "Back / clear selection",
      "Open search",
    ]);
    await p.type("due date");
    const text = `${panel}.textContent`;
    expect(await p.eval(text)).toContain("Set due date");
    expect(await p.eval(text)).not.toContain("Go to projects");
    // Escape clears the search first, then closes the panel.
    await p.key("Escape");
    await p.waitFor(`${panel}?.querySelector('input').value===''`);
    await p.key("Escape");
    await p.waitFor(`!${panel}`);
    await p.key("?", "shift");
    await p.waitFor(`!!document.querySelector('${dialog("Help")}')`);
    await p.click(`[cmdk-item][data-value="Keyboard shortcuts"]`);
    await p.waitFor(`!!document.querySelector('${dialog("Keyboard Shortcuts")}')`);
    await p.key("Escape");
    await p.waitFor(`!document.querySelector('[role=dialog]')`);
  });
  await test.step("Linear G navigation sequences do not fire their final key's issue action", async () => {
    for (const [sequence, scope] of [
      ["gb", "Backlog"],
      ["ga", "Active"],
      ["ge", "All issues"],
    ]) {
      await p.keys(sequence!);
      await p.waitFor(
        `[...document.querySelectorAll('button[aria-pressed=true]')].some(b=>b.textContent==='${scope}')`,
      );
      expect(await p.eval(`!!document.querySelector('[role=dialog]')`)).toBe(false);
    }
    await p.keys("gm");
    await p.waitFor(
      `document.querySelector('nav')?.textContent.includes('My issues')&&!document.querySelector('[role=dialog]')`,
    );
    await p.keys("oi");
    await p.waitFor(`!!document.querySelector('[cmdk-input]')`);
    await p.key("Escape");
    await p.waitFor(`!document.querySelector('[cmdk-input]')`);
  });
  await test.step("Letter sequences and issue commands do not run while typing", async () => {
    await p.key("c");
    await p.keys("gmspcl");
    expect(await p.eval(`document.querySelector('input[aria-label="Issue title"]').value`)).toBe(
      "gmspcl",
    );
    expect(await p.eval(`document.querySelector('[role=dialog]').getAttribute('aria-label')`)).toBe(
      "Create issue",
    );
  });
});

test("a selected card: issue commands, copy chords, layout and focus scopes", async ({ open }) => {
  const p = await open();
  await test.step("Linear preview, open, layout, sidebar and display shortcuts preserve focus scopes", async () => {
    await p.key("b", "meta");
    await p.waitFor(`!!document.querySelector('[data-layout=list]')`);
    await p.key("b", "meta");
    await p.waitFor(`!!document.querySelector('[data-layout=board]')`);
    await p.key("[");
    await p.waitFor(`!document.querySelector('nav[aria-label="Main navigation"]')`);
    await p.key("[");
    await p.waitFor(`!!document.querySelector('nav[aria-label="Main navigation"]')`);
    await p.key("v", "shift");
    await p.waitFor(`!!document.querySelector('${dialog("Display options")}')`);
    await p.key("Escape");
    await p.eval("document.activeElement?.blur()");
    await p.key("j");
    await p.key(" ");
    await p.waitFor(`!!document.querySelector('#summary')`);
    expect(await p.eval(`${shownView}`)).toBe("side");
    await p.key("Escape");
    await p.eval("document.activeElement?.blur()");
    await p.key("Enter");
    await p.waitFor(`${shownView}==='page'`);
  });
  await test.step("Linear issue commands, relation sequences and copy chords work on a selected card", async () => {
    await p.goto("");
    await p.key("j");
    for (const [key, mods, label] of [
      ["a", [], "Assign issue"],
      ["s", [], "Change status"],
      ["p", [], "Set priority"],
      ["l", [], "Change labels"],
      ["d", ["shift"], "Due date"],
      ["p", ["shift"], "Change project"],
      ["m", ["shift"], "Set milestone"],
    ] as const) {
      await p.key(key, ...mods);
      await p.waitFor(`!!document.querySelector('${dialog(label)}')`);
      await p.key("Escape");
      await p.eval("document.activeElement?.blur()");
    }
    await p.keys("mb");
    await p.waitFor(`!!document.querySelector('${dialog("Issue relations")}')`);
    expect(
      await p.eval(
        `document.querySelector('[role="dialog"][aria-label="Issue relations"] [data-kind]').dataset.kind`,
      ),
    ).toBe("blocked");
    await p.key("Escape");
    await p.eval("document.activeElement?.blur()");
    await p.eval(
      `window.copied=[];navigator.clipboard.writeText=async text=>{window.copied.push(text)}`,
    );
    await p.key(".", "meta");
    await p.waitFor(`window.copied.length===1`);
    expect(await p.eval("window.copied[0]")).toMatch(/^TEST-/);
    await p.key(",", "meta", "shift");
    await p.waitFor(`window.copied.length===2`);
    expect(await p.eval("window.copied[1]")).toContain(
      "https://example.atlassian.net/browse/TEST-",
    );
    // ⌘C copies the issue title as a link, as in Linear, but leaves a text selection to the browser.
    await p.key("c", "meta");
    await p.waitFor(`window.copied.length===3`);
    expect(await p.eval("window.copied[2]")).toMatch(
      /^\[TEST-\d+ .+\]\(https:\/\/example\.atlassian\.net\/browse\/TEST-\d+\)$/,
    );
    await p.eval(
      `(()=>{const walker=document.createTreeWalker(document.querySelector('main')??document.body,NodeFilter.SHOW_TEXT,{acceptNode:n=>n.textContent.trim().length>3&&!n.parentElement.closest('[contenteditable],input,textarea')?1:3});const node=walker.nextNode();const range=document.createRange();range.selectNodeContents(node);getSelection().removeAllRanges();getSelection().addRange(range);})()`,
    );
    await p.key("c", "meta");
    await sleep(200); // nothing is copied in this window
    expect(await p.eval("window.copied.length")).toBe(3);
    await p.eval("getSelection().removeAllRanges()");
    await p.key("r", "shift");
    await p.waitFor(`document.activeElement?.id==='summary'`);
  });
});

test("undo, find in view and issue keys, end to end", async ({ open }) => {
  const p = await open();
  await test.step("Keyboard reordering and workflow movement undo one action at a time", async () => {
    const order = `[...document.querySelectorAll('[data-key]')].filter(n=>n.getClientRects().length).map(n=>n.dataset.key)`;
    const before = await p.eval<string[]>(order);
    await p.key("j");
    await p.key("ArrowDown", "alt");
    await p.waitFor(`${order}.indexOf('TEST-1')>${order}.indexOf('TEST-2')`);
    await p.key("z", "meta");
    await p.waitFor(`JSON.stringify(${order})===${JSON.stringify(JSON.stringify(before))}`);
    await p.key("ArrowRight", "alt");
    await p.waitFor(
      `document.querySelector('[data-key="TEST-1"]').closest('section').querySelector('h2').textContent.includes('Doing')`,
    );
    await p.key("z", "meta");
    await p.waitFor(
      `document.querySelector('[data-key="TEST-1"]').closest('section').querySelector('h2').textContent.includes('Todo')`,
    );
  });
  await test.step("Find in view, due dates, self-assignment, subscription and keyboard deletion are usable end to end", async () => {
    await p.goto("");
    await p.key("f", "meta");
    await p.waitFor(`document.activeElement?.id==='find-in-view'`);
    await p.type("Rich browser");
    await p.waitFor(`document.querySelectorAll('[data-key]').length===1`);
    await p.key("Escape");
    await p.key("j");
    await p.key("Enter");
    await p.waitFor(`!!document.getElementById('summary')`);
    await p.key("i");
    await p.waitFor(`document.getElementById('prop-assignee').textContent.includes('Audit user')`);
    await p.key("d", "shift");
    // Linear's due menu: a click on a preset applies it at once.
    await p.click('[role="dialog"][aria-label="Due date"] [cmdk-item][data-value="Tomorrow"]');
    await p.waitFor(`!document.querySelector('[role="dialog"][aria-label="Due date"]')`);
    await p.waitFor(`!!document.getElementById('prop-due')`);
    await p.key("d", "meta", "shift");
    await p.waitFor(`!document.getElementById('prop-due')`);
    await p.key("s", "shift");
    await p.waitFor(
      `[...document.querySelectorAll('button')].some(b=>b.textContent==='Unsubscribe')`,
    );
    await p.key("Backspace", "meta");
    await p.waitFor(
      `!document.getElementById('summary')&&!document.querySelector('[data-key="TEST-1"]')`,
    );
    await p.key("z", "meta");
    await p.waitFor(`!!document.querySelector('[data-key="TEST-1"]')`);
  });
});

test("the description editor's keys: formatting, Escape and Mod+Enter", async ({ open }) => {
  const p = await open();
  await p.click('[data-key="TEST-1"]');
  await test.step("Editor bindings format text through TanStack and never toggle the board", async () => {
    await focusDescription(p);
    await p.key("a", "meta");
    await p.key("x", "meta", "shift");
    await p.waitFor(`!!document.querySelector('#description s')`);
    expect(
      await p.eval(`document.querySelector('[data-layout]')?.getAttribute('data-layout')`),
    ).toBe("board");
    await p.key("z", "meta");
    await p.waitFor(`!document.querySelector('#description s')`);
  });
  await test.step("Editor Escape returns to issue navigation; Mod+Enter submits from the editor", async () => {
    await focusDescription(p);
    await p.key("Escape");
    await p.waitFor(`document.activeElement?.id!=='description'`);
    await p.key("m", "ctrl");
    await p.waitFor(`document.activeElement?.id==='comment'`);
    await p.type("Keyboard-only comment");
    await p.key("Enter", "meta");
    await p.waitFor(`document.querySelector('ol')?.textContent.includes('Keyboard-only comment')`);
  });
});
