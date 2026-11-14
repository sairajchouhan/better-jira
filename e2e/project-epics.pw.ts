import { expect, fixture, PREFS_KEY, sleep, test, type App } from "./app";

/**
 * Linear's Project is a Jira epic (decision 2026-11-14, src/shared/epics.ts). Writable fixture with `epics`: TEST-7 "Fixture
 * epic" (open) and TEST-8 "Shipped epic" (done) are Epics; TEST-2 and TEST-3 sit in TEST-7; TEST-1, 4, 5 and 6 are in none.
 * Every issue stays in Jira project TEST ("Audit"), Linear's team, which no Project surface offers.
 */
const MENU = '[role="dialog"][aria-label="Issue options"]';
const PICKER = '[role="dialog"][aria-label="Change project"]';
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

  await test.step("Filter › Project lists No project and the board's epics with their issue counts, never the Jira project", async () => {
    await p.click('[aria-label="Add filter"]');
    await p.hover("text=Project");
    await p.waitFor(`!!document.querySelector('[aria-label="Filter Project"] [cmdk-item]')`);
    const rows = await p.eval<string[]>(
      `[...document.querySelectorAll('[aria-label="Filter Project"] [cmdk-item]')].map(n=>n.dataset.value)`,
    );
    expect(rows).toEqual(["No project $none", "Fixture epic TEST-7", "Shipped epic TEST-8"]);
    expect(rows.join()).not.toContain("Audit");
    expect(await p.eval(`document.querySelector('[aria-label="Filter Project"] [cmdk-item][data-value="Fixture epic TEST-7"]').textContent`)).toContain("3 issues");
    await p.click('[aria-label="Filter Project"] [cmdk-item][data-value="Fixture epic TEST-7"]');
    // The epic lists with its issues, as a Linear project page does.
    await p.waitFor(`${cards}===3`);
    await p.key("Escape");
    await p.click('[aria-label="Remove project filter"]');
    await p.waitFor(`${cards}===8`);
    await p.click('[aria-label="Add filter"]');
    await p.hover("text=Project");
    await p.click('[aria-label="Filter Project"] [cmdk-item][data-value="No project $none"]');
    await p.waitFor(`${cards}===4`);
    await p.key("Escape");
    await p.click('[aria-label="Remove project filter"]');
    await p.waitFor(`${cards}===8`);
  });

  await test.step("Project properties read the epic: Project status Done finds the Shipped epic", async () => {
    await p.click('[aria-label="Add filter"]');
    await p.hover("text=Project properties");
    await p.hover("text=Project status");
    await p.waitFor(`!!document.querySelector('[aria-label="Filter Project status"] [cmdk-item]')`);
    expect(
      await p.eval<string[]>(`[...document.querySelectorAll('[aria-label="Filter Project status"] [cmdk-item]')].map(n=>n.dataset.value)`),
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
    expect(await column("No project")).toEqual(["TEST-1", "TEST-4", "TEST-5", "TEST-6"]);
    await prefs(p, {});
  });

  await test.step("right-click › Project: No project and the open epics; picking one writes only the Jira parent", async () => {
    await p.waitFor(`${cards}===8`);
    const r = await p.rect('[data-key="TEST-4"]');
    await p.page.mouse.click(r.x + r.width / 2, r.y + r.height / 2, { button: "right" });
    await p.hover(`${MENU} [cmdk-item][data-value="Project"]`);
    await p.waitFor(`!!document.querySelector('[role="dialog"][aria-label="Project"] [cmdk-item]')`);
    // Linear hides a completed project unless it is current or searched for.
    expect(await names(p, '[role="dialog"][aria-label="Project"]')).toEqual(["No project", "Fixture epic"]);
    await p.click('[role="dialog"][aria-label="Project"] [cmdk-item][data-value="Fixture epic"]');
    await wrote(p, "TEST-4", "TEST-7");
  });

  await test.step("an epic is a project itself: its right-click Project row is disabled", async () => {
    const r = await p.rect('[data-key="TEST-7"]');
    await p.page.mouse.click(r.x + r.width / 2, r.y + r.height / 2, { button: "right" });
    await p.waitFor(`!!document.querySelector('${MENU} [cmdk-item][data-value="Project"]')`);
    expect(await p.eval(`document.querySelector('${MENU} [cmdk-item][data-value="Project"]').getAttribute('aria-disabled')`)).toBe("true");
    await p.key("Escape");
  });

  await test.step("⇧P on a Task: Add to project, a done epic shows once searched, No project takes the epic away", async () => {
    await p.goto("?issue=TEST-1&view=page");
    await p.waitFor(`!!document.getElementById('comment')`);
    expect(await p.eval(`document.getElementById('prop-project')?.tagName`)).toBe("BUTTON");
    await p.eval("document.activeElement?.blur()");
    await p.key("p", "shift");
    await p.waitFor(`!!document.querySelector('${PICKER} [cmdk-item]')`);
    expect(await p.eval(`document.querySelector('${PICKER} input')?.placeholder`)).toBe("Add to project…");
    expect(await names(p, PICKER)).toEqual(["No project", "Fixture epic"]);
    await p.type("shi");
    await expect.poll(() => names(p, PICKER)).toContain("Shipped epic");
    await p.key("Escape");
    await p.goto("?issue=TEST-2&view=page");
    await p.waitFor(`document.getElementById('prop-project')?.textContent.includes("Fixture epic")`);
    await p.eval("document.activeElement?.blur()");
    await p.key("p", "shift");
    await p.waitFor(`!!document.querySelector('${PICKER} [cmdk-item]')`);
    expect(await p.eval(`document.querySelector('${PICKER} input')?.placeholder`)).toBe("Move to project…");
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
  await p.waitFor(`!!document.querySelector('${COMPOSER} [aria-label="Project: Fixture epic"]')`);
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
  await p.waitFor(`!!document.querySelector('${COMPOSER} [aria-label="Project: No project"]')`);
  await p.click(`${COMPOSER} [aria-label="Project: No project"]`);
  await p.waitFor(`!!document.querySelector('${PICKER} [cmdk-item]')`);
  // Shipped epic is done, so it shows only because the filter names it; the filter's order holds.
  expect(await names(p, PICKER)).toEqual(["No project", "Shipped epic", "Fixture epic"]);
});

test("\"No project\" filter: the composer starts with no project", async ({ open }) => {
  await fixture.reset({ writable: true, epics: true });
  const p = await open("", { setup: projectFilter("$none") });
  await p.waitFor(`${cards}===4`);
  await p.eval("document.activeElement?.blur()");
  await p.key("c");
  await p.waitFor(`!!document.querySelector('${COMPOSER} [aria-label="Project: No project"]')`);
});

/**
 * BJ-247: an epic parent is the issue's Project, never its Parent (shared/epics.ts parentOf), as Linear keeps `issue.parent` and
 * `issue.project` apart. Fixture with `epics` and `subtask`: TEST-2 and TEST-3 sit in epic TEST-7; TEST-6 is a Subtask of TEST-5.
 */
test("an epic parent shows only as Project: no parent line, sub-issues, Parent filter, grouping, nesting or ⌘⇧P", async ({ open }) => {
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

  await test.step("an issue in the epic: Project names it, no Sub-issue of line, Remove has no parent, ⌘⇧P offers no epic", async () => {
    await p.goto("?issue=TEST-2&view=page");
    await p.waitFor(`document.getElementById('prop-project')?.textContent.includes("Fixture epic")`);
    expect(await p.eval(`!!document.querySelector('[data-parent-link]')`)).toBe(false);
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

  await test.step("the epic's detail lists no sub-issues and offers none; ⌘⇧P opens nothing", async () => {
    await p.goto("?issue=TEST-7&view=page");
    await p.waitFor(`!!document.getElementById('comment')`);
    expect(await p.eval(`document.querySelectorAll('[data-sub-issue]').length`)).toBe(0);
    expect(await p.eval(`!!document.querySelector('[data-create-child]')`)).toBe(false);
    await p.eval("document.activeElement?.blur()");
    await p.key("p", "meta", "shift");
    await sleep(150); // no relations picker opens
    expect(await p.eval(`!!document.querySelector('${RELATIONS}')`)).toBe(false);
  });

  await test.step("a Subtask's parent issue still shows as Sub-issue of, and the parent lists it", async () => {
    await p.goto("?issue=TEST-6&view=page");
    await p.waitFor(`document.querySelector('[data-parent-link]')?.textContent.includes("TEST-5")`);
    await p.goto("?issue=TEST-5&view=page");
    await p.waitFor(`!!document.querySelector('[data-sub-issue="TEST-6"]')`);
  });

  await test.step("no Parent surface wrote a parent", async () => {
    const { writes } = await fixture.log();
    expect(writes.some((w: any) => w.ops.some((o: any) => o.op === "fields" && "parent" in o.fields))).toBe(false);
  });
});
