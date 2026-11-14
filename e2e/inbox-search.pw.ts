import { expect, fixture, test } from "./app";

/** ⌘F in the Inbox: Linear's inbox find (startup-root `Idi`, Inbox `qt`, `Notification.matchInlineFind`). "Find in view…"
 *  floating over the header's right end (ContentViewHeaderInlineSearch), "Find in inbox…" in the priority inbox's tab row. */
const rows = `[...document.querySelectorAll('[data-inbox-row]')]`;
const rowKeys = `${rows}.map(r=>r.getAttribute('aria-label').split(" ")[1]).join()`;
const current = `(document.querySelector('[data-inbox-row][aria-current]')?.getAttribute('aria-label') ?? '')`;
const field = `document.querySelector('section[aria-label="Inbox"] input[type="search"]')`;
type Rect = [x: number, y: number, width: number, height: number];
const box = (el: string) => `(r => [r.x, r.y, r.width, r.height])(${el}.getBoundingClientRect())`;
const header = `document.querySelector('section[aria-label="Inbox"] > header')`;
const toggle = (label: string) =>
  `[...document.querySelectorAll('label')].find(l=>l.textContent.trim().startsWith(${JSON.stringify(label)})).querySelector('input').click()`;

test("⌘F finds in the inbox: key, title, actor and comment text; arrows, ⌘F, Escape, tabs, unread-only and the empty state", async ({ open }) => {
  await fixture.reset({});
  const p = await open("?inbox=1");
  await p.waitFor(`${rows}.length === 7`);

  await test.step("⌘F opens the field focused; the term narrows the rows on the comment text, every word", async () => {
    await p.key("f", "meta");
    await p.waitFor(`document.activeElement === ${field}`);
    expect(await p.eval(`${field}.getAttribute('aria-label')`)).toBe("Find in view…");
    await p.type("looks GOOD");
    await p.waitFor(`${rowKeys} === "TEST-4"`);
    await p.key("a", "meta");
    await p.type("test-1");
    await p.waitFor(`${rowKeys}.split(",").includes("TEST-1") && !${rowKeys}.split(",").includes("TEST-3")`);
    await p.key("a", "meta");
    await p.type("check this");
    await p.waitFor(`${rowKeys} === "TEST-1"`);
  });

  await test.step("the field floats over the header's right end at Linear's size, and its focus ring sits on its border", async () => {
    // ContentViewHeaderInlineSearch: absolute, top 6px, right 4px, 160px, z-index 10, over the buttons; Adi default: 28px.
    const [hx, hy, hw, hh] = await p.eval<Rect>(box(header));
    const [fx, fy, fw, fh] = await p.eval<Rect>(box(field));
    expect(hh).toBe(44);
    expect(fh).toBe(28);
    expect(fw).toBe(160);
    expect(fy - hy).toBe(6);
    expect(hx + hw - (fx + fw)).toBeCloseTo(4, 0);
    const [bx] = await p.eval<Rect>(box(`document.querySelector('[aria-label="Display options"]')`));
    expect(bx).toBeGreaterThan(fx); // the buttons stay where they were, under the field
    const style = await p.eval<string[]>(
      `(s => [s.fontSize, s.fontWeight, s.outlineStyle, s.outlineWidth, s.outlineOffset])(getComputedStyle(${field}))`,
    );
    expect(style).toEqual(["13px", "500", "solid", "1px", "-1px"]);
    expect(await p.eval(`getComputedStyle(${field}, '::placeholder').fontSize`)).toBe("13px");
  });

  await test.step("↓ leaves the field for the list, j selects among the found rows, ⌘F comes back with the term selected", async () => {
    await p.key("ArrowDown");
    await p.waitFor(`document.activeElement !== ${field} && !!${field}`);
    await p.key("j");
    await p.waitFor(`${current}.includes("TEST-1")`);
    await p.key("f", "meta");
    await p.waitFor(
      `document.activeElement === ${field} && ${field}.selectionStart === 0 && ${field}.selectionEnd === "check this".length`,
    );
  });

  await test.step("nothing found: Linear's filtered empty state, and Clear Filters brings every row back", async () => {
    await p.type("zzz nothing");
    await p.waitFor(`document.body.innerText.includes("No matching notifications")`);
    expect(await p.eval(`document.querySelector('[data-inbox-hidden]')?.textContent`)).toBe("7 notifications hidden by filters");
    await p.click(`button:has-text("Clear Filters")`);
    await p.waitFor(`${rows}.length === 7 && !${field}`);
  });

  await test.step("Escape clears and closes; an empty field closes as it loses focus", async () => {
    await p.key("f", "meta");
    await p.type("check");
    await p.waitFor(`${rows}.length < 7`);
    await p.key("Escape");
    await p.waitFor(`${rows}.length === 7 && !${field}`);
    await p.key("f", "meta");
    await p.waitFor(`document.activeElement === ${field}`);
    await p.eval(`${field}.blur()`);
    await p.waitFor(`!${field}`);
  });

  await test.step("in the priority inbox the field takes the tabs' place with Close, and finds across both tabs", async () => {
    await p.click(`[aria-label="Display options"]`);
    await p.eval(toggle("Enable priority inbox"));
    await p.waitFor(`${rowKeys} === "TEST-2,TEST-1,TEST-5"`);
    await p.key("Escape");
    await p.key("f", "meta");
    await p.waitFor(`document.activeElement === ${field} && !document.querySelector('[role=tab]')`);
    // Jt.searchInput / facetRowSearch: "Find in inbox…", 32px, filling the row up to the buttons.
    expect(await p.eval(`${field}.placeholder`)).toBe("Find in inbox…");
    const [fx, , fw, fh] = await p.eval<Rect>(box(field));
    const [ux] = await p.eval<Rect>(box(`document.querySelector('[aria-label="Show unreads only"]')`));
    expect(fh).toBe(32);
    expect(ux - (fx + fw)).toBeLessThanOrEqual(8);
    await p.type("looks good");
    // TEST-4 is on the Other tab; Linear's find looks through both.
    await p.waitFor(`${rowKeys} === "TEST-4"`);
    await p.click(`button[aria-label="Close"]`);
    await p.waitFor(`!${field} && document.querySelectorAll('[role=tab]').length === 2 && ${rowKeys} === "TEST-2,TEST-1,TEST-5"`);
    await p.click(`[aria-label="Display options"]`);
    await p.eval(toggle("Enable priority inbox"));
    await p.key("Escape");
    await p.waitFor(`${rows}.length === 7`);
  });

  await test.step("unread-only still applies under the find", async () => {
    await p.click(`[aria-label="Show unreads only"]`);
    await p.key("f", "meta");
    await p.type("looks good"); // TEST-4 is read
    await p.waitFor(`document.body.innerText.includes("No matching notifications")`);
    await p.key("Escape");
    await p.click(`[aria-label="Show read"]`);
    await p.waitFor(`${rows}.length === 7`);
  });
});
