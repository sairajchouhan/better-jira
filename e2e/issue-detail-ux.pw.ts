import { expect, test, fixture } from "./app";

// TEST-3 is TEST-2's sub-issue, with TEST-4 and TEST-5 under it.
const tree = `const read=fetch;window.fetch=async(...args)=>{const response=await read(...args);if(new URL(String(args[0]),location.href).pathname!=='/api/issues')return response;const issues=await response.json();issues.find(i=>i.key==='TEST-3').parent='TEST-2';for(const key of ['TEST-4','TEST-5'])issues.find(i=>i.key===key).parent='TEST-3';return Response.json(issues)}`;
// The next properties poll reports window.__remote as TEST-2's Jira summary.
const remote = `const get=fetch;window.fetch=async(...args)=>{if(window.__remote&&new URL(String(args[0]),location.href).pathname==='/api/properties')return Response.json({entries:{'TEST-2':{summary:window.__remote}},progress:{total:0,pending:0,completed:0,errors:0}});return get(...args)}`;
const favorites = `JSON.parse(localStorage.getItem("better-jira:favorites:v1:https://example.atlassian.net/audit-me")??"[]")`;
const statusTitle = (key: string) =>
  `(()=>{const n=document.querySelector('[aria-label="Change status for ${key}"]');return n&&(n.getAttribute('title')??n.dataset.title)})()`;

test("sub-issue rows: shortcuts act on the row, collapse persists, the composer resets, and relation pills stay in the app", async ({
  open,
}) => {
  const p = await open("?issue=TEST-2&view=page", { setup: tree });
  await p.waitFor(`!!document.querySelector('[data-sub-issue="TEST-5"]')`);

  await test.step("R1-D4: shortcuts over a sub-issue row act on that row, not the open parent", async () => {
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
  });

  await test.step("R1-D66: collapse persists across a reload", async () => {
    await p.click('[aria-label="Collapse sub-issues section"]');
    await p.reload();
    await p.waitFor(`!!document.querySelector('[aria-label="Expand sub-issues section"]')`);
    expect(await p.eval(`document.querySelectorAll('[data-sub-issue]').length`)).toBe(0);
    await p.click('[aria-label="Expand sub-issues section"]');
  });

  await test.step("R1-D67: row menu › Copy › Copy ID says what happened, like Issue options", async () => {
    await p.eval(
      `document.querySelector('[data-sub-issue="TEST-3"]').dispatchEvent(new MouseEvent('contextmenu',{bubbles:true,cancelable:true}))`,
    );
    await p.type("copy id");
    await p.click('[cmdk-item][data-value="Copy › Copy ID"]');
    await p.waitFor(`/Copied ID|Could not access the clipboard/.test(document.body.textContent)`);
  });

  await test.step("R1-D68: Linear's sub-issue composer has named chips and Cancel, and the next draft starts from the defaults", async () => {
    await p.click('[aria-label="Create new sub-issue"]');
    await p.click('[aria-label^="Sub-issue priority"]');
    await p.click(
      '[role="dialog"][aria-label="Set priority"] [cmdk-item][data-value="High"]',
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
  });

  await test.step("R1-D69–D70: relation pills open in the app (⌘-click too); removing one keeps focus in the issue", async () => {
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
    expect(new URL(href).origin).toBe(new URL(fixture.url).origin);
    expect(new URL(href).searchParams.get("issue")).toBe("TEST-1");
    await p.click('[data-relation="related:TEST-1"] button');
    await p.waitFor(`!document.querySelector('[data-relation="related:TEST-1"]')`);
    await p.waitFor(`document.activeElement?.id==='issue-options'`);
  });

  await test.step("BJ-52: a relation pill's context menu changes the relation's kind and removes it", async () => {
    const menu = (kind: string) =>
      p.eval(
        `(()=>{const n=document.querySelector('[data-relation="${kind}:TEST-1"] a'),r=n.getBoundingClientRect();n.dispatchEvent(new MouseEvent('contextmenu',{bubbles:true,clientX:r.x+20,clientY:r.y+10}))})()`,
      );
    await p.eval("document.activeElement?.blur()");
    await p.keys("mr");
    await p.type("TEST-1");
    await p.waitFor(`!!document.querySelector('[cmdk-item][data-value="TEST-1"]')`);
    await p.key("Enter");
    await p.waitFor(`!!document.querySelector('[data-relation="related:TEST-1"] a')`);
    await menu("related");
    await p.hover('[role="dialog"][aria-label="Relation options"] [cmdk-item][data-value="Change to…"]');
    await p.click('[role="dialog"][aria-label="Change to…"] [cmdk-item][data-value="Blocked by"]');
    await p.waitFor(
      `!!document.querySelector('[data-relation="blocked:TEST-1"]')&&!document.querySelector('[data-relation="related:TEST-1"]')`,
    );
    await menu("blocked");
    await p.click('[role="dialog"][aria-label="Relation options"] [cmdk-item][data-value="Remove relation"]');
    await p.waitFor(`!document.querySelector('[data-relation$=":TEST-1"]')`);
  });

  await test.step("BJ-53: the relations menu peeks a candidate with → and opens its actions with ⌥↵", async () => {
    await p.eval("document.activeElement?.blur()");
    await p.keys("mr");
    await p.type("TEST-1");
    await p.waitFor(`document.querySelector('[cmdk-item][data-selected=true]')?.dataset.value==="TEST-1"`);
    await p.key("ArrowRight");
    await p.waitFor(`document.querySelector('[aria-label="Quick look"]')?.textContent.includes("TEST-1")`);
    await p.key("ArrowLeft");
    await p.waitFor(`!document.querySelector('[aria-label="Quick look"]')`);
    await p.key("Enter", "alt");
    await p.waitFor(
      `!!document.querySelector('[role="dialog"][aria-label="Issue options"]')&&!document.querySelector('[role="dialog"][aria-label="Issue relations"]')`,
    );
    expect(await p.eval(`!!document.querySelector('[data-relation$=":TEST-1"]')`)).toBe(false);
    await p.key("Escape");
  });
});

test("editing an issue's fields: pickers close and apply, Jira renames wait for the draft, and Tab leaves the composer", async ({
  open,
}) => {
  const p = await open("?issue=TEST-2&view=page", { setup: remote });
  await p.waitFor(`!!document.getElementById('summary')`);

  await test.step("R1-D44, R1-D45, R1-D63: label create closes, Shift+D is a click-to-apply menu, and Custom… › Back keeps the presets", async () => {
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
    // Linear reads near due dates relatively (R2-issue-fields-D7).
    expect(await p.waitFor<string>(`document.getElementById('prop-due')?.textContent`)).toBe(
      "Tomorrow",
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
    await p.key("Escape");
    await p.waitFor(`!document.querySelector('[role="dialog"]')`);
  });

  await test.step("R1-D23, R1-D28: a Jira rename never replaces a title being typed, and an empty title comes back", async () => {
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
  });

  await test.step("R1-D46: Tab leaves the composer description for the property pills", async () => {
    await p.goto("");
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
  });
});

test("R1-D4, R1-D64: with Jira writes, delete asks in the app, names the row, and counts the subtasks Jira deletes too", async ({
  open,
}) => {
  await fixture.reset({ writable: true, subtask: true });
  const p = await open("?issue=TEST-5&view=page");
  await p.waitFor(`!!document.querySelector('[data-sub-issue="TEST-6"]')`, 15000);
  const dialog = `document.querySelector('[role="dialog"][aria-label^="Delete"]')`;

  await test.step("deleting the open issue names it and counts its sub-issue", async () => {
    await p.eval("document.activeElement?.blur()");
    await p.key("Backspace", "meta");
    expect(await p.waitFor<string>(`${dialog}?.textContent`)).toContain(
      `Delete "TEST-5 ‒ Browser fixture 5"?This also deletes its 1 sub-issue (TEST-6).`,
    );
    await p.key("Escape");
    await p.waitFor(`!${dialog}`);
  });

  await test.step("deleting a hovered sub-issue row names that row; nothing reaches Jira", async () => {
    await p.hover('[data-sub-issue="TEST-6"]');
    await p.key("Backspace", "meta");
    expect(await p.waitFor<string>(`${dialog}?.getAttribute('aria-label')`)).toBe(
      `Delete "TEST-6 ‒ Browser fixture 6"?`,
    );
    await p.key("Escape");
    expect((await fixture.log()).writes.length).toBe(0);
  });
  await test.step("BJ-4: Enter confirms only after the delete dialog takes focus", async () => {
    await p.hover('[data-sub-issue="TEST-6"]');
    await p.key("Backspace", "meta");
    await p.waitFor(
      `${dialog}?.contains(document.activeElement) && document.activeElement?.textContent === 'Delete'`,
    );
    expect((await fixture.log()).writes.length).toBe(0);
    await p.key("Enter");
    await p.waitFor(`!${dialog} && !document.querySelector('[data-sub-issue="TEST-6"]')`);
    await expect
      .poll(async () => (await fixture.log()).writes)
      .toContainEqual({ key: "TEST-6", ops: [{ op: "delete" }] });
  });
});
