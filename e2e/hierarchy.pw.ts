import { expect, test, sleep, type App as Page, fixture } from "./app";

/** Writable fixture: TEST-6 is a Subtask of TEST-5, the rest are Tasks in project TEST ("Audit"). */
const items = (p: Page, dialog: string) =>
  p.eval<string[]>(
    `[...document.querySelectorAll('[role="dialog"][aria-label="${dialog}"] [cmdk-item]')].map(n=>n.getAttribute('data-value'))`,
  );
const optionsAre = async (p: Page, search: string, expected: string[]) => {
  await p.click("#issue-options");
  await p.type(search);
  await expect.poll(() => items(p, "Issue options")).toEqual(expected);
  await p.key("Escape");
};

test("Jira's hierarchy rules: a Subtask's options, a Task's parents, project and composer types", async ({
  open,
}) => {
  await fixture.reset({ writable: true, subtask: true });
  const p = await open("?issue=TEST-6&view=page");
  await p.waitFor(`!!document.getElementById('comment')`);
  await test.step("R1-D35: a Subtask offers no sub-issue create and no parent removal", async () => {
    expect(await p.eval(`!!document.querySelector('[data-create-child]')`)).toBe(false);
    await optionsAre(p, "sub-issue", ["Mark as › Sub-issue of…"]);
    await optionsAre(p, "remove", []);
    await p.eval("document.activeElement?.blur()");
    await p.key("o", "meta", "shift");
    await sleep(150); // no composer opens
    expect(
      await p.eval(`!!document.querySelector('[role="dialog"][aria-label="Create issue"]')`),
    ).toBe(false);
  });
  await test.step("R1-D33, R1-D34, R2-issue-fields-D8: Set parent lists only Jira-valid parents and the project is read-only on a Jira issue", async () => {
    await p.goto("?issue=TEST-2&view=page");
    await p.waitFor(`!!document.getElementById('comment')`);
    // Every other issue is a Task or a Subtask: none can be a Task's parent.
    await p.key("p", "meta", "shift");
    await p.waitFor(`!!document.querySelector('[role="dialog"][aria-label="Issue relations"]')`);
    await sleep(150); // no parent shows up late
    expect(await items(p, "Issue relations")).toEqual([]);
    await p.key("Escape");
    await p.eval("document.activeElement?.blur()");
    await p.key("p", "shift");
    await sleep(150); // no project menu opens
    expect(
      await p.eval(`!!document.querySelector('[role="dialog"][aria-label="Change project"]')`),
    ).toBe(false);
    expect(await p.eval(`document.getElementById('prop-project')?.tagName`)).toBe("SPAN");
    expect(await p.eval(`document.getElementById('prop-project')?.textContent`)).toBe("Audit");
  });
  await test.step("R1-D34, R1-D36, R1-D74: the composer offers Subtask only under a parent, and never No project", async () => {
    const pill = async (label: string) => {
      const dialog = label === "Issue type" ? "Change issue type" : "Change project";
      await p.click(`[role="dialog"][aria-label="Create issue"] button[title="${label}"]`);
      await p.waitFor(
        `!!document.querySelector('[role="dialog"][aria-label="${dialog}"] [cmdk-item]')`,
      );
      const found = await p.eval<string[]>(
        `[...document.querySelectorAll('[role="dialog"][aria-label="${dialog}"] [cmdk-item]')].map(n=>n.querySelector(".menu-name")?.textContent)`,
      );
      await p.key("Escape");
      return found;
    };
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
  });
});

// TEST-4 is renamed to a partial match of "browser fixture 3" and updated more recently than TEST-3.
const partial = `(()=>{const real=fetch;window.fetch=async(input,init)=>{const r=await real(input,init);
 if(new URL(String(input),location.href).pathname!=='/api/issues')return r;const list=await r.json();
 for(const i of list)if(i.key==='TEST-4')Object.assign(i,{summary:'Browser fixture 33',updated:'2026-11-07T10:00:00Z'});return Response.json(list);};})()`;
test("the relations search selects the exact match first, filters Related issues, and lists each issue once (R1-D8)", async ({
  open,
}) => {
  const p = await open("?issue=TEST-2&view=page", { setup: partial });
  const selected = `document.querySelector('[role="dialog"][aria-label="Issue relations"] [cmdk-item][data-selected=true]')?.getAttribute('data-value')`;
  const mark = async (name: string, search: string) => {
    await p.click("#issue-options");
    await p.type(name);
    await p.waitFor(`!!document.querySelector('[cmdk-item][data-value="Mark as › ${name}"]')`);
    await p.key("Enter");
    await p.waitFor(`document.activeElement?.getAttribute('aria-label')==='Find related issue'`);
    await p.type(search);
  };
  await p.waitFor(`!!document.getElementById('comment')`);
  await test.step("mark TEST-4 and TEST-5 as related", async () => {
    for (const key of ["TEST-4", "TEST-5"]) {
      await mark("Related to…", key);
      await p.waitFor(`${selected}==="${key}"`);
      await p.key("Enter");
      await p.waitFor(`!!document.querySelector('[data-relation="related:${key}"]')`);
    }
  });
  await test.step("R1-D8: Duplicate of… selects the exact match first and lists each issue once", async () => {
    await mark("Duplicate of…", "browser fixture 3");
    await expect.poll(() => items(p, "Issue relations")).toEqual(["TEST-3", "related:TEST-4"]);
    await expect.poll(() => p.eval(selected)).toBe("TEST-3");
  });
});
