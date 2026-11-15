import { expect, fixture, test } from "./app";

/** Overlays: ⌘K's nested field pages (BJ-343). */
const palette = `document.querySelector('[role=dialog][aria-label="Search issues and commands"]')`;
const input = `document.querySelector('.menu-input input')`;
const highlighted = `document.querySelector('[role^=menuitem][data-focused]')?.getAttribute('data-value')`;

test("BJ-343: ⌘K's Change status opens as a page of ⌘K; ⌫ in its empty search comes back with the search and highlight", async ({
  open,
}) => {
  const p = await open();
  await p.key("j");
  await p.waitFor(`!!document.querySelector("[data-key][data-selected=true]")`);
  await p.eval("document.activeElement?.blur()");
  await p.key("k", "meta");
  await p.waitFor(`!!document.querySelector('.command-menu-title')`);
  await p.type("change issue st");
  await p.waitFor(`${highlighted}==='cmd:Change issue status'`);
  await p.key("Enter");

  await test.step("the status picker draws in ⌘K's own frame, under the issue's chip, not as a second menu", async () => {
    await p.waitFor(`${input}?.placeholder==='Change status…'`);
    expect(await p.eval(`!!${palette}`)).toBe(true);
    expect(await p.eval(`document.querySelectorAll('[data-surface=menu]').length`)).toBe(1);
    expect(await p.eval(`!!document.querySelector('.command-menu-title')`)).toBe(true);
  });

  await test.step("typing then ⌫ to empty stays (a held key), ⌫ in the empty search returns to ⌘K as it was", async () => {
    await p.type("d");
    await p.key("Backspace");
    await p.key("Backspace");
    // J4e's guard: a Backspace again within 200ms of the one that emptied the search doesn't leave the page.
    expect(await p.eval(`${input}?.placeholder`)).toBe("Change status…");
    await p.page.waitForTimeout(250);
    await p.key("Backspace");
    await p.waitFor(`${input}?.placeholder==='Type a command or search…'`);
    expect(await p.eval(`${input}.value`)).toBe("change issue st");
    expect(await p.eval(highlighted)).toBe("cmd:Change issue status");
    expect(await p.eval(`!!document.querySelector('.command-menu-title')`)).toBe(true);
  });

  await test.step("picking a status on the page writes it and closes ⌘K; Escape on the page closes it all", async () => {
    const before = (await fixture.log()).writes.length;
    await p.key("Enter");
    await p.waitFor(`${input}?.placeholder==='Change status…'`);
    await p.type("doing");
    await p.key("Enter");
    await p.waitFor(`!${palette}`);
    await expect.poll(async () => (await fixture.log()).writes.length).toBeGreaterThan(before);
    await p.eval("document.activeElement?.blur()");
    await p.key("k", "meta");
    await p.type("change issue st");
    await p.waitFor(`${highlighted}==='cmd:Change issue status'`);
    await p.key("Enter");
    await p.waitFor(`${input}?.placeholder==='Change status…'`);
    await p.key("Escape");
    await p.waitFor(`!${palette}`);
  });
});
