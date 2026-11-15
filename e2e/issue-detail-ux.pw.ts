import { expect, test, fixture, issueOfHref } from "./app";

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
    await p.click('[role="dialog"][aria-label="Change status"] [role^=menuitem][data-value="Review"]');
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
    await p.click('[role^=menuitem][data-value="Copy › Copy ID"]');
    await p.waitFor(`/"TEST-3" copied to clipboard|Could not access the clipboard/.test(document.body.textContent)`);
  });

  await test.step("R1-D68: Linear's sub-issue composer has named chips and Cancel; ⌘↵ carries the last one's properties, a reopen or Shift-click starts from the defaults", async () => {
    const chips = `[document.querySelector('[aria-label^="Sub-issue priority"]').textContent,document.querySelector('[aria-label="Create sub-issue"] .rich-editor-actions button').textContent]`;
    await p.click('[aria-label="Create new sub-issue"]');
    await p.click('[aria-label^="Sub-issue priority"]');
    await p.click(
      '[role="dialog"][aria-label="Set priority"] [role^=menuitem][data-value="High"]',
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
    // R3 G13: ⌘↵ starts the next draft from the sub-issue it created (Linear's `xm`: no Shift → `Cm(team,user,parent,previous)`,
    // and `createSubIssue` copies the previous issue's priority).
    expect(await p.eval(chips)).toEqual(["High", "Cancel"]);
    // Closing the empty draft and reopening starts from the defaults: the parent's priority (TEST-2 is Low), as Linear's
    // Issue.create with a parent (`priority = priority || parent.priority`, R3-create-D10).
    await p.click('[aria-label="Create sub-issue"] .rich-editor-actions button');
    await p.click('[aria-label="Create new sub-issue"]');
    expect(await p.eval(chips)).toEqual(["Low", "Cancel"]);
    // A Shift-click on Create starts from the defaults too (`xm` reads the save event's `shiftKey`).
    await p.click('[aria-label^="Sub-issue priority"]');
    await p.click('[role="dialog"][aria-label="Set priority"] [role^=menuitem][data-value="High"]');
    await p.click('[aria-label="Sub-issue title"]');
    await p.type("Shift-click create");
    await p.eval(
      `document.querySelector('[aria-label="Create sub-issue"] .rich-editor-submit').dispatchEvent(new MouseEvent('click',{bubbles:true,cancelable:true,shiftKey:true}))`,
    );
    await p.waitFor(
      `document.querySelector('[data-sub-issues]').textContent.includes('Shift-click create')`,
    );
    expect(await p.eval(chips)).toEqual(["Low", "Cancel"]);
    await p.click('[aria-label="Create sub-issue"] .rich-editor-actions button');
  });

  await test.step("R1-D69–D70: relation pills open in the app (⌘-click too); removing one keeps focus in the issue", async () => {
    await p.hover("#summary");
    await p.eval("document.activeElement?.blur()");
    await p.keys("mr");
    await p.waitFor(`document.activeElement?.getAttribute('aria-label')==='Find related issue'`);
    await p.type("TEST-1");
    await p.waitFor(`!!document.querySelector('[role^=menuitem][data-value="TEST-1"]')`);
    await p.key("Enter");
    const href = await p.waitFor<string>(
      `document.querySelector('[data-relation="related:TEST-1"] a')?.href`,
    );
    expect(new URL(href).origin).toBe(new URL(fixture.url).origin);
    expect(issueOfHref(href)).toBe("TEST-1");
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
    await p.waitFor(`!!document.querySelector('[role^=menuitem][data-value="TEST-1"]')`);
    await p.key("Enter");
    await p.waitFor(`!!document.querySelector('[data-relation="related:TEST-1"] a')`);
    await menu("related");
    await p.hover('[role="dialog"][aria-label="Relation options"] [role^=menuitem][data-value="Change to…"]');
    await p.click('[role="dialog"][aria-label="Change to…"] [role^=menuitem][data-value="Blocked by"]');
    await p.waitFor(
      `!!document.querySelector('[data-relation="blocked:TEST-1"]')&&!document.querySelector('[data-relation="related:TEST-1"]')`,
    );
    await menu("blocked");
    await p.click('[role="dialog"][aria-label="Relation options"] [role^=menuitem][data-value="Remove relation"]');
    await p.waitFor(`!document.querySelector('[data-relation$=":TEST-1"]')`);
  });

  await test.step("BJ-53: the relations menu peeks a candidate with → and opens its actions with ⌥↵", async () => {
    await p.eval("document.activeElement?.blur()");
    await p.keys("mr");
    await p.type("TEST-1");
    await p.waitFor(`document.querySelector('[role^=menuitem][data-focused]')?.dataset.value==="TEST-1"`);
    await p.key("ArrowRight");
    await p.waitFor(`document.querySelector('[aria-label="Quick look"]')?.textContent.includes("TEST-1")`);
    await p.key("ArrowLeft");
    await p.waitFor(`!document.querySelector('[aria-label="Quick look"]')`);
    // A nested menu over the relations menu, like Linear's: Esc comes back to the relations search.
    await p.key("Enter", "alt");
    await p.waitFor(
      `!!document.querySelector('[role="dialog"][aria-label="More actions"]')&&!!document.querySelector('[role="dialog"][aria-label="Issue relations"]')`,
    );
    expect(await p.eval(`!!document.querySelector('[data-relation$=":TEST-1"]')`)).toBe(false);
    await p.key("Escape");
    await p.waitFor(
      `!document.querySelector('[role="dialog"][aria-label="More actions"]')&&document.activeElement?.closest('[role="dialog"]')?.getAttribute("aria-label")==="Issue relations"`,
    );
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
    await p.click('[role="dialog"][aria-label="Due date"] [role^=menuitem][data-value="Tomorrow"]');
    await p.waitFor(`!document.querySelector('[role="dialog"][aria-label="Due date"]')`);
    // Linear reads near due dates relatively (R2-issue-fields-D7).
    expect(await p.waitFor<string>(`document.getElementById('prop-due')?.textContent`)).toBe(
      "Tomorrow",
    );
    await p.eval("document.activeElement?.blur()");
    await p.key("h", "shift");
    await p.click('[role="dialog"][aria-label="Remind me"] [role^=menuitem][data-value="Custom…"]');
    await p.eval(
      `const i=document.querySelector('[aria-label="Custom reminder time"]');Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(i,'2020-01-01T10:00');i.dispatchEvent(new Event('input',{bubbles:true}))`,
    );
    await p.click("text=Back");
    await p.waitFor(
      `[...document.querySelectorAll('[role="dialog"][aria-label="Remind me"] [role^=menuitem]')].some(n=>n.dataset.value==='An hour from now')`,
    );
    await p.key("Escape");
    await p.waitFor(`!document.querySelector('[role="dialog"]')`);
  });

  await test.step("R1-D23, R1-D28, BJ-258, BJ-259: a Jira rename never replaces a title being typed, Escape keeps the draft, and an empty title comes back with Linear's toast", async () => {
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
    // BJ-258: Escape leaves the title and its blur saves the draft (Linear's shared-editor Escape: qL, else KL); the
    // page stays.
    await p.key("Escape");
    await p.waitFor(`document.activeElement?.id!=='summary'`);
    expect(await p.eval(`document.getElementById('summary').value`)).toBe("my draft");
    expect(await p.eval(`location.search.includes('view=page')`)).toBe(true);
    await p.click("#summary");
    await p.key("a", "meta");
    await p.key("Backspace");
    // Enter now hands the caret to the description (C14); leaving the empty title brings it back, and BJ-259 says why
    // with Linear's error toast (IssueDetailsPaneSidebar Oh d).
    await p.key("Enter");
    await p.waitFor(`document.getElementById('summary').value==='my draft'`);
    await p.waitFor(
      `[...document.querySelectorAll('[data-toast]')].some(t=>t.textContent.includes('Title cannot be empty')&&t.textContent.includes('Reverted the title to its previous value'))`,
    );
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

test("C14: Enter in the title moves the caret into the description, as Linear's title does", async ({ open }) => {
  const p = await open("?issue=TEST-2&view=page");
  await p.waitFor(`!!document.querySelector('#description h2')`);
  const title = `document.getElementById('summary').value`;
  const caretAt = (pos: "end" | number) =>
    p.eval(`const t=document.getElementById('summary');t.focus();const at=${pos === "end" ? "t.value.length" : pos};t.setSelectionRange(at,at)`);
  /** [focused id, the first block's tag, its text, the caret's offset, whether the caret is in that first block]. */
  const first = `(()=>{const d=document.getElementById('description'),b=d.firstElementChild,s=getSelection();return [document.activeElement?.id,b.tagName,b.textContent,s.anchorOffset,b.contains(s.anchorNode)]})()`;
  const before = await p.eval<string>(title);

  await test.step("Enter at the end of the title opens an empty line at the top of the description (aJn focusNewLineAtStart)", async () => {
    await caretAt("end");
    await p.key("Enter");
    await p.waitFor(`document.activeElement?.id==='description'`);
    expect(await p.eval(first)).toEqual(["description", "P", "", 0, true]);
    await p.type("Steps");
    expect(await p.eval(`[...document.getElementById('description').children].slice(0,2).map(n=>n.tagName+':'+n.textContent.slice(0,5))`)).toEqual(["P:Steps", expect.stringMatching(/^H2:/)]);
    expect(await p.eval(title)).toBe(before);
  });

  await test.step("Enter mid-title puts the caret at the start of the description and never splits the title (aJn focusAtStart)", async () => {
    await caretAt(3);
    await p.key("Enter");
    await p.waitFor(`document.activeElement?.id==='description'`);
    expect(await p.eval(first)).toEqual(["description", "P", "Steps", 0, true]);
    expect(await p.eval(title)).toBe(before);
  });

  await test.step("an opened line left empty is gone once the description is left", async () => {
    await caretAt("end");
    await p.key("Enter");
    await p.waitFor(`document.activeElement?.id==='description'`);
    expect(await p.eval(`document.getElementById('description').firstElementChild.textContent`)).toBe("");
    await caretAt("end");
    await p.waitFor(`document.getElementById('description').firstElementChild.textContent==='Steps'`);
  });

  await test.step("↓ at the title's end goes to the start of the description, ↑ there comes back to the title's end (iJn)", async () => {
    await caretAt("end");
    await p.key("ArrowDown");
    await p.waitFor(`document.activeElement?.id==='description'`);
    expect(await p.eval(first)).toEqual(["description", "P", "Steps", 0, true]);
    await p.key("ArrowUp");
    await p.waitFor(`document.activeElement?.id==='summary'`);
    expect(await p.eval(`(t=>[t.selectionStart,t.selectionEnd,t.value.length])(document.getElementById('summary'))`)).toEqual(
      Array(3).fill(before.length),
    );
  });

  await test.step("⇧↵ adds no newline to the title and stays in it", async () => {
    await caretAt("end");
    await p.key("Enter", "shift");
    expect(await p.eval(`[document.activeElement?.id,${title}]`)).toEqual(["summary", before]);
  });

  await test.step("the create composer's title: Enter always goes to the start of the description, ↑ comes back", async () => {
    await p.eval("document.activeElement?.blur()");
    await p.key("c");
    await p.waitFor(`document.activeElement?.getAttribute('aria-label')==='Issue title'&&!!document.getElementById('create-description')`);
    await p.type("Composer title");
    await p.key("Enter");
    await p.waitFor(`document.activeElement?.id==='create-description'`);
    expect(await p.eval(`document.getElementById('create-description').children.length`)).toBe(1);
    await p.key("ArrowUp");
    await p.waitFor(`document.activeElement?.getAttribute('aria-label')==='Issue title'`);
    expect(await p.eval(`(t=>t.selectionStart===t.value.length)(document.activeElement)`)).toBe(true);
  });
});

test("BJ-258: Escape in the side panel's title keeps the edit and the panel; a second Escape closes it", async ({ open }) => {
  const p = await open("?issue=TEST-2&view=side");
  await p.waitFor(`!!document.getElementById('summary')`);
  await p.click("#summary");
  await p.key("a", "meta");
  await p.type("Kept by Escape");
  await p.key("ArrowLeft", "shift");
  await test.step("the first Escape collapses the selection to its end and stays in the title (qL)", async () => {
    await p.key("Escape");
    expect(
      await p.eval(`(t=>[document.activeElement===t,t.selectionStart===t.selectionEnd,t.selectionEnd===t.value.length])(document.getElementById('summary'))`),
    ).toEqual([true, true, true]);
  });
  await test.step("the next leaves it (KL), saving the edit, and the global Escape doesn't close the panel", async () => {
    await p.key("Escape");
    await p.waitFor(`document.activeElement?.id!=='summary'`);
    expect(await p.eval(`document.getElementById('summary').value`)).toBe("Kept by Escape");
    expect(await p.eval(`new URLSearchParams(location.search).get('issue')`)).toBe("TEST-2");
  });
  await test.step("with the title left, Escape closes the panel as before", async () => {
    await p.key("Escape");
    await p.waitFor(`!new URLSearchParams(location.search).has('issue')`);
  });
});

test("BJ-270: every title field stops at Jira's 255 characters and says so in Linear's words; nothing longer is sent", async ({ open }) => {
  await fixture.reset({ writable: true, createSuccess: true });
  const p = await open("?issue=TEST-2&view=page");
  await p.waitFor(`!!document.getElementById('summary')`);
  const limit = `document.querySelector('[data-title-limit]')?.textContent`;
  await test.step("the issue's title: typing past the limit is refused and the message shows", async () => {
    await p.click("#summary");
    await p.key("a", "meta");
    await p.type("t".repeat(255));
    await p.type("u");
    expect(await p.eval(`document.getElementById('summary').value.length`)).toBe(255);
    expect(await p.eval(limit)).toBe("Title cannot be longer than 255 characters.");
    await p.key("Tab");
  });
  await test.step("the composer's title stops at the limit too", async () => {
    await p.key("Escape");
    await p.key("c");
    await p.waitFor(`!!document.querySelector('.create-issue-title')`);
    await p.click(".create-issue-title");
    await p.type("c".repeat(256));
    expect(await p.eval(`document.querySelector('.create-issue-title').value.length`)).toBe(255);
    expect(await p.eval(limit)).toBe("Title cannot be longer than 255 characters.");
  });
  const { writes } = await fixture.log();
  expect(writes.flatMap((w: any) => w.ops).filter((op: any) => (op.fields?.summary ?? "").length > 255)).toEqual([]);
});

test("BJ-283: one Escape closes an open tooltip and the side panel under it, as Linear's does", async ({ open }) => {
  const p = await open("?issue=TEST-2&view=side");
  await p.waitFor(`!!document.getElementById('prop-status')`);
  await p.hover("#prop-status");
  await p.waitFor(`!!document.querySelector('[role=tooltip].app-tooltip')`, 2000);
  await p.key("Escape");
  await p.waitFor(`!document.querySelector('.app-tooltip')&&!new URLSearchParams(location.search).has('issue')`);
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

test("BJ-15: linked issues outside the board show their status and title, and every Jira link kind has its section", async ({
  open,
}) => {
  await fixture.reset({ writable: true, crossLinks: true });
  const p = await open("?issue=TEST-1&view=page");
  const row = (relation: string) => `document.querySelector('[data-relation="${relation}"] a')`;
  await p.waitFor(`!!${row("related:OTHER-41")}`, 15000);

  await test.step("sections follow Linear's, then Jira's own phrase for each other link kind", async () => {
    const headings = await p.eval<string[]>(
      `[...document.querySelectorAll('[data-properties] h3')].map(h=>h.textContent)`,
    );
    expect(headings.slice(headings.indexOf("Related"))).toEqual(["Related", "Is caused by", "Clones"]);
  });

  await test.step("an issue outside the board: Jira's status icon and title, opening in Jira", async () => {
    expect(
      await p.eval(
        `(()=>{const a=${row("related:OTHER-41")};return [a.textContent,!!a.querySelector('svg circle'),new URL(a.href).pathname,a.target]})()`,
      ),
    ).toEqual(["Partner team task outside the board", true, "/browse/OTHER-41", "_blank"]);
    expect(await p.eval(`${row("inward:Problem/Incident:OTHER-42")}.textContent`)).toBe(
      "Made-up incident in another project",
    );
    // A mirrored issue under a Jira kind still opens here.
    const href = await p.eval<string>(`${row("outward:Cloners:TEST-2")}.href`);
    expect(new URL(href).origin).toBe(new URL(fixture.url).origin);
    expect(issueOfHref(href)).toBe("TEST-2");
    expect(await p.eval(`${row("outward:Cloners:TEST-2")}.textContent`)).toBe("Browser fixture 2");
  });

  await test.step("removing a Jira link kind sends that link's removal to Jira", async () => {
    await p.click('[data-relation="inward:Problem/Incident:OTHER-42"] button');
    await p.waitFor(
      `![...document.querySelectorAll('[data-properties] h3')].some(h=>h.textContent==='Is caused by')`,
    );
    await expect
      .poll(async () => (await fixture.log()).writes.flatMap((w) => w.ops))
      .toContainEqual({ op: "link", target: "OTHER-42", kind: "inward:Problem/Incident", remove: true });
  });
});

test("BJ-195: related issue hover cards and external Copy link", async ({ open }) => {
  await fixture.reset({ crossLinks: true });
  const p = await open("?issue=TEST-1&view=page");
  const related = '[data-relation="related:OTHER-41"] a';
  await p.waitFor(`!!document.querySelector('${related}')`);
  await p.hover(related);
  await p.waitFor(`!!document.querySelector('[data-issue-hover="OTHER-41"]')`);
  expect(await p.eval(`document.querySelector('[data-issue-hover="OTHER-41"]').textContent`)).toContain("In Review");
  const card = await p.page.locator('[data-issue-hover="OTHER-41"]').boundingBox();
  const pill = await p.page.locator(related).boundingBox();
  expect(card!.x + card!.width).toBeLessThanOrEqual(pill!.x);
  await p.page.mouse.move(1, 1);
  await p.waitFor(`!document.querySelector('[data-issue-hover="OTHER-41"]')`);
  await p.context.grantPermissions(["clipboard-read", "clipboard-write"]);
  await p.page.locator(related).click({ button: "right" });
  await p.click('[role^=menuitem][data-value="Copy link"]');
  // #13: Linear's toast, with the copy icon and a close button.
  await p.waitFor(`document.querySelector('[data-toast]')?.textContent==='Copied issue link to clipboard'`);
  expect(await p.eval(`!!document.querySelector('[data-toast] .ui-toast-icon svg')&&!!document.querySelector('[data-toast] [aria-label="Dismiss"]')`)).toBe(true);
  expect(await p.eval(`navigator.clipboard.readText()`)).toBe("https://example.atlassian.net/browse/OTHER-41");
});
