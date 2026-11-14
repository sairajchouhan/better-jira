import { expect, test } from "./app";

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
  await test.step("B13: the Display menu uses pill menus instead of native selects", async () => {
    await page.click('[aria-label="Display options"]');
    await page.waitFor(`!!document.querySelector('[aria-label^="Ordering: "]')`);
    expect(await page.eval(`document.querySelectorAll(".view-popup select").length`)).toBe(0);
    await page.click('[aria-label="Ordering: Manual"]');
    await page.waitFor(`document.activeElement?.getAttribute("aria-label")==="Ordering…"`);
    await page.type("title");
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
    await page.click('[cmdk-item][data-value="Create related › Blocked issue…"]');
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
