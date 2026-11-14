import { expect, fixture, PREFS_KEY, sleep, test, type App } from "./app";

/**
 * Linear's Project is a Jira epic (decision 2026-11-14, src/shared/epics.ts). Writable fixture with `epics`: TEST-7 "Fixture
 * epic" (open) and TEST-8 "Shipped epic" (done) are Epics; TEST-2 and TEST-3 sit in TEST-7; TEST-1, 4, 5 and 6 are in none.
 * Every issue stays in Jira project TEST ("Audit"), Linear's team, which no Project surface offers.
 */
const MENU = '[role="dialog"][aria-label="Issue options"]';
const PICKER = '[role="dialog"][aria-label="Change epic"]';
const cards = `document.querySelectorAll('[data-key]').length`;
const names = (p: App, dialog: string) =>
  p.eval<string[]>(
    `[...document.querySelectorAll('${dialog} [cmdk-item]')].map(n=>n.querySelector(".menu-name")?.textContent??n.dataset.value)`,
  );
const wrote = (p: App, key: string, parent: string | null) =>
  expect
    .poll(async () =>
      (await fixture.log()).writes.some(
        (w) => w.key === key && w.ops.some((o: any) => o.op === "fields" && o.fields.parent === parent),
      ),
    )
    .toBe(true);
async function prefs(p: App, display: object) {
  await p.eval(`localStorage.setItem(${JSON.stringify(PREFS_KEY)},${JSON.stringify(JSON.stringify({ 1: { display } }))})`);
  await p.reload();
}

test("Project is the issue's epic: filter, card badge, grouping, ⇧P, right-click and the detail pill", async ({ open }) => {
  await fixture.reset({ writable: true, epics: true });
  const p = await open();
  await p.waitFor(`${cards}===8`);

  await test.step("Filter › Project lists No epic and the board's epics with their issue counts, never the Jira project", async () => {
    await p.click('[aria-label="Add filter"]');
    await p.hover("text=Epic");
    await p.waitFor(`!!document.querySelector('[aria-label="Filter Epic"] [cmdk-item]')`);
    const rows = await p.eval<string[]>(
      `[...document.querySelectorAll('[aria-label="Filter Epic"] [cmdk-item]')].map(n=>n.dataset.value)`,
    );
    expect(rows).toEqual(["No epic $none", "Fixture epic TEST-7", "Shipped epic TEST-8"]);
    expect(rows.join()).not.toContain("Audit");
    expect(await p.eval(`document.querySelector('[aria-label="Filter Epic"] [cmdk-item][data-value="Fixture epic TEST-7"]').textContent`)).toContain("3 issues");
    await p.click('[aria-label="Filter Epic"] [cmdk-item][data-value="Fixture epic TEST-7"]');
    // The epic lists with its issues, as a Linear project page does.
    await p.waitFor(`${cards}===3`);
    await p.key("Escape");
    await p.click('[aria-label="Remove project filter"]');
    await p.waitFor(`${cards}===8`);
    await p.click('[aria-label="Add filter"]');
    await p.hover("text=Epic");
    await p.click('[aria-label="Filter Epic"] [cmdk-item][data-value="No epic $none"]');
    await p.waitFor(`${cards}===4`);
    await p.key("Escape");
    await p.click('[aria-label="Remove project filter"]');
    await p.waitFor(`${cards}===8`);
  });

  await test.step("Project properties read the epic: Project status Done finds the Shipped epic", async () => {
    await p.click('[aria-label="Add filter"]');
    await p.hover("text=Epic properties");
    await p.hover("text=Epic status");
    await p.waitFor(`!!document.querySelector('[aria-label="Filter Epic status"] [cmdk-item]')`);
    expect(
      await p.eval<string[]>(`[...document.querySelectorAll('[aria-label="Filter Epic status"] [cmdk-item]')].map(n=>n.dataset.value)`),
    ).toEqual(expect.arrayContaining([expect.stringContaining("Todo"), expect.stringContaining("Done")]));
    await p.key("Escape");
  });

  await test.step("display: the card's Project badge names its epic, and grouping by project makes one column per epic", async () => {
    await prefs(p, { properties: ["id", "project"] });
    await p.waitFor(`document.querySelector('[data-key="TEST-2"]')?.textContent.includes("Fixture epic")`);
    expect(await p.eval(`document.querySelector('[data-key="TEST-1"]').textContent.includes("epic")`)).toBe(false);
    await prefs(p, { columns: "project", properties: ["id"] });
    await p.waitFor(`!!document.querySelector('[data-board-column="Fixture epic"]')`);
    const column = (name: string) =>
      p.eval<string[]>(`[...document.querySelectorAll('[data-board-column="${name}"] [data-key]')].map(n=>n.dataset.key).sort()`);
    expect(await column("Fixture epic")).toEqual(["TEST-2", "TEST-3", "TEST-7"]);
    expect(await column("Shipped epic")).toEqual(["TEST-8"]);
    expect(await column("No epic")).toEqual(["TEST-1", "TEST-4", "TEST-5", "TEST-6"]);
    await prefs(p, {});
  });

  await test.step("right-click › Project: No epic and the open epics; picking one writes only the Jira parent", async () => {
    await p.waitFor(`${cards}===8`);
    const r = await p.rect('[data-key="TEST-4"]');
    await p.page.mouse.click(r.x + r.width / 2, r.y + r.height / 2, { button: "right" });
    await p.hover(`${MENU} [cmdk-item][data-value="Epic"]`);
    await p.waitFor(`!!document.querySelector('[role="dialog"][aria-label="Epic"] [cmdk-item]')`);
    // Linear hides a completed project unless it is current or searched for.
    expect(await names(p, '[role="dialog"][aria-label="Epic"]')).toEqual(["No epic", "Fixture epic"]);
    await p.click('[role="dialog"][aria-label="Epic"] [cmdk-item][data-value="Fixture epic"]');
    await wrote(p, "TEST-4", "TEST-7");
  });

  await test.step("an epic is a project itself: its right-click Project row is disabled", async () => {
    const r = await p.rect('[data-key="TEST-7"]');
    await p.page.mouse.click(r.x + r.width / 2, r.y + r.height / 2, { button: "right" });
    await p.waitFor(`!!document.querySelector('${MENU} [cmdk-item][data-value="Epic"]')`);
    expect(await p.eval(`document.querySelector('${MENU} [cmdk-item][data-value="Epic"]').getAttribute('aria-disabled')`)).toBe("true");
    await p.key("Escape");
  });

  await test.step("⇧P on a Task: Add to project, a done epic shows once searched, No epic takes the epic away", async () => {
    await p.goto("?issue=TEST-1&view=page");
    await p.waitFor(`!!document.getElementById('comment')`);
    expect(await p.eval(`document.getElementById('prop-project')?.tagName`)).toBe("BUTTON");
    await p.eval("document.activeElement?.blur()");
    await p.key("p", "shift");
    await p.waitFor(`!!document.querySelector('${PICKER} [cmdk-item]')`);
    expect(await p.eval(`document.querySelector('${PICKER} input')?.placeholder`)).toBe("Add to epic…");
    expect(await names(p, PICKER)).toEqual(["No epic", "Fixture epic"]);
    await p.type("shi");
    await expect.poll(() => names(p, PICKER)).toContain("Shipped epic");
    await p.key("Escape");
    await p.goto("?issue=TEST-2&view=page");
    await p.waitFor(`document.getElementById('prop-project')?.textContent.includes("Fixture epic")`);
    await p.eval("document.activeElement?.blur()");
    await p.key("p", "shift");
    await p.waitFor(`!!document.querySelector('${PICKER} [cmdk-item]')`);
    expect(await p.eval(`document.querySelector('${PICKER} input')?.placeholder`)).toBe("Move to epic…");
    await p.key("0");
    await wrote(p, "TEST-2", null);
  });

  await test.step("the epic's own detail: its project is itself, read-only, and ⇧P opens nothing", async () => {
    await p.goto("?issue=TEST-7&view=page");
    await p.waitFor(`!!document.getElementById('comment')`);
    expect(await p.eval(`document.getElementById('prop-project')?.tagName`)).toBe("SPAN");
    expect(await p.eval(`document.getElementById('prop-project')?.textContent`)).toBe("Fixture epic");
    await p.eval("document.activeElement?.blur()");
    await p.key("p", "shift");
    await sleep(150); // no project menu opens
    expect(await p.eval(`!!document.querySelector('${PICKER}')`)).toBe(false);
  });

  await test.step("no Project surface ever wrote the Jira project", async () => {
    const { writes } = await fixture.log();
    expect(JSON.stringify(writes)).not.toContain('"project"');
  });
});

/** The board's Project filter, set before the app loads (once, so a reload keeps what the test changed). */
const projectFilter = (...values: string[]) => {
  const prefs = { 1: { filters: { id: "root", join: "and", children: [{ id: "p", field: "project", op: "is", values }] } } };
  return `if(!sessionStorage.seeded){sessionStorage.seeded=1;localStorage.setItem(${JSON.stringify(PREFS_KEY)},${JSON.stringify(JSON.stringify(prefs))});}`;
};
const COMPOSER = '[role="dialog"][aria-label="Create issue"]';

test("C on a view filtered by one project creates the issue in that epic (Linear's GZt)", async ({ open }) => {
  await fixture.reset({ writable: true, epics: true, createSuccess: true });
  const p = await open("", { setup: projectFilter("TEST-7") });
  await p.waitFor(`${cards}===3`);
  await p.eval("document.activeElement?.blur()");
  await p.key("c");
  await p.waitFor(`!!document.querySelector('${COMPOSER} [aria-label="Epic: Fixture epic"]')`);
  await p.eval(`document.querySelector('${COMPOSER} [aria-label="Issue title"]').focus()`);
  await p.type("[QA] filtered by project");
  await p.key("Enter", "meta");
  await expect
    .poll(async () =>
      (await fixture.log()).writes.some((w) =>
        w.ops.some((o: any) => o.op === "create" && o.fields.parent === "TEST-7"),
      ),
    )
    .toBe(true);
});

test("a project filter naming two epics sets none and lists both first in the composer's picker, done or not", async ({ open }) => {
  await fixture.reset({ writable: true, epics: true });
  const p = await open("", { setup: projectFilter("TEST-8", "TEST-7") });
  await p.waitFor(`${cards}===4`);
  await p.eval("document.activeElement?.blur()");
  await p.key("c");
  await p.waitFor(`!!document.querySelector('${COMPOSER} [aria-label="Epic: No epic"]')`);
  await p.click(`${COMPOSER} [aria-label="Epic: No epic"]`);
  await p.waitFor(`!!document.querySelector('${PICKER} [cmdk-item]')`);
  // Shipped epic is done, so it shows only because the filter names it; the filter's order holds.
  expect(await names(p, PICKER)).toEqual(["No epic", "Shipped epic", "Fixture epic"]);
});

test("\"No epic\" filter: the composer starts with no project", async ({ open }) => {
  await fixture.reset({ writable: true, epics: true });
  const p = await open("", { setup: projectFilter("$none") });
  await p.waitFor(`${cards}===4`);
  await p.eval("document.activeElement?.blur()");
  await p.key("c");
  await p.waitFor(`!!document.querySelector('${COMPOSER} [aria-label="Epic: No epic"]')`);
});

/**
 * BJ-247: an epic parent is the issue's Project, never its Parent (shared/epics.ts parentOf), as Linear keeps `issue.parent` and
 * `issue.project` apart. Fixture with `epics` and `subtask`: TEST-2 and TEST-3 sit in epic TEST-7; TEST-6 is a Subtask of TEST-5.
 * BJ-289, the user's deviation from Linear (.raj/done.md): the "Sub-issue of" line under the title alone names the epic
 * (shared/epics.ts titleParentOf); every Parent surface stays epic-free.
 */
test("an epic parent shows as Project and on the title line only: no Parent, Parent filter, grouping, nesting or ⌘⇧P", async ({ open }) => {
  await fixture.reset({ writable: true, epics: true, subtask: true });
  const p = await open();
  await p.waitFor(`${cards}===8`);
  const RELATIONS = '[role="dialog"][aria-label="Issue relations"]';
  const items = (dialog: string) =>
    p.eval<string[]>(`[...document.querySelectorAll('${dialog} [cmdk-item]')].map(n=>n.getAttribute('data-value'))`);

  await test.step("Show sub-issues off hides the Subtask only; the epic's issues stay", async () => {
    await prefs(p, { subIssues: false });
    await p.waitFor(`${cards}===7`);
    expect(await p.eval(`!!document.querySelector('[data-key="TEST-2"]')&&!!document.querySelector('[data-key="TEST-3"]')`)).toBe(true);
    expect(await p.eval(`!!document.querySelector('[data-key="TEST-6"]')`)).toBe(false);
    await prefs(p, {});
    await p.waitFor(`${cards}===8`);
  });

  await test.step("grouping by parent: the epic's issues are in No parent, and only TEST-5 names a group", async () => {
    await prefs(p, { columns: "parent", properties: ["id"] });
    await p.waitFor(`!!document.querySelector('[data-board-column="No parent"]')`);
    const columns = await p.eval<string[]>(`[...document.querySelectorAll('[data-board-column]')].map(n=>n.dataset.boardColumn)`);
    expect(columns.some((c) => c.includes("TEST-7"))).toBe(false);
    expect(columns.some((c) => c.includes("TEST-5"))).toBe(true);
    expect(
      await p.eval<string[]>(`[...document.querySelectorAll('[data-board-column="No parent"] [data-key]')].map(n=>n.dataset.key)`),
    ).toEqual(expect.arrayContaining(["TEST-2", "TEST-3", "TEST-7"]));
    await prefs(p, {});
    await p.waitFor(`${cards}===8`);
  });

  await test.step("Filter › Parent issue lists TEST-5, never the epic", async () => {
    await p.click('[aria-label="Add filter"]');
    await p.hover("text=Parent issue");
    await p.waitFor(`!!document.querySelector('[aria-label="Filter Parent issue"] [cmdk-item]')`);
    const rows = await p.eval<string[]>(
      `[...document.querySelectorAll('[aria-label="Filter Parent issue"] [cmdk-item]')].map(n=>n.dataset.value)`,
    );
    expect(rows.join()).toContain("TEST-5");
    expect(rows.join()).not.toContain("TEST-7");
    await p.key("Escape");
    await p.key("Escape");
  });

  await test.step("BJ-289: an issue in the epic with no parent Task: its Sub-issue of line names the epic, with the epic's progress", async () => {
    await p.goto("?issue=TEST-2&view=page");
    await p.waitFor(`document.querySelector('[data-parent-link]')?.textContent.includes("TEST-7")`);
    // The line reads as a parent's does: label, the epic's status, key and title, then its issues' progress (TEST-2 and TEST-3).
    expect(
      await p.eval<string[]>(`[...document.querySelector('[data-parent-link]').parentElement.children].map(n=>n.textContent)`),
    ).toEqual(["Sub-issue of", "TEST-7Fixture epic", expect.stringMatching(/^\d\/2$/)]);
    expect(await p.eval(`document.querySelector('[data-parent-progress]').getAttribute('aria-label')`)).toBe("Open sub-issues of TEST-7");
    // The ring opens Open sub-issue… over the epic's issues, this one checked; picking the other opens it.
    await p.click("[data-parent-progress]");
    const MENU7 = '[role=dialog][aria-label="Open sub-issues of TEST-7"]';
    await p.waitFor(`document.querySelectorAll('${MENU7} [cmdk-item]').length===2`);
    expect(
      await p.eval<string[]>(`[...document.querySelectorAll('${MENU7} [cmdk-item]')].map(n=>n.textContent.slice(0,6)).sort()`),
    ).toEqual(["TEST-2", "TEST-3"]);
    await p.click(`${MENU7} [cmdk-item][data-value^="TEST-3 "]`);
    await p.waitFor(`new URLSearchParams(location.search).get('issue')==='TEST-3'`);
    // ⌘⇧→ (Open sub-issues of parent) opens the same menu, as the line and the shortcut read one helper.
    await p.waitFor(`document.querySelector('[data-parent-link]')?.textContent.includes("TEST-7")`);
    await p.eval("document.activeElement?.blur()");
    await p.key("ArrowRight", "meta", "shift");
    await p.waitFor(`document.querySelectorAll('${MENU7} [cmdk-item]').length===2`);
    await p.key("Escape");
    // Clicking the epic opens it.
    await p.click("[data-parent-link]");
    await p.waitFor(`new URLSearchParams(location.search).get('issue')==='TEST-7'`);
  });

  await test.step("an issue in the epic: Project names it, Remove has no parent, ⌘⇧P offers no epic, ⌘⇧↑ opens nothing", async () => {
    await p.goto("?issue=TEST-2&view=page");
    await p.waitFor(`document.getElementById('prop-project')?.textContent.includes("Fixture epic")`);
    // The epic is never a Parent property in the sidebar (BJ-247).
    expect(await p.eval(`!!document.getElementById('prop-parent')`)).toBe(false);
    await p.click("#issue-options");
    await p.type("remove");
    await sleep(150); // a Remove › Parent issue row would show by now
    expect((await items('[role="dialog"][aria-label="Issue options"]')).join()).not.toContain("Parent issue TEST-7");
    await p.key("Escape");
    await p.eval("document.activeElement?.blur()");
    await p.key("p", "meta", "shift");
    await p.waitFor(`!!document.querySelector('${RELATIONS}')`);
    await sleep(150); // no parent shows up late
    // Jira takes only an epic above a Task, and an epic is a project: no parent issue is offered.
    expect(await items(RELATIONS)).toEqual([]);
    await p.key("Escape");
    // Open parent issue (⌘⇧↑) has no parent issue to open.
    await p.eval("document.activeElement?.blur()");
    await p.key("ArrowUp", "meta", "shift");
    await sleep(150);
    expect(await p.eval(`new URLSearchParams(location.search).get('issue')`)).toBe("TEST-2");
  });

  await test.step("the epic's detail lists its issues as Jira's epic page does (BJ-280), has no parent line; ⌘⇧P opens nothing", async () => {
    await p.goto("?issue=TEST-7&view=page");
    await p.waitFor(`document.querySelectorAll('[data-sub-issues="TEST-7"] [data-sub-issue]').length===2`);
    expect(
      await p.eval<string[]>(`[...document.querySelectorAll('[data-sub-issue]')].map(n=>n.dataset.subIssue).sort()`),
    ).toEqual(["TEST-2", "TEST-3"]);
    expect(await p.eval(`!!document.querySelector('[data-parent-link]')`)).toBe(false);
    await p.eval("document.activeElement?.blur()");
    await p.key("p", "meta", "shift");
    await sleep(150); // no relations picker opens
    expect(await p.eval(`!!document.querySelector('${RELATIONS}')`)).toBe(false);
  });

  await test.step("a Subtask's parent issue still shows as Sub-issue of, and the parent lists it", async () => {
    await p.goto("?issue=TEST-6&view=page");
    await p.waitFor(`document.querySelector('[data-parent-link]')?.textContent.includes("TEST-5")`);
    // Its ring lists its Task's sub-issues, never the epic's.
    await p.click("[data-parent-progress]");
    await p.waitFor(`!!document.querySelector('[role=dialog][aria-label="Open sub-issues of TEST-5"] [cmdk-item]')`);
    await p.key("Escape");
    await p.goto("?issue=TEST-5&view=page");
    await p.waitFor(`!!document.querySelector('[data-sub-issue="TEST-6"]')`);
  });

  await test.step("no Parent surface wrote a parent", async () => {
    const { writes } = await fixture.log();
    expect(writes.some((w: any) => w.ops.some((o: any) => o.op === "fields" && "parent" in o.fields))).toBe(false);
  });
});

/**
 * BJ-280, the user's deviation from Linear (.raj/done.md): an epic's page lists its issues in its Sub-issues section, as Jira's
 * epic page lists its child work items, with the section's own rows, progress, menus and shortcuts. Adding there puts the new
 * issue in the epic as the Epic picker does; on the child the epic still shows once, as its Epic. Fixture as above.
 */
test("BJ-280: an epic's Sub-issues section lists, adds and removes its issues; a child names the epic only as Epic", async ({ open }) => {
  await fixture.reset({ writable: true, epics: true, subtask: true, createSuccess: true });
  const p = await open("?issue=TEST-5&view=page");
  const SECTION = '[data-sub-issues="TEST-7"]';
  const rows = () =>
    p.eval<string[]>(`[...document.querySelectorAll('${SECTION} [data-sub-issue]')].map(n=>n.dataset.subIssue+":"+n.dataset.depth)`);
  const created = (summary: string) =>
    expect
      .poll(async () =>
        (await fixture.log()).writes.some((w) =>
          w.ops.some((o: any) => o.op === "create" && o.fields.parent === "TEST-7" && o.fields.summary?.includes(summary)),
        ),
      )
      .toBe(true);

  await test.step("TEST-5 joins the epic with ⇧P; its Subtask TEST-6 comes along nested under it, never flat on the epic", async () => {
    await p.waitFor(`document.getElementById('prop-project')?.tagName==='BUTTON'`);
    await p.eval("document.activeElement?.blur()");
    await p.key("p", "shift");
    await p.waitFor(`!!document.querySelector('${PICKER} [cmdk-item]')`);
    await p.type("Fixture");
    await p.key("Enter");
    await wrote(p, "TEST-5", "TEST-7");
    await p.goto("?issue=TEST-7&view=page");
    await p.waitFor(`document.querySelectorAll('${SECTION} [data-sub-issue]').length===4`);
    expect((await rows()).sort()).toEqual(["TEST-2:0", "TEST-3:0", "TEST-5:0", "TEST-6:1"]);
    // The section's progress counts the epic's own issues; TEST-5's row shows its Subtask's progress, as any parent's row does.
    expect(await p.eval(`document.querySelector('${SECTION} [data-sub-progress]').textContent`)).toMatch(/\/3$/);
    expect(await p.eval(`document.querySelector('[data-sub-issue="TEST-5"] [data-row-progress]')?.textContent`)).toBe("0/1");
  });

  await test.step("BJ-281: cards and rows carry Linear's sub-issue badge, counted as the Sub-issues section counts, with no display toggle", async () => {
    // The section header counts every level below the epic, as Linear's list row badge (`at`: t.descendants) does.
    const header = await p.eval<string>(`document.querySelector('${SECTION} [data-sub-progress]').textContent`);
    const badge = (key: string) => p.eval<string | null>(`document.querySelector('[data-key="${key}"] [data-sub-issue-progress]')?.textContent ?? null`);
    await p.goto("/board/1/all");
    // Only the identifier is on: the badge isn't a display property, so it stays (Linear `bd`: showSubIssues = children.length > 0).
    await prefs(p, { layout: "board", properties: ["id"] });
    await p.waitFor(`!!document.querySelector('[data-key="TEST-7"] [data-sub-issue-progress]')`);
    // A card counts its direct sub-issues (Linear `wd`: t.children): the epic's three issues, and TEST-5's one Subtask.
    expect(await badge("TEST-7")).toMatch(/^\d\/3$/);
    expect(await badge("TEST-5")).toBe("0/1");
    expect(await badge("TEST-1")).toBeNull();
    expect(await p.eval(`document.querySelector('[data-key="TEST-7"] [data-sub-issue-progress] svg circle')?.closest('.ui-badge-icon')?.getBoundingClientRect().height`)).toBe(14);
    // Several sub-issues: a click lists the direct ones under the badge ("Open sub-issue…"); the card doesn't open.
    expect(await p.eval(`document.querySelector('[data-key="TEST-7"] [data-sub-issue-progress]').title`)).toMatch(/^Open sub-issue…/);
    await p.click('[data-key="TEST-7"] [data-sub-issue-progress]');
    await p.waitFor(`document.querySelectorAll('[role=dialog][aria-label="Open sub-issues of TEST-7"] [cmdk-item]').length===3`);
    await p.key("Escape");
    // One sub-issue: a click opens it, as Linear's Open sub-issue does for a lone child.
    await p.click('[data-key="TEST-5"] [data-sub-issue-progress]');
    await p.waitFor(`location.search.includes("TEST-6")`);
    await p.goto("/board/1/all");
    await prefs(p, { layout: "list", properties: ["id"] });
    await p.waitFor(`!!document.querySelector('[data-key="TEST-7"] [data-sub-issue-progress]')`);
    // A row counts every level below, so the epic's row reads what its section's header reads.
    expect(await badge("TEST-7")).toBe(header);
    expect(await badge("TEST-5")).toBe("0/1");
  });

  await test.step("BJ-289: a child names the epic as Epic and on its Sub-issue of line, never as Parent; its Subtask's line stays TEST-5", async () => {
    await p.goto("?issue=TEST-2&view=page");
    await p.waitFor(`document.getElementById('prop-project')?.textContent.includes("Fixture epic")`);
    await p.waitFor(`document.querySelector('[data-parent-link]')?.textContent.includes("TEST-7")`);
    expect(await p.eval(`!!document.getElementById('prop-parent')`)).toBe(false);
    // The ring counts what the epic's section header counts: TEST-2, TEST-3, TEST-5 and its Subtask TEST-6.
    expect(await p.eval(`document.querySelector('[data-parent-progress]').textContent`)).toMatch(/^\d\/4$/);
    // TEST-5 now sits in the epic with no parent Task: its line names the epic too.
    await p.goto("?issue=TEST-5&view=page");
    await p.waitFor(`document.querySelector('[data-parent-link]')?.textContent.includes("TEST-7")`);
    // A Subtask names its Task, never the epic above it.
    await p.goto("?issue=TEST-6&view=page");
    await p.waitFor(`document.querySelector('[data-parent-link]')?.textContent.includes("TEST-5")`);
    expect(await p.eval(`document.querySelector('[data-parent-link]').textContent.includes("TEST-7")`)).toBe(false);
  });

  await test.step("the inline add row creates the issue in the epic, writing the epic as the Epic picker does", async () => {
    await p.goto("?issue=TEST-7&view=page");
    await p.waitFor(`!!document.querySelector('${SECTION} [data-create-child]')`);
    await p.click(`${SECTION} [data-create-child]`);
    await p.waitFor(`document.activeElement?.getAttribute('aria-label')==='Sub-issue title'`);
    await p.type("[QA] inline epic child");
    await p.key("Enter", "meta");
    await created("inline epic child");
    await p.waitFor(`document.querySelector('${SECTION}').textContent.includes('inline epic child')`);
    await p.key("Escape");
  });

  await test.step("New sub-issue from comment… opens the composer in the epic: Epic pill set, no Sub-issue of header", async () => {
    await p.waitFor(`!!document.getElementById('comment')`);
    await p.click("#comment");
    await p.type("Epic comment to copy");
    await p.key("Enter", "meta");
    await p.waitFor(`document.querySelector('[data-comment]')?.textContent.includes("Epic comment to copy")`);
    await p.hover("[data-comment]");
    await p.click('[aria-label="Comment options"]');
    await p.click("text=New sub-issue from comment…");
    await p.waitFor(`!!document.querySelector('${COMPOSER} [aria-label="Epic: Fixture epic"]')`);
    expect(await p.eval(`document.querySelector('${COMPOSER}').textContent.includes("Sub-issue of TEST-7")`)).toBe(false);
    await p.eval(`document.querySelector('${COMPOSER} [aria-label="Issue title"]').focus()`);
    await p.type("[QA] epic child from comment");
    await p.key("Enter", "meta");
    await created("epic child from comment");
  });

  await test.step("⌘⇧O on the epic opens the section's add row, as on any parent", async () => {
    await p.goto("?issue=TEST-7&view=page");
    await p.waitFor(`!!document.getElementById('summary')`);
    await p.eval("document.activeElement?.blur()");
    await p.key("o", "meta", "shift");
    await p.waitFor(`document.activeElement?.getAttribute('aria-label')==='Sub-issue title'`);
    await p.key("Escape");
    await p.key("Escape");
  });

  await test.step("a row's Epic › No epic takes the issue out of the epic and off the section", async () => {
    await p.waitFor(`!!document.querySelector('[data-sub-issue="TEST-3"]')`);
    const r = await p.rect('[data-sub-issue="TEST-3"]');
    await p.page.mouse.click(r.x + 3, r.y + r.height / 2, { button: "right" });
    const menu = '[role="dialog"][aria-label="Sub-issue actions"]';
    await p.hover(`${menu} [cmdk-item][data-value="Epic"]`);
    await p.waitFor(`!!document.querySelector('[role="dialog"][aria-label="Epic"] [cmdk-item]')`);
    await p.click('[role="dialog"][aria-label="Epic"] [cmdk-item][data-value="No epic"]');
    await wrote(p, "TEST-3", null);
    await p.waitFor(`!document.querySelector('[data-sub-issue="TEST-3"]')`);
  });
});

test("BJ-262: Jira's epic changes read as Linear's project changes, worded Epic; a sub-task's parent stays a parent", async ({ open }) => {
  // Made-up history in the server's slim shape: TEST-2 (a Task) joined, moved between and left epics through Jira's Parent and
  // legacy Epic Link fields. Both epics are named "… epic", so Linear's appendWord leaves the word out (`G`).
  const daysAgo = (days: number) => new Date(Date.now() - days * 86_400_000).toISOString();
  const ada = { id: "ada", name: "Ada Example" };
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
    writable: true,
    epics: true,
    history: {
      "TEST-2": [
        { id: "1", at: daysAgo(4), actor: ada, items: [item("Parent", { to: "8", toText: "TEST-8" }, "parent")] },
        { id: "2", at: daysAgo(3), actor: ada, items: [item("Epic Link", { from: "8", fromText: "TEST-8", to: "7", toText: "TEST-7" })] },
        { id: "3", at: daysAgo(2), actor: ada, items: [item("Parent", { from: "7", fromText: "TEST-7" }, "parent")] },
      ],
    },
  });
  const p = await open("?issue=TEST-2&view=page");
  const rows = `[...document.querySelectorAll('[data-activity]')].map(n=>n.querySelector('.activity-event-words').textContent.replace(/\\s+/g,' ').trim())`;
  await p.waitFor(`${rows}.some(r=>r.includes("removed from epic"))`, 5000);
  const epicRows = (await p.eval<string[]>(rows)).filter((r) => /epic|parent/.test(r));
  expect(epicRows).toEqual([
    "Ada Example added to Shipped epic",
    "Ada Example changed epic from Shipped epic to Fixture epic",
    "Ada Example removed from Fixture epic",
  ]);
});
