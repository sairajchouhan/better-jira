import { expect, test, sleep } from "./app";

const dialog = (label: string) => `[role=dialog][aria-label="${label}"]`;
const inViewport = (label: string) =>
  `(()=>{const r=document.querySelector('${dialog(label)}')?.getBoundingClientRect();return !!r&&r.top>=0&&r.bottom<=innerHeight&&r.left>=0&&r.right<=innerWidth})()`;

test("board menus: status, create, due date, palette toggle and selection look", async ({
  open,
}) => {
  const page = await open();
  await test.step("ISSUE-10: S, A, P and L act on the hovered card, with nothing selected or another card selected", async () => {
    const hovered = await page.eval<string>(
      `[...document.querySelectorAll("[data-key][role=row]")].filter(n=>n.getClientRects().length)[2].dataset.key`,
    );
    await page.hover(`[data-key="${hovered}"]`);
    for (const [key, label] of [
      ["s", "Change status"],
      ["a", "Assign issue"],
      ["p", "Set priority"],
      ["l", "Change labels"],
    ] as const) {
      await page.key(key);
      await page.waitFor(`!!document.querySelector('${dialog(label)} .command-menu-key')`);
      expect(await page.eval(`document.querySelector('${dialog(label)} .command-menu-key').textContent`)).toBe(hovered);
      await page.key("Escape");
      await page.waitFor(`!document.querySelector('${dialog(label)}')`);
    }
    await page.keys("j");
    expect(await page.eval(`document.querySelector("[data-selected]")?.dataset.key`)).not.toBe(hovered);
    await page.key("s");
    await page.waitFor(`!!document.querySelector('${dialog("Change status")} .command-menu-key')`);
    expect(await page.eval(`document.querySelector('${dialog("Change status")} .command-menu-key').textContent`)).toBe(hovered);
    await page.key("Escape");
    await page.waitFor(`!document.querySelector('${dialog("Change status")}')`);
    await page.page.mouse.move(5, 895);
  });
  await test.step("ISSUE-11: S on a keyboard-selected card opens Linear's command menu: centred, 720px, the issue's chip, 46px search and rows", async () => {
    await page.keys("j");
    const key = await page.eval<string>(`document.querySelector("[data-selected]").dataset.key`);
    await page.key("s");
    await page.waitFor(`!!document.querySelector('${dialog("Change status")}')`);
    await sleep(100);
    expect(await page.eval(inViewport("Change status"))).toBe(true);
    const [menu, input, row] = await page.eval<DOMRect[]>(
      `${JSON.stringify([dialog("Change status"), `${dialog("Change status")} input`, `${dialog("Change status")} [cmdk-item]`])}.map(s=>document.querySelector(s).getBoundingClientRect().toJSON())`,
    );
    expect(menu!.width).toBe(720);
    expect(Math.abs(menu!.left + menu!.width / 2 - 720)).toBeLessThan(1);
    expect([input!.height, row!.height]).toEqual([46, 46]);
    expect(await page.eval(`document.querySelector('${dialog("Change status")} .command-menu-chip').textContent`)).toMatch(
      new RegExp(`^${key}·`),
    );
    expect(await page.active()).toBe("Change status…");
    await page.key("Escape");
    await page.waitFor(`!document.querySelector('${dialog("Change status")}')`);
  });
  await test.step("R2: C focuses the issue title, so typing goes into it", async () => {
    await page.key("c");
    await page.waitFor(`document.activeElement?.getAttribute("aria-label")==="Issue title"`);
    await page.type("Typed straight away");
    expect(await page.eval(`document.querySelector('[aria-label="Issue title"]').value`)).toBe(
      "Typed straight away",
    );
    await page.key("Escape");
    await page.click("text=Discard");
    await page.waitFor(`!document.querySelector('[aria-label="Issue title"]')`);
  });
  await test.step("I13: the due-date picker focuses the date text field, not the first preset button", async () => {
    await page.key("j");
    await page.key("Enter");
    await page.key("d", "shift");
    // Linear's due menu (R1-D45): its "Try: …" date field, not the first preset.
    await page.waitFor(`document.activeElement?.placeholder==="Try: 24h, 7 days, Feb 9"`, 3000);
    await sleep(300);
    expect(await page.active()).toBe("Try: 24h, 7 days, Feb 9");
    await page.key("Escape");
    await page.eval("document.activeElement?.blur()");
    await page.key("Escape");
    await page.waitFor(`!document.getElementById("summary")`);
  });
  await test.step("R3: ⌘K toggles the command menu closed while it is open", async () => {
    await page.key("k", "meta");
    await page.waitFor(`!!document.querySelector('${dialog("Search issues and commands")}')`);
    await page.key("k", "meta");
    await page.waitFor(`!document.querySelector('${dialog("Search issues and commands")}')`, 2000);
  });
  await test.step("B9: P and L open their pickers without opening the issue panel", async () => {
    await page.key("j");
    for (const [key, label] of [
      ["p", "Set priority"],
      ["l", "Change labels"],
    ] as const) {
      await page.key(key);
      await page.waitFor(`!!document.querySelector('${dialog(label)}')`);
      expect(await page.eval(`!!document.getElementById("summary")`)).toBe(false);
      expect(await page.eval(inViewport(label))).toBe(true);
      await page.key("Escape");
      await page.waitFor(`!document.querySelector('${dialog(label)}')`);
    }
  });
  await test.step("R6: the keyboard-selected card is drawn differently from a hovered card", async () => {
    await page.key("j");
    const selected = await page.waitFor<string>(
      `document.querySelector("[data-selected]")?.dataset.key`,
    );
    const other = await page.eval<string>(
      `[...document.querySelectorAll("[data-key]")].find(n=>n.dataset.key!==${JSON.stringify(selected)}&&n.getClientRects().length).dataset.key`,
    );
    await page.hover(`[data-key="${other}"]`);
    await sleep(150);
    const look = (key: string) =>
      page.eval<string>(
        `(()=>{const s=getComputedStyle(document.querySelector('[data-key="${key}"] > [role=gridcell] > div'));return s.backgroundColor+"|"+s.boxShadow+"|"+s.outlineStyle})()`,
      );
    expect(await look(selected)).not.toBe(await look(other));
  });
});

test("menu styling at 1272px: trigger highlight, row colours and submenu widths (Opus review 4)", async ({
  open,
}) => {
  const page = await open("?issue=TEST-2&view=page", { width: 1272, height: 902 });
  await test.step("an open menu keeps its trigger highlighted, and action rows use Linear's label, key and ▶ arrow colours (Opus review 4)", async () => {
    await page.waitFor(`!!document.getElementById('summary')`);
    const away = async () => {
      await page.cmd("Input.dispatchMouseEvent", { type: "mouseMoved", x: 1260, y: 890 });
      await sleep(150);
    };
    const bg = (sel: string) =>
      page.eval<string>(`getComputedStyle(document.querySelector('${sel}')).backgroundColor`);
    await away();
    const rest = await bg("#prop-status");
    await page.click("#prop-status");
    await page.waitFor(`!!document.querySelector('[role=dialog]')`);
    await away();
    expect(
      await page.eval(`document.querySelector('#prop-status').getAttribute('aria-expanded')`),
    ).toBe("true");
    expect(await bg("#prop-status")).not.toBe(rest);
    await page.key("Escape");
    await page.waitFor(`!document.querySelector('[role=dialog]')`);
    await away();
    // Focus comes back to the trigger, which wears Linear's focused DetailButton fill until it blurs; the open highlight is gone.
    expect(await page.eval(`document.activeElement.id`)).toBe("prop-status");
    await page.eval(`document.activeElement.blur()`);
    expect(await bg("#prop-status")).toBe(rest);
    await page.click("#issue-options");
    await page.waitFor(`!!document.querySelector('[role=dialog] [cmdk-item]')`);
    await away();
    expect(await bg("#issue-options")).not.toBe(rest);
    const row = `[...document.querySelectorAll('[role=dialog] [cmdk-item]')].find(n=>n.querySelector('[data-submenu-arrow]')&&n.querySelector('.menu-hint'))`;
    expect(
      await page.eval(
        `(()=>{const r=${row};const label=[...r.querySelectorAll('span')].find(s=>!s.children.length&&s.textContent===r.textContent.replace(r.querySelector('.menu-hint').textContent,'').trim());return [getComputedStyle(label).color,getComputedStyle(r.querySelector('.menu-hint')).color,getComputedStyle(r.querySelector('[data-submenu-arrow]')).color,getComputedStyle(r.querySelector('[data-submenu-arrow]'),'::before').content]})()`,
      ),
    ).toEqual(["lch(91.178 1.425 272)", "lch(64.714 1.425 272)", "lch(41.778 1.425 272)", '"▶"']);
  });
  await test.step("a submenu is as wide as its widest row, never a fixed width (Opus review 4: S1)", async () => {
    // Issue options is still open from the step before.
    await page.waitFor(`!!document.querySelector('[cmdk-item][data-value="Copy"]')`);
    await page.click('[cmdk-item][data-value="Copy"]');
    await page.waitFor(`!!document.querySelector('[role=dialog][aria-label="Copy"] [cmdk-item]')`);
    // Its width equals its own max-content width (rows stretch, so they cannot be summed).
    const [menu, content] = await page.eval<[number, number]>(
      `(()=>{const root=document.querySelector('[role=dialog][aria-label="Copy"] [cmdk-root]'),actual=root.getBoundingClientRect().width,old=root.style.width;root.style.width='max-content';const fit=root.getBoundingClientRect().width;root.style.width=old;return [actual,Math.max(174,fit)]})()`,
    );
    expect(menu).toBeCloseTo(content, 0);
    expect(menu).toBeLessThan(360);
  });
});
