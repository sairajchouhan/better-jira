import { afterAll, expect, test } from "bun:test";
import { APP, open, stop } from "./harness";
afterAll(stop);

// TEST-3 is TEST-2's sub-issue, with TEST-4 and TEST-5 under it.
const tree = `const read=fetch;window.fetch=async(...args)=>{const response=await read(...args);if(new URL(String(args[0]),location.href).pathname!=='/api/issues')return response;const issues=await response.json();issues.find(i=>i.key==='TEST-3').parent='TEST-2';for(const key of ['TEST-4','TEST-5'])issues.find(i=>i.key===key).parent='TEST-3';return Response.json(issues)}`;
const favorites = `JSON.parse(localStorage.getItem("better-jira:favorites:v1:https://example.atlassian.net/audit-me")??"[]")`;
const statusTitle = (key: string) =>
  `(()=>{const n=document.querySelector('[aria-label="Change status for ${key}"]');return n&&(n.getAttribute('title')??n.dataset.title)})()`;

test("R1-D4: shortcuts over a sub-issue row act on that row, not the open parent", async () => {
  const p = await open("?issue=TEST-2&view=page", { setup: tree });
  try {
    await p.waitFor(`!!document.querySelector('[data-sub-issue="TEST-5"]')`);
    await p.eval("document.activeElement?.blur()");
    await p.hover('[data-sub-issue="TEST-3"]');
    await p.key("f", "alt");
    await p.waitFor(`${favorites}.includes("TEST-3")`);
    expect(await p.eval(`${favorites}.includes("TEST-2")`)).toBe(false);
    // A menu shortcut opens beside the row and changes the row's issue.
    await p.hover('[data-sub-issue="TEST-4"]');
    await p.key("s");
    await p.click('[role="dialog"][aria-label="Change status"] [cmdk-item][data-value="Review"]');
    await p.waitFor(`${statusTitle("TEST-4")}==='Review'`);
    expect(await p.eval(`document.getElementById('prop-status').textContent`)).toContain("Todo");
    // ⌘⌫ deletes the hovered row (local site: no confirmation) and the parent stays open.
    await p.hover('[data-sub-issue="TEST-5"]');
    await p.key("Backspace", "meta");
    await p.waitFor(`!document.querySelector('[data-sub-issue="TEST-5"]')`);
    expect(await p.eval(`document.getElementById('summary')?.value`)).toBe("Browser fixture 2");
  } finally {
    await p.close();
  }
});

test("R1-D4, R1-D64: with Jira writes, delete asks in the app, names the row, and counts the subtasks Jira deletes too", async () => {
  const p = await open("?issue=TEST-5&view=page");
  await fetch(`${APP}__fixture`, {
    method: "POST",
    body: JSON.stringify({ writable: true, subtask: true }),
  });
  try {
    await p.eval(`window.__stale=true`);
    await p.cmd("Page.reload");
    await p.waitFor(
      `!window.__stale&&!!document.querySelector('[data-sub-issue="TEST-6"]')`,
      15000,
    );
    await p.eval("document.activeElement?.blur()");
    const dialog = `document.querySelector('[role="dialog"][aria-label^="Delete"]')`;
    await p.key("Backspace", "meta");
    expect(await p.waitFor<string>(`${dialog}?.textContent`)).toContain(
      `Delete "TEST-5 ‒ Browser fixture 5"?This also deletes its 1 sub-issue (TEST-6).`,
    );
    await p.key("Escape");
    await p.waitFor(`!${dialog}`);
    await p.hover('[data-sub-issue="TEST-6"]');
    await p.key("Backspace", "meta");
    expect(await p.waitFor<string>(`${dialog}?.getAttribute('aria-label')`)).toBe(
      `Delete "TEST-6 ‒ Browser fixture 6"?`,
    );
    await p.key("Escape");
    expect(
      await p.eval(`(async()=>(await (await fetch('/__fixture')).json()).writes.length)()`),
    ).toBe(0);
  } finally {
    await fetch(`${APP}__fixture`, { method: "POST", body: "{}" });
    await p.close();
  }
});

test("R1-D23, R1-D28: a Jira rename never replaces a title being typed, and an empty title comes back", async () => {
  // The next properties poll reports window.__remote as TEST-2's Jira summary.
  const remote = `const get=fetch;window.fetch=async(...args)=>{if(window.__remote&&new URL(String(args[0]),location.href).pathname==='/api/properties')return Response.json({entries:{'TEST-2':{summary:window.__remote}},progress:{total:0,pending:0,completed:0,errors:0}});return get(...args)}`;
  const p = await open("?issue=TEST-2&view=page", { setup: remote });
  try {
    await p.click("#summary");
    await p.key("a", "meta");
    await p.type("my draft");
    await p.eval(
      `window.__remote='Renamed in Jira';queryClient.refetchQueries({queryKey:['properties']})`,
    );
    await p.waitFor(
      `document.querySelector('[data-crumb-issue]')?.textContent.includes('Renamed in Jira')`,
    );
    expect(
      await p.eval(`[document.activeElement.id,document.getElementById('summary').value]`),
    ).toEqual(["summary", "my draft"]);
    await p.key("Escape");
    await p.waitFor(`document.getElementById('summary').value==='Renamed in Jira'`);
    await p.click("#summary");
    await p.key("a", "meta");
    await p.key("Backspace");
    await p.key("Enter");
    expect(await p.eval(`document.getElementById('summary').value`)).toBe("Renamed in Jira");
  } finally {
    await p.close();
  }
});

test("R1-D44, R1-D45, R1-D63: label create closes, Shift+D is a click-to-apply menu, and Custom… › Back keeps the presets", async () => {
  const p = await open("?issue=TEST-2&view=page");
  try {
    await p.waitFor(`!!document.getElementById('summary')`);
    await p.eval("document.activeElement?.blur()");
    await p.key("l");
    await p.waitFor(`!!document.querySelector('[role="dialog"][aria-label="Change labels"]')`);
    await p.type("brand-new");
    await p.key("Enter");
    await p.waitFor(`!document.querySelector('[role="dialog"][aria-label="Change labels"]')`);
    expect(
      await p.eval(`[...document.querySelectorAll('[data-label-chip]')].map(n=>n.textContent)`),
    ).toContain("brand-new");
    await p.eval("document.activeElement?.blur()");
    await p.key("d", "shift");
    await p.click('[role="dialog"][aria-label="Due date"] [cmdk-item][data-value="Tomorrow"]');
    await p.waitFor(`!document.querySelector('[role="dialog"][aria-label="Due date"]')`);
    const tomorrow = await p.eval<string>(
      `(()=>{const d=new Date();d.setDate(d.getDate()+1);return d.toLocaleDateString('en',{month:'short',day:'numeric'})})()`,
    );
    expect(await p.waitFor<string>(`document.getElementById('prop-due')?.textContent`)).toBe(
      tomorrow,
    );
    await p.eval("document.activeElement?.blur()");
    await p.key("h", "shift");
    await p.click('[role="dialog"][aria-label="Remind me"] [cmdk-item][data-value="Custom…"]');
    await p.eval(
      `const i=document.querySelector('[aria-label="Custom reminder time"]');Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(i,'2020-01-01T10:00');i.dispatchEvent(new Event('input',{bubbles:true}))`,
    );
    await p.click("text=Back");
    await p.waitFor(
      `[...document.querySelectorAll('[role="dialog"][aria-label="Remind me"] [cmdk-item]')].some(n=>n.dataset.value==='An hour from now')`,
    );
  } finally {
    await p.close();
  }
});

test("R1-D46: Tab leaves the composer description for the property pills", async () => {
  const p = await open();
  try {
    await p.key("c");
    await p.waitFor(
      `document.activeElement?.getAttribute('aria-label')==='Issue title'&&!!document.getElementById('create-description')`,
    );
    await p.key("Tab");
    await p.waitFor(`document.activeElement?.id==='create-description'`);
    await p.key("Tab");
    expect(
      await p.eval(
        `[!!document.activeElement.closest('.rich-editor'),!!document.activeElement.closest('[aria-label="Create issue"]')]`,
      ),
    ).toEqual([false, true]);
  } finally {
    await p.close();
  }
});

test("R1-D66–D70: collapse persists, row Copy confirms, the sub-issue composer resets, and relation pills link and refocus in the app", async () => {
  const p = await open("?issue=TEST-2&view=page", { setup: tree });
  try {
    await p.click('[aria-label="Collapse sub-issues section"]');
    await p.reload();
    await p.waitFor(`!!document.querySelector('[aria-label="Expand sub-issues section"]')`);
    expect(await p.eval(`document.querySelectorAll('[data-sub-issue]').length`)).toBe(0);
    await p.click('[aria-label="Expand sub-issues section"]');
    // Row menu › Copy › Copy ID says what happened, like Issue options.
    await p.eval(
      `document.querySelector('[data-sub-issue="TEST-3"]').dispatchEvent(new MouseEvent('contextmenu',{bubbles:true,cancelable:true}))`,
    );
    await p.type("copy id");
    await p.click('[cmdk-item][data-value="Copy › Copy ID"]');
    await p.waitFor(`/Copied ID|Could not access the clipboard/.test(document.body.textContent)`);
    // Linear's composer: named chips, Cancel, and the next draft starts from the defaults.
    await p.click('[aria-label="Create new sub-issue"]');
    await p.click('[aria-label^="Sub-issue priority"]');
    await p.click(
      '[role="dialog"][aria-label="Change sub-issue priority"] [cmdk-item][data-value="High"]',
    );
    expect(
      await p.eval(`document.querySelector('[aria-label^="Sub-issue priority"]').textContent`),
    ).toBe("High");
    await p.click('[aria-label="Sub-issue title"]');
    await p.type("Reset after create");
    await p.key("Enter", "meta");
    await p.waitFor(
      `document.querySelector('[data-sub-issues]').textContent.includes('Reset after create')`,
    );
    expect(
      await p.eval(
        `[document.querySelector('[aria-label^="Sub-issue priority"]').textContent,document.querySelector('[aria-label="Create sub-issue"] .rich-editor-actions button').textContent]`,
      ),
    ).toEqual(["Priority", "Cancel"]);
    await p.click('[aria-label="Create sub-issue"] .rich-editor-actions button');
    // Relation pills open in the app (⌘-click too); removing one keeps focus in the issue.
    await p.hover("#summary");
    await p.eval("document.activeElement?.blur()");
    await p.keys("mr");
    await p.waitFor(`document.activeElement?.getAttribute('aria-label')==='Find related issue'`);
    await p.type("TEST-1");
    await p.waitFor(`!!document.querySelector('[cmdk-item][data-value="TEST-1"]')`);
    await p.key("Enter");
    const href = await p.waitFor<string>(
      `document.querySelector('[data-relation="related:TEST-1"] a')?.href`,
    );
    expect(new URL(href).origin).toBe(new URL(APP).origin);
    expect(new URL(href).searchParams.get("issue")).toBe("TEST-1");
    await p.click('[data-relation="related:TEST-1"] button');
    await p.waitFor(`!document.querySelector('[data-relation="related:TEST-1"]')`);
    await p.waitFor(`document.activeElement?.id==='issue-options'`);
  } finally {
    await p.close();
  }
});
