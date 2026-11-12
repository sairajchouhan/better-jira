import { expect, test } from "./app";

/** Package P (palette, search, navigation): Linear's nested "Open …" pages, recents and search. */
const dialog = (label: string) => `document.querySelector('[role=dialog][aria-label="${label}"]')`;
const rows = `[...document.querySelectorAll('[cmdk-item]')].map(n=>n.textContent)`;
const input = `document.querySelector('[cmdk-input]')`;

test("BJ-165: O F / O T / O V open the ⌘K palette frame on their page; Help falls back to the palette; picker inputs are named", async ({ open }) => {
  const p = await open();
  await test.step("O T is the palette, its chip names the page, ⌫ leaves it for the root", async () => {
    await p.keys("ot");
    await p.waitFor(`!!${dialog("Open team")}&&!!${input}`);
    expect(await p.eval(`${dialog("Open team")}.textContent`)).toContain("Team");
    expect(await p.eval<string[]>(rows)).toContain("Browser audit");
    await p.key("Backspace");
    await p.waitFor(`${input}?.placeholder==='Search issues or type a command…'`);
    await p.key("Escape");
    await p.waitFor(`!${input}`);
  });
  await test.step("O V and O F open their pages", async () => {
    await p.keys("ov");
    await p.waitFor(`!!${dialog("Open view")}&&!!${input}`);
    await p.key("Escape");
    await p.keys("of");
    await p.waitFor(`!!${dialog("Open favorite")}&&!!${input}`);
    await p.key("Escape");
    await p.waitFor(`!${input}`);
  });
  await test.step("with the sidebar hidden, ? opens Help in the palette frame", async () => {
    await p.key("[");
    await p.waitFor(`!document.getElementById('help-menu')`);
    await p.key("?", "shift");
    await p.waitFor(`!!${dialog("Help")}&&!!${input}`);
    expect(await p.eval<string[]>(rows)).toEqual([expect.stringContaining("Keyboard shortcuts")]);
    await p.key("Enter");
    await p.waitFor(`!!${dialog("Keyboard Shortcuts")}`);
    await p.key("Escape");
    await p.key("[");
  });
  await test.step("a property picker's search input has an accessible name", async () => {
    await p.click('[data-key="TEST-1"]');
    await p.key("Escape");
    await p.key("p");
    await p.waitFor(`!!${input}`);
    expect(await p.eval(`${input}.getAttribute('aria-label')`)).toBeTruthy();
  });
});
