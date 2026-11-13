import { expect, sleep, test } from "./app";

/** The board split panel's resize handle, from Linear's IssueList `Df` + `B_`/`z_` (see .raj/linear.md "Side panel resize"). */
const PANEL = `document.querySelector('[data-mode=side]')`;
const panelWidth = `${PANEL}.getBoundingClientRect().width`;
const rowWidth = `${PANEL}.parentElement.clientWidth`;

test("side panel resizes from its left edge like Linear's board split panel", async ({ open }) => {
  const app = await open("?issue=TEST-2");
  await app.waitFor(`!!${PANEL}&&!!document.querySelector('.resize-handle')`);
  const row = await app.eval<number>(rowWidth);
  const handle = async () => {
    const r = await app.rect(".resize-handle");
    return { x: r.x + r.width / 2, y: r.y + r.height / 2 };
  };

  await test.step("opens at the 760px default, clamped to leave the board 640px", async () => {
    expect(await app.eval<number>(panelWidth)).toBeCloseTo(Math.min(760, row - 640), 0);
  });

  await test.step("dragging resizes live, the board reflows, and the page shows col-resize without selecting text", async () => {
    await app.eval(`sessionStorage.clear(),localStorage.removeItem('better-jira:boardSplitPanelWidth')`);
    const start = await app.eval<number>(panelWidth);
    const { x, y } = await handle();
    const mouse = app.page.mouse;
    await mouse.move(x, y);
    await mouse.down();
    await mouse.move(x + 40, y, { steps: 4 });
    await app.waitFor(`Math.abs(${panelWidth}-${start - 40})<1`);
    // Live: still mid-drag, the board's column ends where the panel starts.
    expect(
      await app.eval(
        `document.body.classList.contains('resize-dragging')&&getComputedStyle(document.body).userSelect==='none'&&!!document.querySelector('.resize-drag-layer')`,
      ),
    ).toBe(true);
    expect(
      await app.eval<number>(
        `(()=>{const b=[...${PANEL}.parentElement.children].find(n=>n!==${PANEL}&&n.getClientRects().length);return Math.abs(b.getBoundingClientRect().right-${PANEL}.getBoundingClientRect().left)})()`,
      ),
    ).toBeLessThan(1);
    // Linear saves every frame, not only on release.
    expect(await app.eval(`Number(sessionStorage.getItem('better-jira:boardSplitPanelWidth'))`)).toBeCloseTo(start - 40, 0);
    await mouse.move(x + 20, y, { steps: 2 });
    await mouse.up();
    await app.waitFor(`!document.body.classList.contains('resize-dragging')&&!document.querySelector('.resize-drag-layer')`);
    expect(await app.eval<number>(panelWidth)).toBeCloseTo(start - 20, 0);
  });

  await test.step("clamps at 480px and at the width that leaves the board 640px", async () => {
    let { x, y } = await handle();
    await app.pointerDrag(x, y, x + 2000, y);
    await app.waitFor(`Math.abs(${panelWidth}-480)<1`);
    ({ x, y } = await handle());
    await app.pointerDrag(x, y, 0, y);
    await app.waitFor(`Math.abs(${panelWidth}-${row - 640})<1`);
    // The gesture clamps before it saves, so the setting never holds a width the panel could not take.
    expect(await app.eval(`Number(sessionStorage.getItem('better-jira:boardSplitPanelWidth'))`)).toBe(row - 640);
    ({ x, y } = await handle());
    await app.pointerDrag(x, y, x + 60, y);
    await app.waitFor(`Math.abs(${panelWidth}-${row - 700})<1`);
  });

  await test.step("the width survives a reload, and a new tab starts from it", async () => {
    await app.reload();
    await app.waitFor(`!!document.querySelector('.resize-handle')`);
    expect(await app.eval<number>(panelWidth)).toBeCloseTo(row - 700, 0);
    const tab = await open("?issue=TEST-2", { tabOf: app });
    await tab.waitFor(`!!${PANEL}`);
    expect(await tab.eval<number>(panelWidth)).toBeCloseTo(row - 700, 0);
    await tab.close();
  });

  await test.step("hovering the edge shows Linear's tooltip after 450ms", async () => {
    const { x, y } = await handle();
    await app.page.mouse.move(x - 200, y);
    await app.page.mouse.move(x, y);
    await sleep(250);
    expect(await app.eval(`!!document.querySelector('.resize-tooltip')`)).toBe(false);
    await app.waitFor(`document.querySelector('.resize-tooltip')?.textContent==='Drag to resizeClick to collapse'`);
  });

  await test.step("a double click does nothing; a single click closes the panel", async () => {
    const { x, y } = await handle();
    await app.page.mouse.dblclick(x, y);
    await sleep(400);
    expect(await app.eval(`!!${PANEL}`)).toBe(true);
    expect(await app.eval<number>(panelWidth)).toBeCloseTo(row - 700, 0);
    await app.page.mouse.click(x, y);
    expect(await app.eval(`!!${PANEL}`)).toBe(true); // Linear waits 200ms for a second click first
    await app.waitFor(`!${PANEL}`);
  });
});

test("a window too narrow for the panel and a 640px board gets the panel over the page, without a handle", async ({
  open,
}) => {
  const app = await open("?issue=TEST-2", { width: 1100 });
  await app.waitFor(`!!${PANEL}`);
  expect(await app.eval<number>(rowWidth)).toBeLessThan(1120);
  expect(await app.eval(`${PANEL}.dataset.fillsPage`)).toBe("true");
  expect(await app.eval<number>(panelWidth)).toBeCloseTo(await app.eval<number>(rowWidth), 0);
  expect(await app.eval(`!!document.querySelector('.resize-handle')`)).toBe(false);
  // Widening the window brings the panel back beside the board, with its handle.
  await app.page.setViewportSize({ width: 1600, height: 900 });
  await app.waitFor(`!${PANEL}.dataset.fillsPage&&!!document.querySelector('.resize-handle')`);
});
