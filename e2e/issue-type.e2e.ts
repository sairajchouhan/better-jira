import { afterAll, expect, test } from "bun:test";
import { APP, open, stop, type Page } from "./harness";
afterAll(stop);

/** The fixture's writable mode applies type ops the way live Jira does (Subtask ↔ Task is refused). */
async function writable(path: string, settings: object = {}, setup = "") {
  const p = await open(path, { setup });
  await fetch(`${APP}__fixture`, {
    method: "POST",
    body: JSON.stringify({ writable: true, subtask: true, ...settings }),
  });
  await p.eval(`window.__stale=true`);
  await p.cmd("Page.reload");
  await p.waitFor(`!window.__stale&&document.querySelector('#prop-type')?.textContent`, 15000);
  return p;
}
const typeText = `document.querySelector('#prop-type')?.textContent`;
const writes = async () =>
  ((await (await fetch(`${APP}__fixture`)).json()).writes as { key: string; ops: any[] }[]).map(
    (w) => [w.key, w.ops],
  );
const menuItems = (p: Page) =>
  p.waitFor<string[]>(
    `(()=>{const items=[...document.querySelectorAll('[role="dialog"][aria-label="Change issue type"] [cmdk-item]')].map(n=>n.textContent);return items.length&&items})()`,
  );

test("the type pill offers the same-level types, writes the change to Jira, and undo/redo send it back", async () => {
  const p = await writable("?issue=TEST-2&view=page");
  try {
    expect(await p.eval(typeText)).toBe("Task");
    await p.click("#prop-type");
    // Epic (level 1) and Subtask (level -1) need Jira's Move: only Task's level is offered.
    expect(await menuItems(p)).toEqual(["Task", "Story"]);
    await p.click(
      '[role="dialog"][aria-label="Change issue type"] [cmdk-item][data-value="Story"]',
    );
    await p.waitFor(`${typeText}==='Story'`);
    await p.waitFor(`(async()=>(await (await fetch('/__fixture')).json()).writes.length===1)()`);
    expect(await writes()).toEqual([["TEST-2", [{ op: "fields", fields: { type: "Story" } }]]]);
    await p.eval(`document.activeElement?.blur()`);
    await p.key("z", "meta");
    await p.waitFor(`${typeText}==='Task'`);
    await p.key("z", "meta", "shift");
    await p.waitFor(`${typeText}==='Story'`);
    await p.waitFor(`(async()=>(await (await fetch('/__fixture')).json()).writes.length===3)()`);
    expect((await writes()).map(([, ops]) => (ops as any[])[0].fields.type)).toEqual([
      "Story",
      "Task",
      "Story",
    ]);
    expect(await p.eval(`document.querySelector('.issue-activity')?.textContent`)).toContain(
      "issue type",
    );
  } finally {
    await p.close();
    await fetch(`${APP}__fixture`, { method: "POST", body: "{}" });
  }
});

test("Issue options and the command palette change the type too", async () => {
  const p = await writable("?issue=TEST-3&view=page");
  try {
    await p.click("#issue-options");
    await p.hover('[cmdk-item][data-value="Issue type"]');
    await p.click('[cmdk-item][data-value="Story"]');
    await p.waitFor(`${typeText}==='Story'`);
    await p.eval(`document.activeElement?.blur()`);
    await p.key("k", "meta");
    await p.type("issue type");
    await p.click('[cmdk-item][data-value="cmd:Change issue type"]');
    expect(await menuItems(p)).toEqual(["Task", "Story"]);
    await p.click('[role="dialog"][aria-label="Change issue type"] [cmdk-item][data-value="Task"]');
    await p.waitFor(`${typeText}==='Task'`);
    await p.waitFor(`(async()=>(await (await fetch('/__fixture')).json()).writes.length===2)()`);
    expect(await writes()).toEqual([
      ["TEST-3", [{ op: "fields", fields: { type: "Story" } }]],
      ["TEST-3", [{ op: "fields", fields: { type: "Task" } }]],
    ]);
  } finally {
    await p.close();
    await fetch(`${APP}__fixture`, { method: "POST", body: "{}" });
  }
});

// Without Jira's type list (createmeta failed), the menu falls back to the project's types; Jira refuses Subtask → Task.
const noTypes = `(()=>{const real=fetch;window.fetch=async(input,init)=>{const path=new URL(String(input),location.href).pathname;
 if(path==='/api/options')return Response.json({priorities:[],users:[],labels:[],versions:{}});return real(input,init);};})()`;

test("a subtask offers only subtask types; a type Jira refuses rolls back with a toast", async () => {
  const p = await writable("?issue=TEST-6&view=page");
  try {
    expect(await p.eval(typeText)).toBe("Subtask");
    await p.click("#prop-type");
    expect(await menuItems(p)).toEqual(["Subtask"]);
  } finally {
    await p.close();
  }
  const q = await writable("?issue=TEST-6&view=page", {}, noTypes);
  try {
    await q.key("t", "shift");
    expect(await menuItems(q)).toEqual(["Subtask", "Task"]);
    await q.click('[role="dialog"][aria-label="Change issue type"] [cmdk-item][data-value="Task"]');
    const toast = await q.waitFor<string>(`document.querySelector("[data-toast]")?.textContent`);
    expect(toast).toContain("Jira did not save the change to TEST-6");
    expect(toast).toContain("Use Move in Jira");
    await q.waitFor(`${typeText}==='Subtask'`);
  } finally {
    await q.close();
    await fetch(`${APP}__fixture`, { method: "POST", body: "{}" });
  }
});
