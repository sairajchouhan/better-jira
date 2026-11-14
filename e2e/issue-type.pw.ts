import { expect, test, sleep, PREFS_KEY, type App as Page, fixture } from "./app";

/** The fixture's writable mode applies type ops the way live Jira does (Subtask ↔ Task is refused). */
const typeText = `document.querySelector('#prop-type')?.textContent`;
const writes = async () =>
  (await fixture.log()).writes.map((w: { key: string; ops: any[] }) => [w.key, w.ops]);
const writeCount = (n: number) =>
  `(async()=>(await (await fetch('/__fixture')).json()).writes.length===${n})()`;
const menuItems = (p: Page) =>
  p.waitFor<string[]>(
    `(()=>{const items=[...document.querySelectorAll('[role="dialog"][aria-label="Change issue type"] [role^=menuitem]')].map(n=>n.textContent);return items.length&&items})()`,
  );

// Without Jira's type list (createmeta failed), the menu falls back to the project's types; Jira refuses Subtask → Task.
const noTypes = `(()=>{const real=fetch;window.fetch=async(input,init)=>{const path=new URL(String(input),location.href).pathname;
 if(path==='/api/options')return Response.json({priorities:[],users:[],labels:[],versions:{}});return real(input,init);};})()`;

test("changing an issue's type: a subtask's limits, the pill, undo/redo, Issue options and the palette", async ({
  open,
}) => {
  await fixture.reset({ writable: true, subtask: true });
  // The subtask steps run first: the no-types fallback lists the project's current types, which the later steps change.
  const p = await open("?issue=TEST-6&view=page");
  await p.waitFor(typeText);
  await test.step("a subtask offers only subtask types", async () => {
    expect(await p.eval(typeText)).toBe("Subtask");
    await p.click("#prop-type");
    expect(await menuItems(p)).toEqual(["Subtask"]);
    await p.key("Escape");
  });
  await test.step("a type Jira refuses rolls back with a toast", async () => {
    const q = await open("?issue=TEST-6&view=page", { setup: noTypes });
    await q.waitFor(typeText);
    await q.key("t", "shift");
    expect(await menuItems(q)).toEqual(["Subtask", "Task"]);
    await q.click('[role="dialog"][aria-label="Change issue type"] [role^=menuitem][data-value="Task"]');
    const toast = await q.waitFor<string>(`document.querySelector("[data-toast]")?.textContent`);
    expect(toast).toContain("Jira did not save the change to TEST-6");
    expect(toast).toContain("Use Move in Jira");
    await q.waitFor(`${typeText}==='Subtask'`);
    await q.close();
  });
  let base = 0; // the refused write is logged too
  await test.step("the type pill offers the same-level types, writes the change to Jira, and undo/redo send it back", async () => {
    base = (await writes()).length;
    await p.goto("?issue=TEST-2&view=page");
    await p.waitFor(typeText);
    expect(await p.eval(typeText)).toBe("Task");
    await p.click("#prop-type");
    // Epic (level 1) and Subtask (level -1) need Jira's Move: only Task's level is offered.
    expect(await menuItems(p)).toEqual(["Task", "Story"]);
    await p.click(
      '[role="dialog"][aria-label="Change issue type"] [role^=menuitem][data-value="Story"]',
    );
    await p.waitFor(`${typeText}==='Story'`);
    await p.waitFor(writeCount(base + 1));
    expect((await writes()).slice(base)).toEqual([
      ["TEST-2", [{ op: "fields", fields: { type: "Story" } }]],
    ]);
    await p.eval(`document.activeElement?.blur()`);
    await p.key("z", "meta");
    await p.waitFor(`${typeText}==='Task'`);
    await p.key("z", "meta", "shift");
    await p.waitFor(`${typeText}==='Story'`);
    await p.waitFor(writeCount(base + 3));
    expect((await writes()).slice(base).map(([, ops]) => (ops as any[])[0].fields.type)).toEqual([
      "Story",
      "Task",
      "Story",
    ]);
    expect(await p.eval(`document.querySelector('.issue-activity')?.textContent`)).toContain(
      "issue type",
    );
  });
  await test.step("Issue options and the command palette change the type too", async () => {
    await p.goto("?issue=TEST-3&view=page");
    await p.waitFor(typeText);
    await p.click("#issue-options");
    await p.click('[role^=menuitem][data-value="Issue type"]');
    await p.click('[role="dialog"][aria-label="Change issue type"] [role^=menuitem][data-value="Story"]');
    await p.waitFor(`${typeText}==='Story'`);
    await p.eval(`document.activeElement?.blur()`);
    await p.key("k", "meta");
    await p.type("issue type");
    await p.click('[role^=menuitem][data-value="cmd:Change issue type"]');
    expect(await menuItems(p)).toEqual(["Task", "Story"]);
    await p.click('[role="dialog"][aria-label="Change issue type"] [role^=menuitem][data-value="Task"]');
    await p.waitFor(`${typeText}==='Task'`);
    await p.waitFor(writeCount(base + 5));
    expect((await writes()).slice(base + 3)).toEqual([
      ["TEST-3", [{ op: "fields", fields: { type: "Story" } }]],
      ["TEST-3", [{ op: "fields", fields: { type: "Task" } }]],
    ]);
  });
});

test("board drag between type columns keeps the hierarchy level: a Subtask never lands in Task", async ({
  open,
}) => {
  await fixture.reset({ writable: true, subtask: true });
  const setup = `localStorage.setItem(${JSON.stringify(PREFS_KEY)},JSON.stringify({1:{display:{columns:"type"}}}))`;
  const p = await open("", { setup });
  const keysIn = (name: string) =>
    `[...([...document.querySelectorAll("section")].find(s=>s.querySelector("h2 [data-wrap=truncate]")?.textContent===${JSON.stringify(name)})?.querySelectorAll("[data-key]")??[])].map(c=>c.dataset.key)`;
  await p.waitFor(`${keysIn("Subtask")}.includes("TEST-6")`, 15000);
  const task = await p.rect('[data-key="TEST-1"]');
  await p.drag('[data-key="TEST-6"]', task.x + task.width / 2, task.y + 4);
  await sleep(300);
  // Ignored outright: no optimistic move that snaps back, and nothing sent to Jira.
  expect(await p.eval(keysIn("Subtask"))).toEqual(["TEST-6"]);
  expect(await p.eval<string[]>(keysIn("Task"))).not.toContain("TEST-6");
  expect(await writes()).toEqual([]);
});
