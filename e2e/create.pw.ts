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
  await test.step("B3: closing the composer keeps the unsent title and description for the next C", async () => {
    await page.type("Draft body");
    await page.key("Escape");
    await page.waitFor(`!${title}`);
    await page.key("c");
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
    ).toMatch(/^Created TEST-NEW\d+View issue$/);
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
