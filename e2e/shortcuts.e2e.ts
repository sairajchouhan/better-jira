import { afterAll, expect, test } from "bun:test";
import { open, stop, PREFS_KEY } from "./harness";
afterAll(stop);
const dialog = (label: string) => `[role=dialog][aria-label="${label}"]`;
test("Linear help uses Mod+/ and ? opens Help; reference searches supported bindings", async () => {
  const p = await open();
  try {
    await p.key("/", "meta");
    await p.waitFor(
      `!!document.querySelector('${dialog("Keyboard Shortcuts")}')`,
    );
    await p.type("due date");
    expect(
      await p.eval(
        `document.querySelector('${dialog("Keyboard Shortcuts")}').textContent`,
      ),
    ).toContain("Set due date");
    expect(
      await p.eval(
        `document.querySelector('${dialog("Keyboard Shortcuts")}').textContent`,
      ),
    ).not.toContain("Go to projects");
    await p.key("Escape");
    await p.key("?", "shift");
    await p.waitFor(`!!document.querySelector('${dialog("Help")}')`);
    await p.click("text=Keyboard shortcuts");
    await p.waitFor(
      `!!document.querySelector('${dialog("Keyboard Shortcuts")}')`,
    );
  } finally {
    await p.close();
  }
});
test("Linear G navigation sequences do not fire their final key's issue action", async () => {
  const p = await open();
  try {
    for (const [sequence, scope] of [
      ["gb", "Backlog"],
      ["ga", "Active"],
      ["ge", "All issues"],
    ]) {
      await p.keys(sequence!);
      await p.waitFor(
        `[...document.querySelectorAll('button[aria-pressed=true]')].some(b=>b.textContent==='${scope}')`,
      );
      expect(await p.eval(`!!document.querySelector('[role=dialog]')`)).toBe(
        false,
      );
    }
    await p.keys("gm");
    await p.waitFor(
      `document.querySelector('nav')?.textContent.includes('My issues')&&!document.querySelector('[role=dialog]')`,
    );
    await p.keys("oi");
    await p.waitFor(`!!document.querySelector('[cmdk-input]')`);
  } finally {
    await p.close();
  }
});
test("Letter sequences and issue commands do not run while typing", async () => {
  const p = await open();
  try {
    await p.key("c");
    await p.keys("gmspcl");
    expect(
      await p.eval(
        `document.querySelector('input[aria-label="Issue title"]').value`,
      ),
    ).toBe("gmspcl");
    expect(
      await p.eval(
        `document.querySelector('[role=dialog]').getAttribute('aria-label')`,
      ),
    ).toBe("Create issue");
  } finally {
    await p.close();
  }
});
test("Linear issue commands, relation sequences and copy chords work on a selected card", async () => {
  const p = await open();
  try {
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
        `document.querySelector('select[aria-label="Relation"]').value`,
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
    await p.key("r", "shift");
    await p.waitFor(`document.activeElement?.id==='summary'`);
  } finally {
    await p.close();
  }
});
test("Linear preview, open, layout, sidebar and display shortcuts preserve focus scopes", async () => {
  const p = await open();
  try {
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
    expect(
      await p.eval(`new URL(location.href).searchParams.get('view')`),
    ).toBe("side");
    await p.key("Escape");
    await p.eval("document.activeElement?.blur()");
    await p.key("Enter");
    await p.waitFor(`new URL(location.href).searchParams.get('view')==='page'`);
  } finally {
    await p.close();
  }
});
test("Editor bindings format text through TanStack and never toggle the board", async () => {
  const p = await open();
  try {
    await p.click('[data-key="TEST-1"]');
    await p.key("i", "ctrl", "shift");
    await p.waitFor(`document.activeElement?.id==='description'`);
    await p.key("a", "meta");
    await p.key("x", "meta", "shift");
    await p.waitFor(`!!document.querySelector('#description s')`);
    expect(
      await p.eval(
        `document.querySelector('[data-layout]')?.getAttribute('data-layout')`,
      ),
    ).toBe("board");
    await p.key("z", "meta");
    await p.waitFor(`!document.querySelector('#description s')`);
  } finally {
    await p.close();
  }
});

test("Keyboard reordering and workflow movement undo one action at a time", async () => {
  const p = await open();
  try {
    const order = `[...document.querySelectorAll('[data-key]')].filter(n=>n.getClientRects().length).map(n=>n.dataset.key)`;
    const before = await p.eval<string[]>(order);
    await p.key("j");
    await p.key("ArrowDown", "alt");
    await p.waitFor(`${order}.indexOf('TEST-1')>${order}.indexOf('TEST-2')`);
    await p.key("z", "meta");
    await p.waitFor(
      `JSON.stringify(${order})===${JSON.stringify(JSON.stringify(before))}`,
    );
    await p.key("ArrowRight", "alt");
    await p.waitFor(
      `document.querySelector('[data-key="TEST-1"]').closest('section').querySelector('h2').textContent.includes('Doing')`,
    );
    await p.key("z", "meta");
    await p.waitFor(
      `document.querySelector('[data-key="TEST-1"]').closest('section').querySelector('h2').textContent.includes('Todo')`,
    );
  } finally {
    await p.close();
  }
});
test("Find in view, due dates, self-assignment, subscription and keyboard deletion are usable end to end", async () => {
  const p = await open();
  try {
    await p.key("f", "meta");
    await p.waitFor(`document.activeElement?.id==='find-in-view'`);
    await p.type("Rich browser");
    await p.waitFor(`document.querySelectorAll('[data-key]').length===1`);
    await p.key("Escape");
    await p.key("j");
    await p.key("Enter");
    await p.waitFor(`!!document.getElementById('summary')`);
    await p.key("i");
    await p.waitFor(
      `document.getElementById('prop-assignee').textContent.includes('Audit user')`,
    );
    await p.key("d", "shift");
    await p.waitFor(`!!document.querySelector('input[aria-label="Due date"]')`);
    await p.click("text=Tomorrow");
    await p.click("text=Save");
    await p.waitFor(`!document.querySelector('input[aria-label="Due date"]')`);
    await p.key("d", "meta", "shift");
    await p.waitFor(
      `document.getElementById('prop-due').textContent.includes('Set due date')`,
    );
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
  } finally {
    await p.close();
  }
});
test("Editor Escape returns to issue navigation; Mod+Enter submits from the editor", async () => {
  const p = await open();
  try {
    await p.click('[data-key="TEST-1"]');
    await p.key("i", "ctrl", "shift");
    await p.waitFor(`document.activeElement?.id==='description'`);
    await p.key("Escape");
    await p.waitFor(`document.activeElement?.id!=='description'`);
    await p.key("m", "ctrl");
    await p.waitFor(`document.activeElement?.id==='comment'`);
    await p.type("Keyboard-only comment");
    await p.key("Enter", "meta");
    await p.waitFor(
      `document.querySelector('ol')?.textContent.includes('Keyboard-only comment')`,
    );
  } finally {
    await p.close();
  }
});
