import { afterAll, expect, test } from "bun:test";
import { APP, open, stop, type Page } from "./harness";
afterAll(stop);

/** Writable fixture: TEST-6 is a Subtask of TEST-5, the rest are Tasks in project TEST ("Audit"). */
async function writable(path: string) {
  const p = await open(path);
  await fetch(`${APP}__fixture`, {
    method: "POST",
    body: JSON.stringify({ writable: true, subtask: true }),
  });
  await p.eval(`window.__stale=true`);
  await p.cmd("Page.reload");
  await p.waitFor(`!window.__stale&&!!document.getElementById('comment')`, 15000);
  return p;
}
const items = (p: Page, dialog: string) =>
  p.eval<string[]>(
    `[...document.querySelectorAll('[role="dialog"][aria-label="${dialog}"] [cmdk-item]')].map(n=>n.getAttribute('data-value'))`,
  );
const optionsFor = async (p: Page, search: string) => {
  await p.click("#issue-options");
  await p.type(search);
  await Bun.sleep(150);
  const found = await items(p, "Issue options");
  await p.key("Escape");
  return found;
};

test("a Subtask offers no sub-issue create and no parent removal (R1-D35)", async () => {
  const p = await writable("?issue=TEST-6&view=page");
  try {
    expect(await p.eval(`!!document.querySelector('[data-create-child]')`)).toBe(false);
    expect(await optionsFor(p, "sub-issue")).toEqual(["Mark as › Sub-issue of…"]);
    expect(await optionsFor(p, "remove")).toEqual([]);
    await p.eval("document.activeElement?.blur()");
    await p.key("o", "meta", "shift");
    await Bun.sleep(150);
    expect(
      await p.eval(`!!document.querySelector('[role="dialog"][aria-label="Create issue"]')`),
    ).toBe(false);
  } finally {
    await p.close();
    await fetch(`${APP}__fixture`, { method: "POST", body: "{}" });
  }
});

test("Set parent lists only Jira-valid parents and the project is read-only on a Jira issue (R1-D33, R1-D34, R2-issue-fields-D8)", async () => {
  const p = await writable("?issue=TEST-2&view=page");
  try {
    // Every other issue is a Task or a Subtask: none can be a Task's parent.
    await p.key("p", "meta", "shift");
    await p.waitFor(`!!document.querySelector('[role="dialog"][aria-label="Issue relations"]')`);
    await Bun.sleep(150);
    expect(await items(p, "Issue relations")).toEqual([]);
    await p.key("Escape");
    await p.eval("document.activeElement?.blur()");
    await p.key("p", "shift");
    await Bun.sleep(150);
    expect(
      await p.eval(`!!document.querySelector('[role="dialog"][aria-label="Change project"]')`),
    ).toBe(false);
    expect(await p.eval(`document.getElementById('prop-project')?.tagName`)).toBe("SPAN");
    expect(await p.eval(`document.getElementById('prop-project')?.textContent`)).toBe("Audit");
  } finally {
    await p.close();
    await fetch(`${APP}__fixture`, { method: "POST", body: "{}" });
  }
});

test("the composer offers Subtask only under a parent, and never No project (R1-D34, R1-D36, R1-D74)", async () => {
  const p = await writable("?issue=TEST-2&view=page");
  const pill = async (label: string) => {
    await p.click(`[role="dialog"][aria-label="Create issue"] button[title="${label}"]`);
    await p.waitFor(
      `!!document.querySelector('[role="dialog"][aria-label="${label}"] [cmdk-item]')`,
    );
    const found = await p.eval<string[]>(
      `[...document.querySelectorAll('[role="dialog"][aria-label="${label}"] [cmdk-item]')].map(n=>n.textContent)`,
    );
    await p.key("Escape");
    return found;
  };
  try {
    await p.eval("document.activeElement?.blur()");
    await p.key("c");
    await p.waitFor(`!!document.querySelector('[role="dialog"][aria-label="Create issue"]')`);
    expect(await pill("Issue type")).not.toContain("Subtask");
    expect(await pill("Project")).toEqual(["Audit"]);
    await p.click('[role="dialog"][aria-label="Create issue"] [aria-label="Close"]');
    // The composer for a Task's sub-issue offers only the type Jira will create it as.
    await p.eval("document.querySelector('[data-sub-issues] [data-create-child]')?.remove()");
    await p.key("o", "meta", "shift");
    await p.waitFor(`!!document.querySelector('[role="dialog"][aria-label="Create issue"]')`);
    expect(await pill("Issue type")).toEqual(["Subtask"]);
  } finally {
    await p.close();
    await fetch(`${APP}__fixture`, { method: "POST", body: "{}" });
  }
});

// TEST-4 is renamed to a partial match of "browser fixture 3" and updated more recently than TEST-3.
const partial = `(()=>{const real=fetch;window.fetch=async(input,init)=>{const r=await real(input,init);
 if(new URL(String(input),location.href).pathname!=='/api/issues')return r;const list=await r.json();
 for(const i of list)if(i.key==='TEST-4')Object.assign(i,{summary:'Browser fixture 33',updated:'2026-11-07T10:00:00Z'});return Response.json(list);};})()`;
test("the relations search selects the exact match first, filters Related issues, and lists each issue once (R1-D8)", async () => {
  const p = await open("?issue=TEST-2&view=page", { setup: partial });
  const mark = async (name: string, search: string) => {
    await p.click("#issue-options");
    await p.type(name);
    await p.waitFor(`!!document.querySelector('[cmdk-item][data-value="Mark as › ${name}"]')`);
    await p.key("Enter");
    await p.waitFor(`document.activeElement?.getAttribute('aria-label')==='Find related issue'`);
    await p.type(search);
    await Bun.sleep(150);
  };
  try {
    await p.waitFor(`!!document.getElementById('comment')`);
    for (const key of ["TEST-4", "TEST-5"]) {
      await mark("Related to…", key);
      await p.key("Enter");
      await p.waitFor(`!!document.querySelector('[data-relation="related:${key}"]')`);
    }
    await mark("Duplicate of…", "browser fixture 3");
    expect(await items(p, "Issue relations")).toEqual(["TEST-3", "related:TEST-4"]);
    expect(
      await p.eval(
        `document.querySelector('[role="dialog"][aria-label="Issue relations"] [cmdk-item][data-selected=true]')?.getAttribute('data-value')`,
      ),
    ).toBe("TEST-3");
  } finally {
    await p.close();
  }
});
