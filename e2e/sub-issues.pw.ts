import { expect, test, sleep, fixture, type App as Page } from "./app";
const tree = `const read=fetch;window.fetch=async(...args)=>{const response=await read(...args);if(new URL(String(args[0]),location.href).pathname!=='/api/issues')return response;const issues=await response.json();Object.assign(issues.find(i=>i.key==='TEST-3'),{parent:'TEST-2',status:'done',resolved:new Date().toISOString()});for(const key of ['TEST-4','TEST-5'])issues.find(i=>i.key===key).parent='TEST-3';return Response.json(issues)}`;
/** Turns on these sub-issue display properties in the open display menu, leaving any already on. */
const show = async (page: Page, ...names: string[]) => {
  for (const name of names)
    if (
      !(await page.eval(
        `[...document.querySelectorAll('[role="dialog"] [aria-pressed="true"]')].some(e=>e.textContent===${JSON.stringify(name)})`,
      ))
    )
      await page.click(`text=${name}`);
};

test("the sub-issue tree: progress, guide lines and display preferences", async ({
  open,
}) => {
  const page = await open("?issue=TEST-2&view=page", { setup: tree });
  await test.step("RAJ-52, RAJ-53 › RAJ-54, RAJ-55: Linear sub-issue progress rings and tree guide lines", async () => {
    await page.waitFor(
      `document.querySelector('[data-sub-issues]')?.textContent.includes('1/3')`,
    );
    expect(
      await page.eval(`document.querySelectorAll('[data-sub-issue]').length`),
    ).toBe(3);
    // Linear (RAJ-52): a progress ring before "1/3", a "0/2" ring pill on a row with children, a guide beside nested rows, and round header buttons.
    expect(
      await page.eval(
        `(()=>{const header=document.querySelector('[data-sub-progress]'),pill=document.querySelector('[data-sub-issue="TEST-3"] [data-row-progress]'),button=document.querySelector('[aria-label="Sub-issue display options"]').getBoundingClientRect();return [header.textContent,header.querySelector('svg').dataset.progress,pill?.textContent,pill?.querySelector('svg').dataset.progress,[...document.querySelectorAll('[data-sub-issue]')].map(n=>!!n.querySelector('[data-guide]')),[button.width,button.height,parseFloat(getComputedStyle(document.querySelector('[aria-label="Sub-issue display options"]')).borderRadius)>=14]]})()`,
      ),
    ).toEqual([
      "1/3",
      "0.33",
      "0/2",
      "0.00",
      [false, true, true],
      [28, 28, true],
    ]);
    // Linear (RAJ-53 › RAJ-54, RAJ-55): a 1px lch(16.32) line at the parent icon's centre runs through a middle child and stops 12px into the last, each ending in the same 10×9 curved elbow; children indent 24px.
    expect(
      await page.eval(
        `['TEST-4','TEST-5'].map(k=>{const r=document.querySelector('[data-sub-issue="'+k+'"]'),b=r.getBoundingClientRect(),g=r.querySelector('[data-guide]'),e=r.querySelector('[data-elbow]'),parent=document.querySelector('[data-sub-issue="TEST-3"] button svg').getBoundingClientRect(),own=r.querySelector('button svg').getBoundingClientRect(),q=g.getBoundingClientRect(),p=e.getBoundingClientRect();return [q.left-parent.left,q.width,q.top-b.top,q.height,getComputedStyle(g).backgroundColor,p.left-q.left,p.top-b.top,p.width,p.height,getComputedStyle(e).fill,own.left-parent.left]})`,
      ),
    ).toEqual([
      [
        6.5,
        1,
        0,
        36,
        "lch(16.32 1.48 272)",
        0,
        10,
        10,
        9,
        "lch(16.32 1.48 272)",
        24,
      ],
      [
        6.5,
        1,
        0,
        12,
        "lch(16.32 1.48 272)",
        0,
        10,
        10,
        9,
        "lch(16.32 1.48 272)",
        24,
      ],
    ]);
  });
  await test.step("retained ancestors and display preferences work across reloads", async () => {
    await page.click('[aria-label="Sub-issue display options"]');
    await page.eval(`document.querySelector('input[type=checkbox]').click()`);
    await page.waitFor(
      `document.querySelector('[data-sub-issues]').textContent.includes('1/1')`,
    );
    expect(
      await page.eval(`document.querySelectorAll('[data-sub-issue]').length`),
    ).toBe(1);
    await page.eval(
      `const select=document.querySelector('[aria-label="Completed sub-issues"]');select.value='none';select.dispatchEvent(new Event('change',{bubbles:true}))`,
    );
    await page.waitFor(
      `document.querySelectorAll('[data-sub-issue]').length===0`,
    );
    await page.key("Escape");
    await page.click("text=Show 1 completed");
    expect(
      await page.eval(`document.querySelectorAll('[data-sub-issue]').length`),
    ).toBe(1);
    await page.click('[aria-label="Sub-issue display options"]');
    await page.eval(`document.querySelector('input[type=checkbox]').click()`);
    await page.click("text=ID");
    await page.key("Escape");
    await page.waitFor(
      `document.querySelector('[data-sub-issues]').textContent.includes('1/3')`,
    );
    expect(
      await page.eval(`document.querySelectorAll('[data-sub-issue]').length`),
    ).toBe(3);
    expect(
      await page.eval(
        `document.querySelector('[data-sub-issue="TEST-3"]').hasAttribute('data-context-only')`,
      ),
    ).toBe(true);
    await page.reload();
    await page.waitFor(
      `document.querySelector('[data-sub-issue="TEST-3"]')?.textContent.includes('TEST-3')`,
    );
    expect(
      await page.eval(`document.querySelectorAll('[data-sub-issue]').length`),
    ).toBe(3);
  });
  await test.step("a grandchild keeps its ancestor branch line running to the next sibling, like Linear's tree", async () => {
    const page = await open("?issue=TEST-2&view=page", {
      setup: tree.replace(
        "return Response.json(issues)",
        "issues.find(i=>i.key==='TEST-6').parent='TEST-4';return Response.json(issues)",
      ),
    });
    await page.waitFor(`!!document.querySelector('[data-sub-issue="TEST-6"]')`);
    // TEST-3 › TEST-4 › TEST-6, then TEST-5: TEST-6 shows TEST-3's line (full height, x 15) and its own elbow under TEST-4's icon (x 39, 12px stub); TEST-5 shows no deeper line.
    expect(
      await page.eval(
        `['TEST-4','TEST-6','TEST-5'].map(k=>{const r=document.querySelector('[data-sub-issue="'+k+'"]'),b=r.getBoundingClientRect();return [r.dataset.depth,[...r.querySelectorAll('[data-guide]')].map(g=>{const q=g.getBoundingClientRect();return [q.left-b.left,q.height]}),[...r.querySelectorAll('[data-elbow]')].map(e=>e.getBoundingClientRect().left-b.left)]})`,
      ),
    ).toEqual([
      ["1", [[45.5, 36]], [45.5]],
      [
        "2",
        [
          [45.5, 36],
          [69.5, 12],
        ],
        [69.5],
      ],
      ["1", [[45.5, 12]], [45.5]],
    ]);
    // Every guide is a visible 1px line (Opus review 4: a 0px guide passed every other check).
    expect(
      await page.eval(
        `[...new Set([...document.querySelectorAll('[data-guide]')].map(g=>g.getBoundingClientRect().width))]`,
      ),
    ).toEqual([1]);
  });
  await test.step("a grandchild under a last child draws no line for the closed ancestor branch", async () => {
    const page = await open("?issue=TEST-2&view=page", {
      setup: tree.replace(
        "return Response.json(issues)",
        "issues.find(i=>i.key==='TEST-6').parent='TEST-5';return Response.json(issues)",
      ),
    });
    await page.waitFor(`!!document.querySelector('[data-sub-issue="TEST-6"]')`);
    // TEST-3 › TEST-4, TEST-5 › TEST-6: TEST-5 is TEST-3's last child, so TEST-6 has only its own 12px stub, no line for TEST-3's branch.
    expect(
      await page.eval(
        `[...document.querySelectorAll('[data-sub-issue]')].map(r=>[r.dataset.subIssue,r.dataset.depth,[...r.querySelectorAll('[data-guide]')].map(g=>g.getBoundingClientRect().height)])`,
      ),
    ).toEqual([
      ["TEST-3", "0", []],
      ["TEST-4", "1", [36]],
      ["TEST-5", "1", [12]],
      ["TEST-6", "2", [12]],
    ]);
  });
  await test.step("a last child's line stops at its elbow even when a later parent has children", async () => {
    const page = await open("?issue=TEST-2&view=page", {
      setup: tree.replace(
        "return Response.json(issues)",
        "Object.assign(issues.find(i=>i.key==='TEST-6'),{parent:'TEST-2'});issues.find(i=>i.key==='TEST-5').parent='TEST-6';return Response.json(issues)",
      ),
    });
    await page.waitFor(`!!document.querySelector('[data-sub-issue="TEST-5"]')`);
    // TEST-3 › TEST-4, TEST-6 › TEST-5: TEST-4 is TEST-3's last child, so its line is a 12px stub although TEST-5 sits at the same depth later.
    expect(
      await page.eval(
        `[...document.querySelectorAll('[data-sub-issue]')].map(r=>[r.dataset.subIssue,r.dataset.depth,[...r.querySelectorAll('[data-guide]')].map(g=>g.getBoundingClientRect().height)])`,
      ),
    ).toEqual([
      ["TEST-3", "0", []],
      ["TEST-4", "1", [12]],
      ["TEST-6", "0", []],
      ["TEST-5", "1", [12]],
    ]);
  });
  await test.step("invalid display data recovers and account preferences stay separate", async () => {
    const prefix = "better-jira:sub-issues:v1:",
      account = "https://example.atlassian.net/audit-me";
    const setup = `localStorage.setItem(${JSON.stringify(prefix + account)},JSON.stringify({ordering:'broken',completed:5,nested:'yes',properties:['labels','invalid',null]}));const clientRead=fetch;window.fetch=async(...args)=>{const r=await clientRead(...args);if(new URL(String(args[0]),location.href).pathname!=='/api/client')return r;const client=await r.json();client.user.id=sessionStorage.getItem('account')||'audit-me';return Response.json(client)}`;
    const page = await open("?issue=TEST-2&view=page", {
      setup: tree + ";" + setup,
    });
    await page.waitFor(`!!document.querySelector('[data-sub-issue]')`);
    await page.click('[aria-label="Sub-issue display options"]');
    expect(
      await page.eval(
        `document.querySelector('[aria-label="Sub-issue ordering"]').value`,
      ),
    ).toBe("manual");
    expect(
      await page.eval(
        `document.querySelector('[aria-label="Completed sub-issues"]').value`,
      ),
    ).toBe("all");
    expect(
      await page.eval(
        `document.querySelector('input[type="checkbox"]').checked`,
      ),
    ).toBe(true);
    await page.click("text=ID");
    expect(
      await page.eval(
        `JSON.parse(localStorage.getItem(${JSON.stringify(prefix + account)})).properties`,
      ),
    ).toEqual(["labels", "id"]);
    expect(
      await page.eval(
        `JSON.parse(localStorage.getItem(${JSON.stringify(prefix + account)})).ordering`,
      ),
    ).toBe("manual");
    await page.key("Escape");
    await page.eval(`sessionStorage.setItem('account','different-account')`);
    await page.reload();
    await page.click('[aria-label="Sub-issue display options"]');
    expect(
      await page.eval(
        `[...document.querySelectorAll('[role="dialog"] [aria-pressed="true"]')].map(e=>e.textContent)`,
      ),
    ).toEqual(["Status", "Assignee"]);
    await page.key("Escape");
  });
  await test.step("opening a cross-board child retains page view and uses the child board statuses", async () => {
    const setup = `const read=fetch;window.fetch=async(...args)=>{const response=await read(...args),path=new URL(String(args[0]),location.href).pathname;if(path==='/api/boards'){const boards=await response.json();boards.push({id:2,name:'Other board',columns:[{name:'Open',statuses:[{id:'other-open',name:'Open',category:'new'}]},{name:'Shipped',statuses:[{id:'other-done',name:'Shipped',category:'done'}]}]});return Response.json(boards);}if(path!=='/api/issues')return response;const issues=await response.json();Object.assign(issues.find(i=>i.key==='TEST-4'),{parent:'TEST-2',board:2,status:'other-done'});return Response.json(issues)}`;
    const page = await open("?board=1&issue=TEST-2&view=page", { setup });
    await page.waitFor(`!!document.querySelector('[data-sub-issue="TEST-4"]')`);
    await page.click('[aria-label="Change status for TEST-4"]');
    expect(
      await page.eval(
        `[...document.querySelectorAll('[cmdk-item]')].map(e=>e.textContent)`,
      ),
    ).toEqual(["Open1", "Shipped2"]);
    await page.key("Escape");
    await page.click('[data-sub-issue="TEST-4"] a');
    await page.waitFor(
      `document.getElementById('summary')?.value==='Browser fixture 4'`,
    );
    expect(
      await page.eval(`new URLSearchParams(location.search).get('view')`),
    ).toBe("page");
    expect(
      await page.eval(`new URLSearchParams(location.search).get('board')`),
    ).toBe("2");
  });
});

test("sub-issue row properties change locally, undo, sort and persist with no Jira writes", async ({
  open,
}) => {
  const page = await open("?issue=TEST-2&view=page", { setup: tree });
  await test.step("row assignee and label removals apply to the selected child and persist", async () => {
    await page.waitFor(`!!document.querySelector('[data-sub-issue="TEST-4"]')`);
    await page.click('[aria-label="Change assignee for TEST-4"]');
    await page.page.getByRole("option", { name: "Alex", exact: true }).click(); // the detail's own assignee button also reads "Alex"
    expect(
      await page.eval(
        `document.querySelector('[aria-label="Change assignee for TEST-4"]').title`,
      ),
    ).toBe("Alex");
    expect(
      await page.eval(
        `document.querySelector('[aria-label="Change assignee for TEST-3"]').title`,
      ),
    ).toBe("Unassigned");
    await page.click('[aria-label="Sub-issue display options"]');
    await page.click("text=Labels");
    await page.key("Escape");
    await page.click('[aria-label="Change labels for TEST-4"]');
    await page.click('[cmdk-item][data-value="test"]');
    await page.key("Escape");
    expect(
      await page.eval(
        `document.querySelector('[aria-label="Change labels for TEST-4"]').title`,
      ),
    ).toBe("");
    await page.waitFor(
      `document.querySelector('[aria-label="Local save status"]').textContent.includes('Saved')`,
    );
    await page.reload();
    await page.waitFor(
      `document.querySelector('[aria-label="Change assignee for TEST-4"]')?.title==='Alex'`,
    );
    expect(
      await page.eval(
        `document.querySelector('[aria-label="Change labels for TEST-4"]').title`,
      ),
    ).toBe("");
  });
  await test.step("row status, priority and labels change locally, undo, sort and persist with no Jira writes", async () => {
    await page.waitFor(`!!document.querySelector('[data-sub-issue="TEST-3"]')`);
    await page.click('[aria-label="Change status for TEST-3"]');
    await page.click('[role=dialog] [cmdk-item][data-value="Todo"]');
    await page.waitFor(
      `document.querySelector('[data-sub-issues]').textContent.includes('0/3')`,
    );
    await page.click('[aria-label="Undo"]');
    await page.waitFor(
      `document.querySelector('[data-sub-issues]').textContent.includes('1/3')`,
    );
    await page.click('[aria-label="Sub-issue display options"]');
    await show(page, "Priority", "Labels");
    await page.key("Escape");
    await page.click('[aria-label="Change priority for TEST-4"]');
    await page.click("text=Urgent");
    expect(
      await page.eval(
        `document.querySelector('[aria-label="Change priority for TEST-4"]').title`,
      ),
    ).toBe("Urgent");
    await page.click('[aria-label="Change labels for TEST-4"]');
    await page.type("ui");
    await page.click("text=ui");
    await page.key("Escape");
    expect(
      await page.eval(
        `document.querySelector('[aria-label="Change labels for TEST-4"]').textContent`,
      ),
    ).toContain("ui");
    await page.click('[aria-label="Sub-issue display options"]');
    await page.eval(
      `const select=document.querySelector('[aria-label="Sub-issue ordering"]');select.value='priority';select.dispatchEvent(new Event('change',{bubbles:true}))`,
    );
    await page.key("Escape");
    expect(
      await page.eval(
        `document.querySelector('[data-sub-issue][data-depth="1"]').getAttribute('data-sub-issue')`,
      ),
    ).toBe("TEST-4");
    await page.waitFor(
      `document.querySelector('[aria-label="Local save status"]').textContent.includes('Saved')`,
    );
    await page.reload();
    await page.waitFor(
      `document.querySelector('[aria-label="Change priority for TEST-4"]')?.title==='Urgent'`,
    );
    expect(
      await page.eval(
        `document.querySelector('[aria-label="Change labels for TEST-4"]').textContent`,
      ),
    ).toContain("ui");
    const { requests } = await (await fetch(`${fixture.url}__fixture`)).json();
    expect(
      requests.some(
        (r: any) => r.method !== "GET" && r.path.startsWith("/api/"),
      ),
    ).toBe(false);
  });
});

test("sub-issue row menus act on the child, like Linear", async ({ open }) => {
  const page = await open("?issue=TEST-2&view=page", { setup: tree });
  await test.step("right-clicking a sub-issue row opens Linear's row actions, which act on that child and undo", async () => {
    const menu = (key: string) =>
      page.eval(
        `document.querySelector('[data-sub-issue="${key}"]').dispatchEvent(new MouseEvent('contextmenu',{bubbles:true,cancelable:true}))`,
      );
    const names = `[...document.querySelectorAll('[role="dialog"][aria-label="Sub-issue actions"] [cmdk-item]')].map(n=>n.getAttribute('data-value'))`;
    await page.waitFor(`!!document.querySelector('[data-sub-issue="TEST-4"]')`);
    await menu("TEST-4");
    await page.waitFor(
      `document.activeElement?.getAttribute('aria-label')==='Find sub-issue actions'`,
    );
    expect(await page.eval(names)).toEqual([
      "Status",
      "Priority",
      "Assignee",
      "Due date",
      "Labels",
      "Project",
      "More properties",
      "Create related",
      "Mark as",
      "Remove",
      "Copy",
      "Make a copy…",
      "Favorite",
      "Remind me",
      "Delete",
    ]);
    // Linear's Status ring and Priority bars, not a check mark and a list.
    expect(
      await page.eval(
        `['Status','Priority','More properties','Create related','Remove','Copy'].map(v=>document.querySelector('[cmdk-item][data-value="'+v+'"] svg path').getAttribute('d').slice(0,12))`,
      ),
    ).toEqual([
      "M8 1a7 7 0 1",
      "M1.5 10a1 1 ",
      "M8 13.5H4.5a",
      "M8 13.5H4.5a",
      "M3.5 14.5v-1",
      "M5.5 3h-1A1.",
    ]);
    expect(
      await page.eval(
        `[['More properties','M13 13.5h.01'],['Create related','M10 12.5h4'],['Remove','M13.5 11.5l-3 3']].map(([v,end])=>document.querySelector('[cmdk-item][data-value="'+v+'"] svg path').getAttribute('d').endsWith(end))`,
      ),
    ).toEqual([true, true, true]);
    await page.click('[cmdk-item][data-value="Status"]');
    await page.click(
      '[role="dialog"][aria-label="Change status"] [cmdk-item][data-value="Done"]',
    );
    await page.waitFor(
      `document.querySelector('[aria-label="Change status for TEST-4"]')?.title==='Done'`,
    );
    expect(
      await page.eval(
        `document.querySelector('[aria-label="Change status for TEST-5"]')?.title`,
      ),
    ).toBe("Todo");
    await menu("TEST-4");
    await page.type("parent");
    await page.waitFor(
      `${names}.some(n=>n.startsWith('Remove › Parent issue TEST-3 '))`,
    );
    await page.click(
      '[cmdk-item][data-value^="Remove › Parent issue TEST-3 "]',
    );
    await page.waitFor(`!document.querySelector('[data-sub-issue="TEST-4"]')`);
    await page.eval("document.activeElement?.blur()");
    await page.key("z", "meta");
    await page.waitFor(`!!document.querySelector('[data-sub-issue="TEST-4"]')`);
    // Linear's groups and hints, and Labels › toggles a label on the child.
    await menu("TEST-4");
    expect(
      await page.eval(
        `[document.querySelectorAll('[role="dialog"][aria-label="Sub-issue actions"] [cmdk-separator]').length,document.querySelector('[cmdk-item][data-value="Status"]').textContent,document.querySelector('[cmdk-item][data-value="Project"]').textContent]`,
      ),
    ).toEqual([4, "StatusS", "Project⇧ P"]);
    await page.click('[cmdk-item][data-value="Labels"]');
    const labelRow = page.page.locator(
      '[role="dialog"][aria-label="Change labels"] [cmdk-item][data-value="test"]',
    );
    const had = (await labelRow.getAttribute("aria-checked")) === "true";
    await labelRow.click();
    await menu("TEST-4");
    await page.click('[cmdk-item][data-value="Labels"]');
    await expect(labelRow).toHaveAttribute("aria-checked", String(!had));
    await page.key("Escape");
    // Project uses the same controlled menu as the issue properties.
    const project = async (row: string) => {
      await menu("TEST-4");
      await page.click('[cmdk-item][data-value="Project"]');
      await page.click(
        `[role="dialog"][aria-label="Change project"] [cmdk-item][data-value="${row}"]`,
      );
    };
    await project("No project");
    await project("Audit");
    await menu("TEST-4");
    await page.click('[cmdk-item][data-value="Project"]');
    await expect(
      page.page.locator(
        '[role="dialog"][aria-label="Change project"] [cmdk-item][data-value="Audit"] svg',
      ),
    ).toHaveCount(2);
    await page.key("Escape");
    // Due date › Tomorrow and Remind me › An hour from now act on the child, not the open issue.
    const tomorrow = "Tomorrow"; // Linear reads near due dates relatively (R2-issue-fields-D7).
    await menu("TEST-4");
    await page.type("tomorrow");
    await page.waitFor(`${names}.includes('Due date › Tomorrow')`);
    await page.click('[cmdk-item][data-value="Due date › Tomorrow"]');
    await menu("TEST-4");
    await page.type("hour from");
    await page.waitFor(`${names}.includes('Remind me › An hour from now')`);
    await page.click('[cmdk-item][data-value="Remind me › An hour from now"]');
    await page.waitFor(
      `!document.querySelector('[aria-label="Sub-issue actions"]')`,
    );
    expect(
      await page.eval(
        `[!!document.getElementById('prop-due')?.textContent.includes('${tomorrow}'),!!document.querySelector('[aria-label^="Reminder scheduled"]')]`,
      ),
    ).toEqual([false, false]);
    await page.goto("?issue=TEST-4&view=page");
    await page.waitFor(
      `document.getElementById('prop-due')?.textContent.includes('${tomorrow}')&&!!document.querySelector('[aria-label^="Reminder scheduled"]')`,
    );
  });
  await test.step("Opus review 4: sub-issue rows show Linear's blocking and blocked badges with counts", async () => {
    await page.goto("?issue=TEST-2&view=page");
    await page.waitFor(`!!document.querySelector('[data-sub-issue="TEST-4"]')`);
    expect(
      await page.eval(
        `document.querySelectorAll('[data-row-relation]').length`,
      ),
    ).toBe(0);
    await page.eval(
      `document.querySelector('[data-sub-issue="TEST-4"]').dispatchEvent(new MouseEvent('contextmenu',{bubbles:true,cancelable:true}))`,
    );
    await page.type("blocking");
    await page.waitFor(
      `!!document.querySelector('[cmdk-item][data-value="Mark as › Blocking…"]')`,
    );
    await page.click('[cmdk-item][data-value="Mark as › Blocking…"]');
    await page.waitFor(
      `document.activeElement?.tagName==='INPUT'&&!!document.activeElement.closest('[aria-label="Issue relations"]')`,
    );
    await page.type("TEST-5");
    await page.waitFor(
      `!!document.querySelector('[cmdk-item][data-value="TEST-5"]')`,
    );
    await page.key("Enter");
    await page.waitFor(
      `!document.querySelector('[role="dialog"][aria-label="Issue relations"]')`,
    );
    const badges = `[...document.querySelectorAll('[data-row-relation]')].map(n=>[n.closest('[data-sub-issue]').dataset.subIssue,n.dataset.rowRelation,n.textContent,n.querySelector('[data-relation-icon]')?.dataset.relationIcon,n.title])`;
    await page.waitFor(
      `document.querySelectorAll('[data-row-relation]').length===2`,
    );
    expect(await page.eval(badges)).toEqual([
      ["TEST-4", "blocking", "1", "blocking", "Blocking 1 issue"],
      ["TEST-5", "blocked", "1", "blocked", "Blocked by 1 issue"],
    ]);
  });
  await test.step("sub-issue row More properties, Mark as, Create related and Copy act on the child", async () => {
    const menu = async (key: string, filter: string, item: string) => {
      await page.eval(
        `document.querySelector('[data-sub-issue="${key}"]').dispatchEvent(new MouseEvent('contextmenu',{bubbles:true,cancelable:true}))`,
      );
      await page.waitFor(
        `document.activeElement?.getAttribute('aria-label')==='Find sub-issue actions'`,
      );
      await page.type(filter);
      await page.waitFor(
        `!!document.querySelector('[cmdk-item][data-value="${item}"]')`,
      );
      await page.click(`[cmdk-item][data-value="${item}"]`);
    };
    await page.waitFor(`!!document.querySelector('[data-sub-issue="TEST-4"]')`);
    // Copy: Linear's icons and the ⌘C hint on "title as link".
    await page.eval(
      `document.querySelector('[data-sub-issue="TEST-4"]').dispatchEvent(new MouseEvent('contextmenu',{bubbles:true,cancelable:true}))`,
    );
    await page.type("title as link");
    await page.waitFor(
      `!!document.querySelector('[cmdk-item][data-value="Copy › Copy title as link"]')`,
    );
    expect(
      await page.eval(
        `[!!document.querySelector('[cmdk-item][data-value="Copy › Copy title as link"] svg'),document.querySelector('[cmdk-item][data-value="Copy › Copy title as link"]').textContent]`,
      ),
    ).toEqual([true, "Copy ›Copy title as link⌘ C"]);
    await page.key("Escape");
    await menu("TEST-4", "rename", "More properties › Rename…");
    await page.waitFor(
      `document.activeElement?.getAttribute('aria-label')==='Issue title'`,
    );
    await page.key("a", "meta");
    await page.type("Renamed child");
    await page.key("Enter");
    await page.waitFor(
      `document.querySelector('[data-sub-issue="TEST-4"]').textContent.includes('Renamed child')`,
    );
    expect(
      await page.eval(
        `document.getElementById('summary').value??document.getElementById('summary').textContent`,
      ),
    ).not.toContain("Renamed child");
    await menu("TEST-4", "add link", "More properties › Add link…");
    await page.waitFor(
      `document.activeElement?.getAttribute('aria-label')==='Link URL'`,
    );
    await page.type("https://example.com/child");
    await page.click("text=Add link");
    await menu("TEST-4", "related to", "Mark as › Related to…");
    await page.waitFor(
      `document.activeElement?.getAttribute('aria-label')==='Find related issue'`,
    );
    await page.type("TEST-3");
    await page.waitFor(
      `!!document.querySelector('[cmdk-item][data-value="TEST-3"]')`,
    );
    await page.key("Enter");
    await page.waitFor(
      `!document.querySelector('[role="dialog"][aria-label="Issue relations"]')`,
    );
    expect(
      await page.eval(
        `[!!document.querySelector('a[href="https://example.com/child"]'),!!document.querySelector('[data-relation="related:TEST-3"]')]`,
      ),
    ).toEqual([false, false]);
    await menu("TEST-4", "sub-issue", "Create related › Sub-issue…");
    await page.waitFor(
      `!!document.querySelector('[role="dialog"][aria-label="New issue"], [aria-label="Issue title"]')`,
    );
    expect(
      await page.eval(`document.querySelector('[role="dialog"]').textContent`),
    ).toContain("TEST-4");
    await page.key("Escape");
    await page.goto("?issue=TEST-4&view=page");
    await page.waitFor(
      `!!document.getElementById('summary')&&!!document.querySelector('a[href="https://example.com/child"]')&&!!document.querySelector('[data-relation="related:TEST-3"]')`,
    );
  });
});

test("the inline sub-issue composer: shortcuts, Escape, drafts and descriptions", async ({
  open,
}) => {
  const page = await open("?issue=TEST-2&view=page");
  await test.step("Escape on an empty sub-issue composer closes it without confirmation and returns focus to Create", async () => {
    await page.waitFor(`!!document.querySelector('[data-create-child]')`);
    await page.click("[data-create-child]");
    await page.waitFor(
      `document.activeElement?.getAttribute('aria-label')==='Sub-issue title'`,
    );
    await page.key("Escape");
    await page.waitFor(
      `document.activeElement?.getAttribute('aria-label')==='Create sub-issue'`,
    );
    await page.key("Escape");
    await page.waitFor(
      `!document.querySelector('[aria-label="Create sub-issue"]')&&document.activeElement?.hasAttribute('data-create-child')`,
    );
    expect(await page.eval(`!!document.querySelector('[role="dialog"]')`)).toBe(
      false,
    );
    await page.click("[data-create-child]");
    await page.click(
      `[aria-label="Create sub-issue"] .rich-editor-actions button`,
    );
    await page.waitFor(
      `!document.querySelector('[aria-label="Create sub-issue"]')`,
    );
    expect(await page.eval(`!!document.querySelector('[role="dialog"]')`)).toBe(
      false,
    );
  });
  await test.step("the existing Linear shortcut opens inline creation and both submit shortcuts retain a blank composer", async () => {
    await page.waitFor(`!!document.getElementById('summary')`);
    await page.eval("document.activeElement?.blur()");
    await page.key("o", "meta", "shift");
    await page.waitFor(
      `document.activeElement?.getAttribute('aria-label')==='Sub-issue title'`,
    );
    await page.type("First inline child");
    await page.key("Enter", "meta");
    await page.waitFor(
      `document.querySelector('[data-sub-issues]').textContent.includes('First inline child')`,
    );
    await page.waitFor(
      `document.activeElement?.getAttribute('aria-label')==='Sub-issue title'`,
    );
    expect(await page.eval(`document.activeElement.value`)).toBe("");
    await page.type("Second inline child");
    await page.key("Enter", "meta", "shift");
    await page.waitFor(
      `document.querySelectorAll('[data-sub-issue]').length===2`,
    );
    expect(
      await page.eval(
        `document.querySelector('[aria-label="Sub-issue title"]').value`,
      ),
    ).toBe("");
    await page.click(
      `[aria-label="Create sub-issue"] .rich-editor-actions button`,
    );
    await page.click('[aria-label="Sub-issue display options"]');
    await page.click("text=Priority");
    await page.key("Escape");
    expect(
      await page.eval(
        `[...document.querySelectorAll('[aria-label^="Change priority for"]')].map(e=>e.title)`,
      ),
    ).toEqual(["No priority", "No priority"]);
  });
  await test.step("editing the description leaves the inline title clickable and saves both values", async () => {
    await page.waitFor(`!!document.querySelector('[data-create-child]')`);
    await page.click("[data-create-child]");
    await page.click('[aria-label="Sub-issue description"]');
    await page.type("Keep this rich child description");
    await page.click('[aria-label="Sub-issue title"]');
    await page.type("Description then title");
    await page.key("Enter", "meta");
    await page.waitFor(
      `document.querySelector('[data-sub-issues]').textContent.includes('Description then title')`,
    );
    await page.click(
      `[aria-label="Create sub-issue"] .rich-editor-actions button`,
    );
    await page.click("text=Description then title");
    await page.waitFor(
      `document.getElementById('description')?.textContent.includes('Keep this rich child description')`,
    );
  });
  await test.step("Escape follows Linear: field, then composer, then a discard confirmation; the draft survives navigation and reload until Discard", async () => {
    await page.goto("?issue=TEST-2&view=page");
    await page.waitFor(`!!document.querySelector('[data-create-child]')`);
    await page.click("[data-create-child]");
    await page.type("Unfinished child");
    await page.click('[aria-label^="Sub-issue priority."]');
    await page.click("text=High");
    await page.click('[aria-label="Sub-issue description"]');
    await page.type("Keep this unfinished body");
    await page.eval(
      `(()=>{const data=new DataTransfer();data.items.add(new File(['draft bytes'],'draft-child.txt',{type:'text/plain'}));document.querySelector('[aria-label="Sub-issue description"]').dispatchEvent(new ClipboardEvent('paste',{clipboardData:data,bubbles:true,cancelable:true}))})()`,
    );
    await page.waitFor(
      `document.querySelector('[aria-label="Sub-issue description"]').textContent.includes('draft-child.txt')&&!document.querySelector('.media-upload')`,
    );
    const composerFocused = `document.activeElement?.getAttribute('aria-label')==='Create sub-issue'`,
      confirmOpen = `document.querySelector('[role="dialog"][aria-label="Discard this draft?"]')`;
    await page.key("Escape");
    await page.waitFor(composerFocused);
    expect(await page.eval(`!!${confirmOpen}`)).toBe(false);
    await page.key("Escape");
    await page.waitFor(
      `document.activeElement?.textContent==='Discard'&&!!${confirmOpen}`,
    );
    expect(await page.eval(`${confirmOpen}.textContent`)).toContain(
      "Confirm that you want to discard this draft.",
    );
    await page.key("Escape");
    await page.waitFor(`!${confirmOpen}&&${composerFocused}`);
    expect(
      await page.eval(
        `document.querySelector('[aria-label="Sub-issue title"]').value`,
      ),
    ).toBe("Unfinished child");
    await page.goto("?issue=TEST-3&view=page");
    await page.goto("?issue=TEST-2&view=page");
    await page.click("[data-create-child]");
    expect(
      await page.eval(
        `document.querySelector('[aria-label="Sub-issue title"]').value`,
      ),
    ).toBe("Unfinished child");
    await page.waitFor(
      `document.querySelector('[aria-label="Sub-issue description"]')?.textContent.includes('draft-child.txt')`,
    );
    expect(
      await page.eval(
        `document.querySelector('[aria-label^="Sub-issue priority."]').getAttribute('aria-label')`,
      ),
    ).toContain("High");
    await page.reload();
    await page.click("[data-create-child]");
    await page.waitFor(
      `document.querySelector('[aria-label="Sub-issue description"]')?.textContent.includes('draft-child.txt')`,
    );
    expect(
      await page.eval(
        `fetch(document.querySelector('.sub-issue-composer .file-media a').href).then(r=>r.text())`,
      ),
    ).toBe("draft bytes");
    await page.click('[aria-label="Sub-issue title"]');
    await page.key("Escape");
    await page.waitFor(composerFocused);
    await page.key("o", "meta", "shift");
    await page.waitFor(
      `document.activeElement?.getAttribute('aria-label')==='Sub-issue title'`,
    );
    await page.click('[aria-label="Sub-issue description"]');
    await page.key("o", "meta", "shift");
    await page.waitFor(
      `document.activeElement?.getAttribute('aria-label')==='Sub-issue title'`,
    );
    await page.click(
      `[aria-label="Create sub-issue"] .rich-editor-actions button`,
    );
    await page.waitFor(`!!${confirmOpen}`);
    await page.click(
      '[role="dialog"][aria-label="Discard this draft?"] button',
    );
    await page.waitFor(`!${confirmOpen}`);
    expect(
      await page.eval(
        `document.querySelector('[aria-label="Sub-issue title"]').value`,
      ),
    ).toBe("Unfinished child");
    await page.click(
      `[aria-label="Create sub-issue"] .rich-editor-actions button`,
    );
    await page.waitFor(`!!${confirmOpen}`);
    await page.click("text=Discard");
    await page.waitFor(
      `!document.querySelector('[aria-label="Create sub-issue"]')&&document.activeElement?.hasAttribute('data-create-child')`,
    );
    await page.click("[data-create-child]");
    expect(
      await page.eval(
        `document.querySelector('[aria-label="Sub-issue title"]').value`,
      ),
    ).toBe("");
    expect(
      await page.eval(
        `document.querySelector('[aria-label="Sub-issue description"]').textContent`,
      ),
    ).toBe("");
    expect(
      await page.eval(
        `document.querySelector('[aria-label^="Sub-issue priority."]').getAttribute('aria-label')`,
      ),
    ).toContain("No priority");
    expect(
      await page.eval(
        `Object.keys(localStorage).some(k=>k.startsWith('better-jira:sub-issue-draft:'))`,
      ),
    ).toBe(false);
  });
  await test.step("description submit appends after siblings, clears rich content and files, and refocuses the title", async () => {
    const page = await open("?issue=TEST-2&view=page", { setup: tree });
    await page.waitFor(
      `document.querySelectorAll('[data-sub-issue]').length===3`,
    );
    await page.click("[data-create-child]");
    await page.type("Child with a file");
    await page.click('[aria-label="Sub-issue description"]');
    await page.type("Description for the first child");
    await page.eval(
      `(()=>{const data=new DataTransfer();data.items.add(new File(['child bytes'],'child-note.txt',{type:'text/plain'}));document.querySelector('[aria-label="Sub-issue description"]').dispatchEvent(new ClipboardEvent('paste',{clipboardData:data,bubbles:true,cancelable:true}))})()`,
    );
    await page.waitFor(
      `document.querySelector('[aria-label="Sub-issue description"]').textContent.includes('child-note.txt')&&!document.querySelector('.media-upload')`,
    );
    await page.key("Enter", "meta");
    await page.waitFor(
      `document.querySelectorAll('[data-sub-issue]').length===4`,
    );
    await page.waitFor(
      `document.activeElement?.getAttribute('aria-label')==='Sub-issue title'`,
    );
    expect(
      await page.eval(
        `document.querySelector('[aria-label="Sub-issue description"]').textContent`,
      ),
    ).toBe("");
    expect(
      await page.eval(
        `[...document.querySelectorAll('[data-sub-issue]')].at(-1)?.textContent`,
      ),
    ).toContain("Child with a file");
    await page.click(
      `[aria-label="Create sub-issue"] .rich-editor-actions button`,
    );
    await page.click("text=Child with a file");
    await page.waitFor(
      `document.getElementById('description')?.textContent.includes('child-note.txt')`,
    );
    expect(
      await page.eval(`document.getElementById('description').textContent`),
    ).toContain("Description for the first child");
    await page.waitFor(
      `document.querySelector('[aria-label="Local save status"]').textContent.includes('Saved')`,
    );
    await page.reload();
    await page.waitFor(
      `!!document.querySelector('#description .file-media a')`,
    );
    expect(
      await page.eval(
        `fetch(document.querySelector('#description .file-media a').href).then(r=>r.text())`,
      ),
    ).toBe("child bytes");
  });
});

test("a sub-issue draft's late upload or file save never loses newer edits or revives a discarded draft", async ({
  open,
}) => {
  const page = await open("?issue=TEST-2&view=page");
  await test.step("a sub-issue upload that finishes after leaving keeps newer draft edits, and a discarded draft stays discarded", async () => {
    const go = async (key: string) => {
      await page.eval(
        `history.pushState({},'','?issue=${key}&view=page');dispatchEvent(new PopStateEvent('popstate'))`,
      );
      await page.waitFor(
        `new URL(location.href).searchParams.get('issue')==='${key}'&&!!document.getElementById('comment')`,
      );
    };
    const paste = (name: string) =>
      page.eval(
        `window.releaseBitmap=undefined;window.createImageBitmap=()=>new Promise(resolve=>{window.releaseBitmap=()=>resolve({width:10,height:10,close(){}})});(()=>{const d=new DataTransfer();d.items.add(new File([new Uint8Array([137,80,78,71])],'${name}',{type:'image/png'}));document.querySelector('[aria-label="Sub-issue description"]').dispatchEvent(new ClipboardEvent('paste',{clipboardData:d,bubbles:true,cancelable:true}))})()`,
      );
    const media = `document.querySelectorAll('[aria-label="Sub-issue description"] img, [aria-label="Sub-issue description"] [data-media-action], [aria-label="Sub-issue description"] .media-frame').length`;
    const openComposer = async () => {
      await page.eval("document.activeElement?.blur()");
      await page.key("o", "meta", "shift");
      await page.waitFor(
        `document.activeElement?.getAttribute('aria-label')==='Sub-issue title'`,
      );
    };
    await page.waitFor(`!!document.getElementById('summary')`);
    await openComposer();
    await page.type("Late child");
    await page.click('[aria-label="Sub-issue description"]');
    await paste("late-child.png");
    await page.waitFor(`typeof window.releaseBitmap==='function'`);
    await go("TEST-3");
    await go("TEST-2");
    await openComposer();
    await page.key("End");
    await page.type(" NEWER");
    await page.eval("window.releaseBitmap()");
    await page.waitFor(`${media}>0`, 8000);
    expect(
      await page.eval(
        `document.querySelector('[aria-label="Sub-issue title"]').value`,
      ),
    ).toBe("Late child NEWER");
    await page.reload();
    await page.waitFor(`!!document.getElementById('summary')`);
    await openComposer();
    await page.waitFor(`${media}>0`, 8000);
    expect(
      await page.eval(
        `document.querySelector('[aria-label="Sub-issue title"]').value`,
      ),
    ).toBe("Late child NEWER");
    // Discarding while a paste is still uploading: the file does not come back into the next draft.
    await page.click('[aria-label="Sub-issue description"]');
    await paste("discarded.png");
    await page.waitFor(`typeof window.releaseBitmap==='function'`);
    await page.click(
      `[aria-label="Create sub-issue"] .rich-editor-actions button`,
    );
    await page.waitFor(
      `!!document.querySelector('[role="dialog"][aria-label="Discard this draft?"] [data-autofocus]')`,
    );
    await page.click(
      '[role="dialog"][aria-label="Discard this draft?"] [data-autofocus]',
    );
    await page.waitFor(
      `!document.querySelector('[aria-label="Sub-issue title"]')`,
    );
    await page.eval("window.releaseBitmap()");
    await sleep(600);
    await openComposer();
    await sleep(300);
    expect(
      await page.eval(
        `[document.querySelector('[aria-label="Sub-issue title"]').value,${media}]`,
      ),
    ).toEqual(["", 0]);
    await page.reload();
    await page.waitFor(`!!document.getElementById('summary')`);
    await openComposer();
    await sleep(300);
    expect(
      await page.eval(
        `[document.querySelector('[aria-label="Sub-issue title"]').value,${media}]`,
      ),
    ).toEqual(["", 0]);
  });
  await test.step("a sub-issue file save that finishes after leaving adds the file to the current draft without dropping newer edits; after a discard it adds nothing", async () => {
    await page.reload(); // a closed composer, as on a fresh page
    const go = async (key: string) => {
      await page.eval(
        `history.pushState({},'','?issue=${key}&view=page');dispatchEvent(new PopStateEvent('popstate'))`,
      );
      await page.waitFor(
        `new URL(location.href).searchParams.get('issue')==='${key}'&&!!document.getElementById('comment')`,
      );
    };
    // Hold the local file save (the IndexedDB transaction) until releaseFiles().
    const paste = (name: string) =>
      page.eval(
        `window.createImageBitmap=async()=>({width:10,height:10,close(){}});window.releaseFiles=undefined;{const d=Object.getOwnPropertyDescriptor(IDBTransaction.prototype,'oncomplete');Object.defineProperty(IDBTransaction.prototype,'oncomplete',{configurable:true,get(){return d.get.call(this);},set(fn){if(this.mode==='readwrite'&&[...this.objectStoreNames].includes('files')&&!window.releaseFiles){d.set.call(this,()=>{window.releaseFiles=()=>{Object.defineProperty(IDBTransaction.prototype,'oncomplete',d);fn();};});}else d.set.call(this,fn);}});}(()=>{const t=new DataTransfer();t.items.add(new File([new Uint8Array([137,80,78,71])],'${name}',{type:'image/png'}));document.querySelector('[aria-label="Sub-issue description"]').dispatchEvent(new ClipboardEvent('paste',{clipboardData:t,bubbles:true,cancelable:true}))})()`,
      );
    const stored = `(()=>{const key=Object.keys(localStorage).find(k=>k.startsWith('better-jira:sub-issue-draft:v1:')&&k.endsWith(':TEST-2'));const d=key&&JSON.parse(localStorage.getItem(key));return d?[d.title,d.files.length]:null;})()`;
    const openComposer = async () => {
      await page.eval("document.activeElement?.blur()");
      await page.key("o", "meta", "shift");
      await page.waitFor(
        `document.activeElement?.getAttribute('aria-label')==='Sub-issue title'`,
      );
    };
    await page.waitFor(`!!document.getElementById('summary')`);
    await openComposer();
    await page.type("Saved late");
    await page.click('[aria-label="Sub-issue description"]');
    await paste("late-file.png");
    await page.waitFor(`typeof window.releaseFiles==='function'`);
    await go("TEST-3");
    await go("TEST-2");
    await openComposer();
    await page.key("End");
    await page.type(" NEWER");
    await page.eval("window.releaseFiles()");
    await page.waitFor(
      `JSON.stringify(${stored})==='["Saved late NEWER",1]'`,
      8000,
    );
    // Discarded while the save is held: nothing is added to the next draft.
    await page.click('[aria-label="Sub-issue description"]');
    await paste("dropped-file.png");
    await page.waitFor(`typeof window.releaseFiles==='function'`);
    await page.click(
      `[aria-label="Create sub-issue"] .rich-editor-actions button`,
    );
    await page.waitFor(
      `!!document.querySelector('[role="dialog"][aria-label="Discard this draft?"] [data-autofocus]')`,
    );
    await page.click(
      '[role="dialog"][aria-label="Discard this draft?"] [data-autofocus]',
    );
    await page.waitFor(
      `!document.querySelector('[aria-label="Sub-issue title"]')`,
    );
    await page.eval("window.releaseFiles()");
    await sleep(600);
    expect(await page.eval(stored)).toBeNull(); // an empty draft is not stored
  });
});
