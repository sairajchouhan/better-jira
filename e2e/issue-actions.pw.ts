import { expect, fixture, test, shownIssue } from "./app";

const OPTIONS = '[role="dialog"][aria-label="Issue options"]';
const optionValues = `[...document.querySelectorAll('${OPTIONS} [cmdk-item]')].map(n=>n.getAttribute('data-value'))`;

test("issue options follow Linear's action tree, with descendant search and submenus that act on the issue", async ({
  open,
}) => {
  const page = await open("?issue=TEST-2&view=page");
  await page.waitFor(`!!document.getElementById('comment')`);
  // Linear's look: filter focused but hidden until typing, grouped with separators, an icon per item, shortcut hints on submenus, content-fitted width.
  const look = `(()=>{const m=document.querySelector('${OPTIONS}'),input=m.querySelector('input'),items=[...m.querySelectorAll('[cmdk-item]')];return {input:input.getBoundingClientRect().width>1,separators:m.querySelectorAll('[cmdk-separator]').length,icons:items.filter(n=>n.querySelector('svg:not(:last-child)')||n.firstElementChild?.querySelector('svg')).length,items:items.length,due:{label:items[0].querySelector('.menu-name').textContent,shortcut:[...items[0].querySelectorAll('.ui-shortcut kbd')].map(n=>n.textContent).join('')},width:Math.round(m.getBoundingClientRect().width)}})()`;

  await test.step("the menu lists Linear's action tree, with its glyphs, groups, hints and fitted width", async () => {
    await page.click("#issue-options");
    await page.waitFor(`document.activeElement?.getAttribute('aria-label')==='Find issue options'`);
    expect(await page.eval(optionValues)).toEqual([
      "Due date",
      "Issue type",
      "Add link…",
      "Add pull request…",
      "Add document…",
      "Create related",
      "Mark as",
      "Copy",
      "Make a copy…",
      "Favorite",
      "Remind me",
      "Show description history",
      "Delete",
    ]);
    // Linear's Create related (square with +) and Copy (clipboard) glyphs.
    expect(
      await page.eval(
        `['Create related','Copy'].map(v=>document.querySelector('${OPTIONS} [cmdk-item][data-value="'+v+'"] svg path').getAttribute('d').slice(0,12))`,
      ),
    ).toEqual(["M8 13.5H4.5a", "M5.5 3h-1A1."]);
    const before = await page.eval<{
      input: boolean;
      separators: number;
      icons: number;
      items: number;
      due: { label: string; shortcut: string };
      width: number;
    }>(look);
    expect(before).toMatchObject({ input: false, separators: 4, icons: before.items });
    expect(before.due).toEqual({ label: "Due date", shortcut: "⇧D" });
    expect(before.width).toBeGreaterThanOrEqual(200);
    expect(before.width).toBeLessThan(280);
  });

  await test.step("typing searches descendants and shows the filter without separators", async () => {
    await page.type("blocked");
    await page.waitFor(
      `!!document.querySelector('[cmdk-item][data-value="Create related › Blocked issue…"]')`,
    );
    // Ranked by score (ISSUE-8): the shorter "Blocked by…" matches better.
    expect(await page.eval(optionValues)).toEqual([
      "Mark as › Blocked by…",
      "Create related › Blocked issue…",
    ]);
    expect(await page.eval<{ input: boolean; separators: number }>(look)).toMatchObject({
      input: true,
      separators: 0,
    });
    await page.key("Escape");
  });

  await test.step("R2-issue-fields-D7: Due date › Tomorrow sets tomorrow's local date, shown Linear-style as Tomorrow", async () => {
    await page.click("#issue-options");
    await page.hover('[cmdk-item][data-value="Due date"]');
    await page.click('[cmdk-item][data-value="Tomorrow"]');
    await page.waitFor(`document.getElementById('prop-due')?.textContent.includes('Tomorrow')`);
  });

  await test.step("Favorite toggles the issue favorite and closes", async () => {
    await page.click("#issue-options");
    await page.click('[cmdk-item][data-value="Favorite"]');
    await page.waitFor(
      `document.querySelector('[aria-label="Remove issue from favorites"]')?.getAttribute('aria-checked')==='true'`,
    );
    expect(await page.eval(`!!document.querySelector('${OPTIONS}')`)).toBe(false);
  });

  await test.step("Copy ›: every row has an icon, and title as link shows ⌘C", async () => {
    await page.click("#issue-options");
    await page.hover('[cmdk-item][data-value="Copy"]');
    await page.waitFor(
      `!!document.querySelector('[role="dialog"][aria-label="Copy"] [cmdk-item]')`,
    );
    expect(
      await page.eval(
        `(()=>{const m=document.querySelector('[role="dialog"][aria-label="Copy"]');return [[...m.querySelectorAll('[cmdk-item]')].every(n=>n.querySelector('svg')),{label:m.querySelector('[cmdk-item][data-value="Copy title as link"] .menu-name').textContent,shortcut:[...m.querySelectorAll('[cmdk-item][data-value="Copy title as link"] .ui-shortcut kbd')].map(n=>n.textContent).join(' ')}]})()`,
      ),
    ).toEqual([true, { label: "Copy title as link", shortcut: "⌘ C" }]);
    await page.key("Escape");
    await page.waitFor(`!document.querySelector('[role="dialog"][aria-label="Copy"]')`);
    if (await page.eval(`!!document.querySelector('${OPTIONS}')`)) await page.key("Escape");
    await page.waitFor(
      `!document.querySelector('${OPTIONS}')&&!!document.getElementById('issue-options')`,
    );
  });

  await test.step("Mark as › Parent of… makes the chosen issue a sub-issue of this one", async () => {
    await page.click("#issue-options");
    await page.hover('[cmdk-item][data-value="Mark as"]');
    await page.click('[cmdk-item][data-value="Parent of…"]');
    await page.waitFor(
      `document.querySelector('[role="dialog"][aria-label="Issue relations"] [data-kind]')?.dataset.kind==='child'`,
    );
    await page.click('[aria-label="Find related issue"]');
    await page.type("TEST-3");
    await page.click(
      '[role="dialog"][aria-label="Issue relations"] [cmdk-item][data-value="TEST-3"]',
    );
    await page.waitFor(`!!document.querySelector('[data-sub-issue="TEST-3"]')`);
  });

  await test.step("Create related › Blocked issue… creates a new issue blocked by this one, undone in one step", async () => {
    await page.click("#issue-options");
    await page.hover('[cmdk-item][data-value="Create related"]');
    await page.click('[cmdk-item][data-value="Blocked issue…"]');
    await page.waitFor(`document.activeElement?.getAttribute('aria-label')==='Issue title'`);
    await page.type("Blocked follow-up");
    await page.key("Enter", "meta");
    await page.waitFor(`!!document.querySelector('[data-relation="blocked:TEST-2"]')`);
    const created = await page.eval<string>(`${shownIssue}`);
    expect(created).not.toBe("TEST-2");
    expect(
      await page.eval(
        `document.getElementById('summary')?.value??document.getElementById('summary')?.textContent`,
      ),
    ).toContain("Blocked follow-up");
    await page.goto("?issue=TEST-2&view=page");
    await page.waitFor(`!!document.querySelector('[data-relation="blocking:${created}"]')`);
    await page.eval("document.activeElement?.blur()");
    await page.key("z", "meta");
    await page.waitFor(`!document.querySelector('[data-relation^="blocking:"]')`);
  });
});

test("issue activity, related-issue search and description history", async ({ open }) => {
  const page = await open("?issue=TEST-2&view=page");
  await page.waitFor(`!!document.getElementById('comment')`);

  await test.step("property edits appear in Activity grouped like Linear: merged, removed on round trip, ordered, undoable and durable", async () => {
    const rows = `[...document.querySelectorAll('[data-activity]')].map(n=>n.textContent.replace(/\\s+/g,' ').trim())`;
    const pick = async (key: string, value: string) => {
      await page.eval("document.activeElement?.blur()");
      await page.key(key);
      await page.waitFor(`!!document.querySelector('[cmdk-item][data-value="${value}"]')`);
      await page.click(`[cmdk-item][data-value="${value}"]`);
      await page.waitFor(`!document.querySelector('[cmdk-item][data-value="${value}"]')`);
    };
    const original = "Low",
      other = "Urgent"; // fixture TEST-2 priority
    await pick("p", other);
    await page.waitFor(`${rows}.length===1`);
    expect((await page.eval<string[]>(rows))[0]).toMatch(
      // Linear's `Es`: a priority that had a value is raised or lowered from it.
      new RegExp(`Audit user raised priority from ${original} to ${other} · just now$`),
    );
    await pick("p", "High");
    await page.waitFor(`${rows}.join().includes('raised priority from Low to High')`);
    expect(await page.eval(`${rows}.length`)).toBe(1);
    await pick("s", "Doing");
    await page.waitFor(`${rows}.length===2`);
    expect((await page.eval<string[]>(rows))[0]).toContain("moved from Todo to Doing");
    expect((await page.eval<string[]>(rows))[1]).toContain("raised priority from Low to High");
    await pick("p", original);
    await page.waitFor(`${rows}.length===1`);
    await page.eval("document.activeElement?.blur()");
    await page.key("z", "meta");
    await page.waitFor(`${rows}.length===2`);
    await page.waitFor(
      `document.querySelector('[aria-label="Local save status"]').textContent.includes('Saved')`,
    );
    await page.reload();
    await page.waitFor(`${rows}.length===2`);
    expect(
      await page.eval(`!!document.querySelector('[data-activity="status"] a[href*="#activity-"]')`),
    ).toBe(true);
    expect(
      await page.eval(
        `(()=>{const row=document.querySelector('[data-activity="status"]'),name=row.querySelector('.font-medium');return [getComputedStyle(name).color===getComputedStyle(row).color,getComputedStyle(name).fontWeight]})()`,
      ),
    ).toEqual([true, "500"]);
  });

  await test.step("related issue search is keyboard-driven: focused on open, ArrowDown and Enter pick the issue", async () => {
    await page.waitFor(`!!document.getElementById('comment')`);
    await page.click("#issue-options");
    await page.type("related to");
    await page.waitFor(
      `!!document.querySelector('[cmdk-item][data-value="Mark as › Related to…"]')`,
    );
    await page.key("Enter");
    await page.waitFor(`document.activeElement?.getAttribute('aria-label')==='Find related issue'`);
    await page.type("TEST");
    await page.waitFor(
      `document.querySelectorAll('[role="dialog"][aria-label="Issue relations"] [cmdk-item]').length>1`,
    );
    const second = await page.eval<string>(
      `document.querySelectorAll('[role="dialog"][aria-label="Issue relations"] [cmdk-item]')[1].getAttribute('data-value')`,
    );
    await page.key("ArrowDown");
    await page.key("Enter");
    await page.waitFor(`!!document.querySelector('[data-relation="related:${second}"]')`);
    expect(
      await page.eval(`!!document.querySelector('[role="dialog"][aria-label="Issue relations"]')`),
    ).toBe(false);
    // Focus returns to Issue options (the menu item that opened the picker is gone), after a pick and after Escape.
    await page.waitFor(`document.activeElement?.id==='issue-options'`);
    await page.key("Enter");
    await page.type("related to");
    await page.waitFor(
      `!!document.querySelector('[cmdk-item][data-value="Mark as › Related to…"]')`,
    );
    await page.key("Enter");
    await page.waitFor(`document.activeElement?.getAttribute('aria-label')==='Find related issue'`);
    await page.key("Escape");
    await page.waitFor(`!document.querySelector('[role="dialog"][aria-label="Issue relations"]')`);
    await page.waitFor(`document.activeElement?.id==='issue-options'`);
  });

  await test.step("restoring a description from history keeps the version it replaces", async () => {
    await page.click("#description");
    await page.waitFor(
      `!!document.querySelector('[aria-label="Issue description"][contenteditable]')`,
    );
    await page.key("a", "meta");
    await page.cmd("Input.insertText", { text: "Newest description at risk" });
    await page.click("#summary");
    await page.click("#issue-options");
    await page.click('[cmdk-item][data-value="Show description history"]');
    // Prod parity #34: the menu opens the one Issue description dialog; the kept revision sits in its version list.
    const dialog = `document.querySelector('[role="dialog"][aria-label="Issue description"]')`;
    await page.waitFor(`!!${dialog}?.querySelector('[data-version^="local-"]')`);
    await page.click('[role="dialog"] [data-version^="local-"]');
    await page.click("text=Restore version");
    await page.waitFor(
      `!document.getElementById('description')?.textContent.includes('Newest description at risk')`,
    );
    await page.click("#issue-options");
    await page.click('[cmdk-item][data-value="Show description history"]');
    await page.click('[role="dialog"] [data-version^="local-"]');
    expect(await page.eval(`${dialog}.textContent`)).toContain("Newest description at risk");
  });
});

test("BJ-13: Jira's whole history joins Activity after the details paint, in Linear's wording", async ({ open }) => {
  // Made-up history in the server's slim shape (src/shared/jira-history.ts): a person and an automation app.
  const daysAgo = (days: number) => new Date(Date.now() - days * 86_400_000).toISOString();
  const ada = { id: "ada", name: "Ada Example" },
    bot = { id: "bot", name: "Automation for Jira", app: true };
  const item = (field: string, sides: object, fieldId?: string) => ({
    field,
    ...(fieldId ? { fieldId } : {}),
    from: null,
    fromText: null,
    to: null,
    toText: null,
    ...sides,
  });
  await fixture.reset({
    historyDelay: 1500,
    history: {
      "TEST-2": [
        {
          id: "1",
          at: daysAgo(5),
          actor: ada,
          items: [
            item("status", { from: "todo", fromText: "Todo", to: "doing", toText: "Doing" }, "status"),
            item("resolution", { to: "1", toText: "Done" }, "resolution"),
          ],
        },
        {
          id: "2",
          at: daysAgo(4),
          actor: bot,
          items: [item("Sprint", { to: "3", toText: "Sprint 10" }, "customfield_1"), item("Rank", { toText: "Ranked higher" })],
        },
        {
          id: "3",
          at: daysAgo(3),
          actor: ada,
          items: [
            item("Link", { to: "TEST-1", toText: "This work item blocks TEST-1" }),
            item("Fix Version", { to: "7", toText: "Release 1" }, "fixVersions"),
          ],
        },
        { id: "4", at: daysAgo(2), actor: ada, items: [item("Release notes", { toText: "Shipped" }, "customfield_9")] },
      ],
    },
  });
  const page = await open("?issue=TEST-2&view=page");
  // The words after the icon (an actor avatar falls back to an initial).
  const rows = `[...document.querySelectorAll('[data-activity]')].map(n=>n.children[1].textContent.replace(/\\s+/g,' ').replace(/ ·$/,'').trim())`;
  // The details paint while the history is still on its way.
  await page.waitFor(`!!document.getElementById('comment')&&!!document.getElementById('issue-created')`);
  expect(await page.eval(rows)).toEqual([]);
  await page.waitFor(`${rows}.length===5`, 5000);
  expect(await page.eval(rows)).toEqual([
    // The resolution its transition set rides on that status row, as prod Jira keeps it (activity parity #12; Linear has no
    // resolution); Jira's rank is noise Linear never shows.
    "Ada Example moved from Todo to Doing and set resolution to Done",
    "Automation for Jira added issue to Sprint 10",
    "Ada Example added to milestone Release 1",
    "Ada Example marked this issue as blocking TEST-1 Rich browser fixture",
    "Ada Example set Release notes to Shipped",
  ]);
  // Each row keeps Linear's time link with the exact time on hover.
  expect(
    await page.eval(`[...document.querySelectorAll('[data-activity] a[href*="#activity-"]')].every(a=>/\\d{2}:\\d{2}:\\d{2}$/.test(a.getAttribute('aria-label')))`),
  ).toBe(true);
});

test("BJ-13: a long history folds its middle into Linear's \"Show N events\" row, which unfolds it", async ({ open }) => {
  // After the fixture issue's creation (2026-11-06T10:00Z), three hours apart.
  const after = (hours: number) => new Date(Date.parse("2026-11-06T12:00:00Z") + hours * 3_600_000).toISOString();
  const people = [
    { id: "ada", name: "Ada Example" },
    { id: "bot", name: "Automation for Jira", app: true },
  ];
  const item = (field: string, sides: object, fieldId?: string) => ({
    field,
    ...(fieldId ? { fieldId } : {}),
    from: null,
    fromText: null,
    to: null,
    toText: null,
    ...sides,
  });
  const status = (i: number) =>
    i % 2
      ? item("status", { from: "doing", fromText: "Doing", to: "todo", toText: "Todo" }, "status")
      : item("status", { from: "todo", fromText: "Todo", to: "doing", toText: "Doing" }, "status");
  // Ten changes by alternating actors, so none group: created + 10 rows, 5 of them in the middle.
  const middle = [
    status(3),
    item("priority", { fromText: "Low", toText: "High" }, "priority"),
    item("Link", { to: "TEST-1", toText: "This work item blocks TEST-1" }),
    item("labels", { fromText: "test", toText: "test ui" }, "labels"),
    item("Link", { to: "TEST-3", toText: "This work item relates to TEST-3" }),
  ];
  const items = [status(1), status(2), ...middle, status(8), status(9), status(10)];
  await fixture.reset({
    history: {
      "TEST-4": items.map((change, i) => ({
        id: String(i + 1),
        at: after(3 * i),
        actor: people[i % 2],
        items: [change],
      })),
    },
  });
  const page = await open("?issue=TEST-4&view=page");
  const folded = `document.querySelector('[data-activity-collapsed]')`;
  await page.waitFor(`!!${folded}`, 5000);
  expect(await page.eval(`${folded}.querySelector("svg path").getAttribute("d")`)).toContain("M7.523 2.71");
  expect(await page.eval(`${folded}.textContent`)).toBe(
    "Show 5 events: changed status, priority, labels, and related issues…",
  );
  // Created and the next 2 before it, the last 3 after it.
  expect(
    await page.eval(
      `(()=>{const rows=[...document.querySelectorAll('.issue-activity ol > .activity-event')];const i=rows.indexOf(${folded});return [i,rows.length-i-1]})()`,
    ),
  ).toEqual([3, 3]);
  await page.click('[aria-label="Expand all activity"]');
  await page.waitFor(`!${folded}`);
  expect(await page.eval(`document.querySelectorAll('.issue-activity ol > .activity-event').length`)).toBe(11);
});

test("F2: every Jira change stays reachable: adjacent changes group in Linear's words and expand to each, at its own time", async ({ open }) => {
  // DRFT-953's shape (made-up names): one person's agent toggles a label between moves; an app attaches a burst of files.
  const at = (minutes: number, ms = 0) => new Date(Date.parse("2026-11-06T12:00:00Z") + minutes * 60_000 + ms).toISOString();
  const ada = { id: "ada", name: "Ada Example" },
    bot = { id: "bot", name: "Connector App", app: true };
  const labels = (fromText: string, toText: string) => ({ field: "labels", fieldId: "labels", from: null, to: null, fromText, toText });
  const file = (id: string, name: string) => ({ field: "Attachment", fieldId: "attachment", from: null, fromText: null, to: id, toText: name });
  await fixture.reset({
    history: {
      "TEST-4": [
        { id: "1", at: at(0), actor: ada, items: [{ field: "status", fieldId: "status", from: "todo", fromText: "Todo", to: "doing", toText: "Doing" }] },
        { id: "2", at: at(5), actor: ada, items: [labels("test", "test agent-working")] },
        { id: "3", at: at(20), actor: ada, items: [labels("test agent-working", "test")] },
        { id: "4", at: at(40), actor: ada, items: [labels("test", "test drift")] },
        { id: "5", at: at(60), actor: bot, items: [file("10", "one.png")] },
        { id: "6", at: at(60, 280), actor: bot, items: [file("11", "two.png")] },
      ],
    },
  });
  const page = await open("?issue=TEST-4&view=page");
  const rows = `[...document.querySelectorAll('[data-activity]')].map(n=>[n.children[1].textContent.replace(/\\s+/g,' ').replace(/ ·$/,'').trim(),n.querySelector('a[href*="#activity-"] time')?.getAttribute('datetime')])`;
  await page.waitFor(`${rows}.length===4`, 5000);
  expect(await page.eval(rows)).toEqual([
    ["Ada Example moved from Todo to Doing", at(0)],
    // Linear's grouped label row (`yc`), at the latest change's time.
    ["Ada Example added drift, added and then removed agent-working", at(40)],
    ["Connector App attached one.png", at(60)],
    ["Connector App attached two.png", at(60, 280)],
  ]);
  await page.click('[data-activity="labels"] button');
  const grouped = `[...document.querySelectorAll('[aria-label="Grouped changes"] li')].map(n=>[n.textContent.replace(/ · .*$/,''),n.querySelector('time').getAttribute('datetime')])`;
  await page.waitFor(`${grouped}.length===3`);
  expect(await page.eval(grouped)).toEqual([
    ["Ada Example added label agent-working", at(5)],
    ["Ada Example removed label agent-working", at(20)],
    ["Ada Example added label drift", at(40)],
  ]);
});

test("BJ-196: repeated title edits expand and collapse with their individual values", async ({ open }) => {
  await fixture.reset({ history: { "TEST-2": [
    { id: "title-1", at: "2026-11-07T10:00:00Z", actor: { id: "ada", name: "Ada Example" }, items: [{ field: "summary", from: null, to: null, fromText: "Original", toText: "First title" }] },
    { id: "title-2", at: "2026-11-07T12:00:00Z", actor: { id: "ada", name: "Ada Example" }, items: [{ field: "summary", from: null, to: null, fromText: "First title", toText: "Second title" }] },
  ] } });
  const page = await open("?issue=TEST-2");
  const group = '[data-activity="title"] button';
  await page.waitFor(`document.querySelector('${group}')?.textContent.includes('changed title twice')`);
  expect(await page.eval(`!!document.querySelector('[aria-label="Grouped changes"]')`)).toBe(false);
  await page.click(group);
  await page.waitFor(`document.querySelector('[aria-label="Grouped changes"]')?.textContent.includes('First title')`);
  expect(await page.eval(`document.querySelector('[aria-label="Grouped changes"]')?.textContent`)).toContain("Second title");
  await page.key("Enter");
  await page.waitFor(`!document.querySelector('[aria-label="Grouped changes"]')`);
});

test("BJ-202: grouped status arrows, links, cycles and relation changes retain expandable entries", async ({ open }) => {
  const actor = { id: "ada", name: "Ada Example" };
  const change = (field: string, fromText: string | null, toText: string | null, from: string | null = null, to: string | null = null) => ({ field, fieldId: field, from, to, fromText, toText });
  const at = (n: number) => `2026-11-06T${String(10 + n).padStart(2, "0")}:00:00Z`;
  await fixture.reset({ history: { "TEST-4": [
    { id: "s1", actor, at: at(0), items: [change("status", "Todo", "Doing", "todo", "doing")] },
    { id: "s2", actor, at: at(1), items: [change("status", "Doing", "Done", "doing", "done")] },
    { id: "l1", actor, at: at(2), items: [change("RemoteWorkItemLink", null, 'This work item links to "Guide"', null, "1")] },
    { id: "l2", actor, at: at(3), items: [change("RemoteWorkItemLink", null, 'This work item links to "Notes"', null, "2")] },
    // 3.7: Linear lists no removal, and a link removed since has no "linked" row either.
    { id: "l3", actor, at: at(3), items: [change("RemoteWorkItemLink", null, 'This work item links to "Draft (Web Link)"', null, "3")] },
    { id: "l4", actor, at: at(3), items: [change("RemoteWorkItemLink", 'This work item links to "Draft (Web Link)"', null, "3")] },
    { id: "c1", actor, at: at(4), items: [change("Sprint", null, "Sprint 1", null, "1")] },
    { id: "c2", actor, at: at(5), items: [change("Sprint", "Sprint 1", "Sprint 2", "1", "2")] },
    { id: "r1", actor, at: at(6), items: [change("Link", "This issue relates to DEMO-9", null, "DEMO-9"), change("Link", null, "This issue blocks DEMO-9", null, "DEMO-9")] },
    { id: "e1", actor, at: at(7), items: [change("environment", "", "")] },
  ] } });
  const page = await open("?issue=TEST-4&view=page");
  await page.waitFor(`!!document.querySelector('[data-grouped-status-direction="forward"]')`);
  const summaries = `[...document.querySelectorAll('[data-activity]')].map(n=>n.textContent).join(' ')`;
  expect(await page.eval(summaries)).toContain("added 2 links");
  expect(await page.eval(summaries)).toContain("added issue to Sprint 1 and moved to Sprint 2");
  expect(await page.eval(summaries)).toContain("changed the relation with DEMO-9 from related to blocking");
  expect(await page.eval(summaries)).toContain("updated the environment");
  expect(await page.eval(summaries)).not.toContain("Draft");
  await page.click('[data-activity="weblink"] button');
  await page.waitFor(`document.querySelectorAll('[aria-label="Grouped changes"] li').length===2`);
  expect(await page.eval(`[...document.querySelectorAll('[aria-label="Grouped changes"] time')].map(n=>n.dateTime)`)).toEqual([at(2), at(3)]);
});
