import { expect, fixture, test, PREFS_KEY } from "./app";

const title = `document.querySelector('[aria-label="Issue title"]')`;

test("create composer: a draft written, closed, reopened, given properties and created; no double create", async ({
  open,
}) => {
  const page = await open();
  await test.step("B4: Enter in the title moves to the description", async () => {
    await page.key("c");
    await page.waitFor(`document.activeElement===${title}`);
    await page.type("Draft title");
    await page.key("Enter");
    expect(await page.eval(`document.activeElement?.id`)).toBe("create-description");
    expect(await page.eval(`!!${title}`)).toBe(true);
  });
  await test.step("#5: Linear's create modal: borderless title, boxless description, one row of icon chips, one primary button", async () => {
    const look = await page.eval<Record<string, unknown>>(`(() => {
      const dialog = document.querySelector('[role=dialog][aria-label="Create issue"]');
      const t = getComputedStyle(${title});
      const boxed = (el) => { for (; el && el !== dialog; el = el.parentElement) { const s = getComputedStyle(el); if (parseFloat(s.borderTopWidth) || parseFloat(s.borderBottomWidth)) return true; } return false; };
      const row = dialog.querySelector('[data-create-properties]');
      const chips = [...row.children].filter((c) => c.matches('button'));
      return {
        title: [t.borderTopWidth, t.borderBottomWidth, t.fontSize, t.fontWeight],
        description: boxed(document.getElementById('create-description')),
        wrap: getComputedStyle(row).flexWrap,
        oneRow: new Set(chips.map((c) => c.getBoundingClientRect().top)).size,
        iconless: chips.filter((c) => !c.querySelector('.ui-property-trigger-icon > *, .ui-button-icon > *')).map((c) => c.getAttribute('aria-label')),
        primary: [...dialog.querySelectorAll('[data-variant=primary]')].map((b) => b.textContent),
      };
    })()`);
    expect(look).toEqual({
      title: ["0px", "0px", "18px", "600"],
      description: false,
      wrap: "nowrap",
      oneRow: 1,
      iconless: [],
      primary: ["Create issue"],
    });
  });
  await test.step("B3: closing the composer keeps the unsent title and description for the next C", async () => {
    await page.type("Draft body");
    await page.key("Escape");
    await page.waitFor(`!!document.querySelector('[aria-label="Save to drafts?"]')`);
    await page.click("text=Save");
    await page.waitFor(`!${title}`);
    await page.key("c");
    await page.click("text=Saved drafts (1)");
    await page.click("text=Finish Draft title");
    expect(await page.waitFor<string>(`${title}?.value`)).toBe("Draft title");
    expect(await page.eval(`document.getElementById("create-description").textContent`)).toBe(
      "Draft body",
    );
  });
  await test.step("B13: composer properties are pill menus, not native selects; Enter picks without submitting", async () => {
    expect(
      await page.eval(
        `document.querySelectorAll('[role=dialog][aria-label="Create issue"] select').length`,
      ),
    ).toBe(0);
    const pill = await page.rect('[aria-label="Priority: Normal"]');
    await page.click('[aria-label="Priority: Normal"]');
    await page.waitFor(
      `document.activeElement?.getAttribute("placeholder")==="Change priority to…"`,
    );
    const menu = await page.rect('[role=dialog][aria-label="Set priority"]');
    expect(menu.top).toBeGreaterThanOrEqual(pill.bottom);
    expect(Math.abs(menu.left - pill.left)).toBeLessThan(2);
    await page.type("high");
    await page.key("Enter");
    await page.waitFor(`!!document.querySelector('[aria-label="Priority: High"]')`);
    expect(await page.eval(`${title}?.value`)).toBe("Draft title");
    await page.click('[aria-label="Status: Backlog"]');
    await page.waitFor(`!!document.querySelector('[role=dialog][aria-label="Change status"]')`);
    await page.key("Escape");
    await page.waitFor(`!document.querySelector('[role=dialog][aria-label="Change status"]')`);
    expect(await page.eval(`!!${title}`)).toBe(true);
  });
  await test.step("B5: creating an issue stays on the board and shows a toast that opens it", async () => {
    await page.click(`[aria-label="Issue title"]`);
    await page.key("Enter", "meta");
    await page.waitFor(`!${title}`);
    expect(
      await page.waitFor<string>(`document.querySelector("[data-toast]")?.textContent`),
    ).toMatch(/^Issue createdTEST-NEW\d+ – .+View issue$/); // #20: Linear's "Issue created", the key and title, View issue and close
    expect(await page.eval(`!!document.querySelector('[data-toast] .ui-toast-check')&&!!document.querySelector('[data-toast] [aria-label="Dismiss"]')`)).toBe(true);
    expect(await page.eval(`!!document.getElementById("summary")`)).toBe(false);
    // sonner's ⌥T (Linear's Toaster) focuses the toasts, React Aria's ToastRegion; Tab then reaches the toast itself.
    await page.key("KeyT", "alt");
    expect(await page.eval(`document.activeElement?.matches('.ui-toast-viewport[role=region][aria-label="Notifications alt+T"]')`)).toBe(true);
    await page.key("Tab");
    expect(await page.eval(`document.activeElement?.matches('.ui-toast-entry[role=alertdialog]')`)).toBe(true);
    await page.click("text=View issue");
    expect(
      await page.waitFor<string>(
        `document.getElementById("summary")?.value??document.getElementById("summary")?.textContent`,
      ),
    ).toBe("Draft title");
    await page.eval("document.activeElement?.blur()");
    await page.key("Escape");
    await page.waitFor(`!document.getElementById("summary")`);
  });
  await test.step("sync check 2: a double click on Create issue makes one issue", async () => {
    await page.key("c");
    await page.waitFor(`document.activeElement===${title}`);
    expect(await page.eval(`${title}.value`)).toBe("");
    await page.type("Double submit");
    // Both clicks land before React re-renders, as a fast double click does.
    await page.eval(`(() => {
      const b = [...document.querySelectorAll('[role=dialog][aria-label="Create issue"] button')].find((b) => b.textContent === "Create issue");
      b.click();
      b.click();
    })()`);
    await page.waitFor(`!${title}`);
    await page.waitFor(`!!document.querySelector("[data-toast]")`);
    expect(
      await page.eval(
        `[...document.querySelectorAll("[data-key]")].filter((e) => e.textContent.includes("Double submit")).map((e) => e.dataset.key)`,
      ),
    ).toHaveLength(1);
  });
  await test.step("B13: the Display menu uses pill menus instead of native selects; typing jumps to an option (React Aria's typeahead)", async () => {
    await page.click('[aria-label="Display options"]');
    await page.waitFor(`!!document.querySelector('[aria-label^="Ordering: "]')`);
    expect(await page.eval(`document.querySelectorAll(".view-popup select:not([data-testid=hidden-select-container] select)").length`)).toBe(0);
    await page.click('[aria-label="Ordering: Manual"]');
    // The list opens on the chosen option; typing moves to the first option starting with it, Enter chooses.
    await page.waitFor(`document.activeElement?.getAttribute("role")==="option"&&document.activeElement.textContent==="Manual"`);
    await page.type("title");
    await page.waitFor(`document.activeElement?.textContent==="Title"`);
    await page.key("Enter");
    await page.waitFor(`!!document.querySelector('[aria-label="Ordering: Title"]')`);
    expect(
      await page.eval(
        `!!document.querySelector('[aria-label="Display options"][aria-expanded=true]')`,
      ),
    ).toBe(true);
  });
});

test("removing a create attachment from the keyboard returns focus to the attach button", async ({ open }) => {
  const page = await open();
  await page.key("c");
  await page.waitFor(`document.activeElement===${title}`);
  await page.page.locator('[aria-label="Choose attachments"]').setInputFiles("e2e/fixtures/media-file.txt");
  const remove = page.page.getByRole("button", { name: "Remove attachment media-file.txt" });
  await remove.focus();
  await page.key("Enter");
  await page.waitFor(
    `document.activeElement?.getAttribute("aria-label")==="Attach images, files, or videos"`,
  );
});

test("R3-create-D3/D8/D9: composer keys stay in the composer and focus stays in the dialog", async ({ open }) => {
  const page = await open("?issue=TEST-2&view=page");
  // The issue page's own title is also "Issue title"; these steps mean the composer's.
  const title = `document.querySelector('[role=dialog][aria-label="Create issue"] [aria-label="Issue title"]')`;
  await page.waitFor(`!!document.getElementById('comment')`);
  await test.step("D8: Remove relation keeps focus in the composer", async () => {
    await page.click("#issue-options");
    await page.type("blocked issue");
    await page.click('[role^=menuitem][data-value="Create related › Blocked issue…"]');
    await page.waitFor(`document.activeElement===${title}`);
    await page.click("[data-pending-relation]");
    await page.click('[aria-label="Remove relation"]');
    await page.waitFor(`!document.querySelector("[data-pending-relation]")`);
    expect(await page.eval(`!!document.activeElement?.closest('[role=dialog][aria-label="Create issue"]')`)).toBe(true);
  });
  await test.step("D9 + D3: Ctrl+L opens Add link; Enter adds it, returns focus and creates nothing", async () => {
    await page.page.locator('[role=dialog][aria-label="Create issue"] [aria-label="Issue title"]').focus();
    await page.type("Keys stay here");
    await page.key("l", "ctrl");
    await page.waitFor(`document.activeElement?.getAttribute("aria-label")==="New issue link URL"`);
    await page.type("example.com/r3-d9");
    await page.key("Enter");
    await page.waitFor(`document.activeElement===${title}`);
    expect(await page.eval(`!!document.querySelector('[role=dialog][aria-label="Create issue"]')`)).toBe(true);
  });
  await test.step("D9 + D3: Cmd+Shift+O adds a focused sub-issue row; Enter in it creates nothing", async () => {
    await page.key("o", "meta", "shift");
    await page.waitFor(`document.activeElement?.getAttribute("aria-label")==="Pending sub-issue 1"`);
    await page.type("Child");
    await page.key("Enter");
    await page.waitFor(`document.activeElement?.getAttribute("aria-label")==="Pending sub-issue 2"`);
    expect(await page.eval(`!!document.querySelector('[role=dialog][aria-label="Create issue"]')`)).toBe(true);
  });
});

/** Opens the app with these filters on the fixture board (TEST-2: Todo, Alex, Low, label "test"). */
const filtered = (children: object[]) => {
  const prefs = { 1: { filters: { id: "root", join: "and", children } } };
  return `if(!sessionStorage.seeded){sessionStorage.seeded=1;localStorage.setItem(${JSON.stringify(PREFS_KEY)},${JSON.stringify(JSON.stringify(prefs))});}`;
};
const pill = (name: string) => `!!document.querySelector('[role=dialog][aria-label="Create issue"] [aria-label="${name}"]')`;

test("B7: a new issue takes its properties from the view's filters (Linear's create defaults)", async ({ open }) => {
  const page = await open("", {
    setup: filtered([
      { id: "l", field: "labels", op: "is", values: ["test"] },
      { id: "p", field: "priority", op: "is", values: ["Low"] },
      { id: "a", field: "assignee", op: "is", values: ["alex"] },
      { id: "s", field: "status", op: "isNot", values: ["done"] },
    ]),
  });
  await page.waitFor(`!!document.querySelector('[data-key="TEST-2"]')`);
  await test.step("C: label, priority and assignee come from the filters; an \"is not\" filter sets nothing", async () => {
    await page.key("c");
    await page.waitFor(pill("Labels: test"));
    expect(await page.eval(pill("Priority: Low"))).toBe(true);
    expect(await page.eval(pill("Assignee: Alex"))).toBe(true);
    expect(await page.eval(pill("Status: Done"))).toBe(false);
    await page.key("Escape");
    await page.waitFor(`!document.querySelector('[role=dialog][aria-label="Create issue"]')`);
  });
  await test.step("a column's +: the column's status, and the filters for the rest", async () => {
    await page.hover('[data-board-column="Doing"]');
    await page.click('[data-board-column="Doing"] [aria-label="Add new issue"]');
    await page.waitFor(pill("Status: Doing"));
    expect(await page.eval(pill("Labels: test"))).toBe(true);
    expect(await page.eval(pill("Assignee: Alex"))).toBe(true);
    await page.key("Escape");
    await page.waitFor(`!document.querySelector('[role=dialog][aria-label="Create issue"]')`);
  });
});

test("B7: an assignee filter naming two people sets no assignee and offers both under Suggested", async ({ open }) => {
  await fixture.reset({ writable: true, catalog: { priorities: [], labels: [], users: ["Morgan Example"] } });
  const page = await open("", {
    setup: filtered([{ id: "a", field: "assignee", op: "is", values: ["alex", "catalog-0"] }]),
  });
  await page.waitFor(`!!document.querySelector('[data-key="TEST-2"]')`);
  await page.key("c");
  await page.waitFor(pill("Assignee: Unassigned"));
  await page.click('[role=dialog][aria-label="Create issue"] [aria-label="Assignee: Unassigned"]');
  const menu = '[role=dialog][aria-label="Assign issue"]';
  await page.waitFor(`!!document.querySelector('${menu} .menu-group-header')`);
  expect(
    await page.eval(`[...document.querySelectorAll('${menu} .menu-group-header')].map(n=>n.textContent)`),
  ).toEqual(["Suggested"]);
  expect(
    await page.eval(`[...document.querySelectorAll('${menu} [role^=menuitem]')].map(n=>n.dataset.value)`),
  ).toEqual(["No assignee", "Audit user audit-me", "Alex alex", "Morgan Example catalog-0"]);
});

test("C5: the composer keeps its whole draft across a reload, a backdrop press minimizes it, and creating or discarding drops it", async ({
  open,
}) => {
  const page = await open();
  const dialog = `document.querySelector('[role=dialog][aria-label="Create issue"]')`;
  await test.step("a reload mid-compose brings back the title, description and properties on the next C (Linear's `CreateIssue_<user>__DRAFT__`)", async () => {
    await page.key("c");
    await page.waitFor(`document.activeElement===${title}`);
    await page.type("Kept across reload");
    await page.key("Enter");
    await page.type("Kept body");
    await page.click('[aria-label^="Priority:"]');
    await page.type("high");
    await page.key("Enter");
    await page.waitFor(`!!document.querySelector('[aria-label="Priority: High"]')`);
    await page.reload();
    expect(await page.eval(`!!${dialog}`)).toBe(false);
    await page.key("c");
    expect(await page.waitFor<string>(`${title}?.value`)).toBe("Kept across reload");
    expect(await page.eval(`document.getElementById("create-description").textContent`)).toBe("Kept body");
    expect(await page.eval(`!!document.querySelector('[aria-label="Priority: High"]')`)).toBe(true);
  });
  await test.step("a press on the backdrop closes it without asking and keeps the draft (Linear's `handleMinimize`)", async () => {
    await page.clickAt(5, 5);
    await page.waitFor(`!${dialog}`);
    expect(await page.eval(`!!document.querySelector('[role=dialog][aria-label="Save to drafts?"]')`)).toBe(false);
    await page.key("c");
    expect(await page.waitFor<string>(`${title}?.value`)).toBe("Kept across reload");
  });
  await test.step("Discard drops the kept draft: the next C, even after a reload, is empty", async () => {
    await page.key("Escape");
    await page.page.getByRole("dialog", { name: "Save to drafts?" }).getByRole("button", { name: "Discard" }).click();
    await page.waitFor(`!${dialog}`);
    await page.reload();
    await page.key("c");
    expect(await page.waitFor<string>(`${title}?.value`)).toBe("");
    expect(await page.eval(`!!document.querySelector('[aria-label="Priority: High"]')`)).toBe(false);
  });
  await test.step("creating the issue drops the kept draft", async () => {
    await page.type("Created then gone");
    await page.key("Enter", "meta");
    await page.waitFor(`!${dialog}`);
    await page.reload();
    await page.key("c");
    expect(await page.waitFor<string>(`${title}?.value`)).toBe("");
  });
});

/** Linear's "Automations and workflows" preferences, seeded for the fixture's account (browser-preferences `automationsKey`). */
const automations = (value: object) =>
  `if(!sessionStorage.seededAutomations){sessionStorage.seededAutomations=1;localStorage.setItem(${JSON.stringify(
    PREFS_KEY.replace("better-jira:views:v1", "better-jira:automations:v1"),
  )},${JSON.stringify(JSON.stringify(value))});}`;

test("C16: Preferences' auto-assign automations: you on a new issue, and on an unassigned issue moved to started, one undo", async ({
  open,
}) => {
  const page = await open("", { setup: automations({ autoAssignToSelf: true, assignToSelfWhenStarted: true }) });
  await page.waitFor(`!!document.querySelector('[data-key="TEST-1"]')`);
  const switchOn = (name: string) =>
    `document.querySelector('[role=dialog][aria-label="Preferences"] [role=switch][aria-label="${name}"]')?.checked`;
  await test.step("G then S opens Preferences with both automations under Automations and workflows", async () => {
    await page.key("g");
    await page.key("s");
    await page.waitFor(`!!document.querySelector('[role=dialog][aria-label="Preferences"]')`);
    expect(await page.eval(`document.querySelector('[role=dialog][aria-label="Preferences"]').textContent.includes("Automations and workflows")`)).toBe(true);
    expect(await page.eval(switchOn("Auto-assign to self"))).toBe(true);
    expect(await page.eval(switchOn("On move to started status, assign to yourself"))).toBe(true);
    await page.key("Escape");
    await page.waitFor(`!document.querySelector('[role=dialog][aria-label="Preferences"]')`);
  });
  await test.step("C: the composer starts assigned to you", async () => {
    await page.key("c");
    await page.waitFor(pill("Assignee: Audit user"));
    await page.key("Escape");
    await page.waitFor(`!document.querySelector('[role=dialog][aria-label="Create issue"]')`);
  });
  const card = (column: string) => `document.querySelector('[data-board-column="${column}"] [data-key="TEST-1"]')`;
  await test.step("S › Doing on unassigned TEST-1 assigns you; ⌘Z takes back the move and the assignment together", async () => {
    await page.hover('[data-key="TEST-1"]');
    await page.key("s");
    await page.waitFor(`!!document.querySelector('[role=dialog][aria-label="Change status"]')`);
    await page.type("Doing");
    await page.key("Enter");
    await page.waitFor(`!!${card("Doing")}?.querySelector('[title="Audit user"]')`);
    await page.key("z", "meta");
    await page.waitFor(`!!${card("Todo")}`);
    expect(await page.eval(`!!${card("Todo")}.querySelector('[title="Audit user"]')`)).toBe(false);
  });
  await test.step("an issue assigned to someone else keeps its assignee when started", async () => {
    await page.hover('[data-key="TEST-2"]');
    await page.key("s");
    await page.waitFor(`!!document.querySelector('[role=dialog][aria-label="Change status"]')`);
    await page.type("Doing");
    await page.key("Enter");
    await page.waitFor(`!!document.querySelector('[data-board-column="Doing"] [data-key="TEST-2"] [title="Alex"]')`);
  });
});
