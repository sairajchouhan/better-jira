import { test, expect, fixture, PREFS_KEY } from "./app";

test("BJ-110 keeps the document visible while its first editor chunk loads", async ({ open }) => {
  const app = await open();
  // The start-up scripts: the entry module and every chunk it imports statically. Chunks fetched later by a dynamic import are
  // not among them, even when the page warms one on idle before the first key (R3-issue-fields-D7 warms chrono for Shift+D).
  const staticImport = /\b(?:import|export)\s*(?:[\w$*{},\s]*?from\s*)?"([^"]+\.js)"/g;
  const queue = await app.page.evaluate(() => [...document.querySelectorAll<HTMLScriptElement>("script[type=module][src]")].map((s) => s.src));
  const initial = new Set<string>();
  for (let url = queue.shift(); url; url = queue.shift()) {
    if (initial.has(url)) continue;
    initial.add(url);
    const code = await (await app.page.request.get(url)).text();
    expect(code).not.toContain("Invalid content for node");
    expect(code).not.toContain("sept:9,\"sept.\":9");
    for (const [, path] of code.matchAll(staticImport)) queue.push(new URL(path!, url).href);
  }
  expect(initial.size).toBeGreaterThan(1);
  let release!: () => void;
  const gate = new Promise<void>(resolve => { release = resolve; });
  let editorRequested = false;
  await app.page.route("**/*.js", async route => {
    const response = await route.fetch();
    if ((await response.text()).includes("Invalid content for node")) {
      editorRequested = true;
      await gate;
    }
    await route.fulfill({ response });
  });
  await app.click("[data-key=TEST-1]");
  const composer = app.page.locator('[aria-busy="true"][aria-label="Leave a comment…"]');
  try {
    await expect(app.page.locator('[aria-busy="true"].rich-content').first()).toBeVisible();
    // Hovering the card already asked for the chunk; what is typed before it arrives is kept.
    expect(editorRequested).toBe(true);
    await composer.click();
    await app.page.keyboard.type("Typed early");
    await expect(composer).toHaveText("Typed early");
  } finally { release(); }
  await expect(app.page.locator(".ProseMirror").first()).toBeVisible();
  await expect(app.page.locator("#comment")).toHaveText("Typed early");
  await expect(app.page.locator("#comment")).toBeFocused();
});

for (const layout of ["list", "board"] as const) {
  for (const rows of ["none", "assignee"] as const) {
    test(`BJ-111 windows ${layout} with ${rows} lanes, scrolls selection and preserves drops`, async ({ open }) => {
      await fixture.reset({ bulk: 2000, writable: true });
      const app = await open("", { setup: `localStorage.setItem(${JSON.stringify(PREFS_KEY)}, JSON.stringify({1:{display:{layout:${JSON.stringify(layout)},rows:${JSON.stringify(rows)}}}}))` });
      const root = app.page.locator(`[data-layout=${layout}]`).filter({ visible: true });
      await expect(root.locator("[data-virtual-items]").first()).toBeAttached();
      expect(await root.locator("[data-key]").count()).toBeLessThan(600);
      if (layout === "board" && rows === "none") {
        // A drop across windowed columns still lands.
        const columns = root.locator("section");
        const source = columns.nth(0).locator("[data-key]").first();
        const sourceKey = (await source.getAttribute("data-key"))!;
        const box = (await columns.nth(1).locator("[data-key]").first().boundingBox())!;
        await source.hover();
        await app.page.mouse.down();
        await app.page.mouse.move(box.x + box.width / 2, box.y + 4, { steps: 8 });
        await app.page.mouse.up();
        await expect.poll(async () => (await fixture.log()).writes.some((w: { key: string }) => w.key === sourceKey)).toBe(true);
        // And into a column scrolled deep into its window.
        await columns.nth(1).locator(".overflow-y-auto").evaluate(element => { element.scrollTop = 3000; });
        const next = columns.nth(0).locator("[data-key]").first();
        const nextKey = (await next.getAttribute("data-key"))!;
        // A card mounted in the scrolled window, below the column's top edge.
        const target = await columns.nth(1).locator(".overflow-y-auto").evaluate(async element => {
          await new Promise(requestAnimationFrame);
          const clip = element.getBoundingClientRect();
          const card = [...element.querySelectorAll("[data-key]")].map(c => c.getBoundingClientRect()).find(r => r.top > clip.top + 100)!;
          return { x: card.x, y: card.y, width: card.width };
        });
        await next.hover();
        await app.page.mouse.down();
        await app.page.mouse.move(target.x + target.width / 2, target.y + 4, { steps: 8 });
        await app.page.mouse.up();
        await expect.poll(async () => (await fixture.log()).writes.some((w: { key: string }) => w.key === nextKey)).toBe(true);
      }
      // Native scroll containers remain in place, including the board's outer swimlane scroller. Measured cards can
      // outgrow their estimate and move the end, so scroll again until the windows have caught up.
      const windowed = root.locator('[data-key]:not([style*="absolute"])');
      await expect.poll(async () => {
        await root.evaluate(element => {
          for (const target of [element, ...element.querySelectorAll<HTMLElement>("*")]) {
            if (!/auto|scroll/.test(getComputedStyle(target).overflowY)) continue;
            target.scrollTop = target.scrollHeight;
            target.scrollLeft = target.scrollWidth;
          }
        });
        // A pinned (selected) card is left out: it keeps its place wherever that is.
        return windowed.last().evaluate(element => new Promise<boolean>(resolve => new IntersectionObserver((entries, observer) => {
          observer.disconnect();
          resolve(entries[0]!.intersectionRatio > 0);
        }).observe(element)));
      }).toBe(true);
      expect(await root.locator("[data-key]").count()).toBeLessThan(600);
      const key = await windowed.last().getAttribute("data-key");
      // A click selects a visible row; j/k must mount the adjacent row across the window edge.
      await root.locator(`[data-key="${key}"]`).click({ position: { x: 10, y: 10 } }); // the card itself, not a badge
      await app.key("Escape");
      await app.key("k");
      await expect(root.locator('[data-selected="true"]').first()).toBeInViewport();
      await app.key("j");
      await expect(root.locator(`[data-key="${key}"]`)).toBeInViewport();
    });
  }
}

test("BJ-111 j/k keeps the selection in view across groups and lanes", async ({ open }) => {
  await fixture.reset({ bulk: 90 });
  const app = await open("", { setup: `localStorage.setItem(${JSON.stringify(PREFS_KEY)}, JSON.stringify({1:{display:{layout:"list",rows:"assignee"}}}))` });
  const root = app.page.locator("[data-layout=list]").filter({ visible: true });
  await root.locator("[data-key]").first().click();
  await app.key("Escape");
  // 15 lanes of about six rows: every few presses the selection crosses into another lane's window.
  for (const key of ["j", "k"])
    for (let press = 0; press < 40; press++) {
      await app.key(key);
      await expect(root.locator('[data-selected="true"]')).toBeInViewport();
    }
  expect(await root.locator("[data-key]").count()).toBeLessThan(60);
});

test("BJ-filter-speed: on a 1,100-issue board with 1,044 labels, each Add filter submenu opens on hover without a long frame", async ({ open }) => {
  const labels = Array.from({ length: 1044 }, (_, k) => `label-${k}`);
  await fixture.reset({ bulk: 1100, bulkVariety: 60, catalog: { priorities: ["Urgent", "High", "Normal", "Low"], labels, users: [] } });
  const app = await open();
  await app.click('[aria-label="Add filter"]');
  const menu = app.page.locator('[data-popover] [cmdk-root]').first();
  await expect(menu).toBeVisible();
  // Long frames since the last reset; the menu's rows and their submenus are what runs.
  await app.page.evaluate(() => {
    const w = window as unknown as { longFrames: number[] };
    w.longFrames = [];
    new PerformanceObserver((list) => { for (const e of list.getEntries()) w.longFrames.push(e.duration); }).observe({ type: "long-animation-frame" });
  });
  for (const name of ["Status", "Assignee", "Creator", "Priority", "Labels", "Relations", "Subscribers", "Issue type"]) {
    const row = menu.locator(`[cmdk-item][data-value="${name}"]`);
    const box = (await row.boundingBox())!;
    const started = Date.now();
    await app.page.mouse.move(box.x + 40, box.y + box.height / 2);
    await expect(app.page.locator(`[role="dialog"][aria-label="${name} filter"] [cmdk-item]`).first()).toBeVisible();
    // Before: Labels 714ms, Assignee 349ms on this data; after: 250ms and 110ms. The budget leaves CI headroom.
    expect(Date.now() - started).toBeLessThan(600);
  }
  const longest = await app.page.evaluate(() => Math.max(0, ...(window as unknown as { longFrames: number[] }).longFrames));
  expect(longest).toBeLessThan(500);
});

test("BJ-filter-speed: toggling a label in the Labels filter keeps its list, and ← still steps back to the categories", async ({ open }) => {
  const labels = Array.from({ length: 300 }, (_, k) => `label-${k}`);
  await fixture.reset({ bulk: 400, bulkVariety: 60, catalog: { priorities: [], labels, users: [] } });
  const app = await open();
  await app.click('[aria-label="Add filter"]');
  await app.hover("text=Labels");
  const sub = app.page.locator('[role="dialog"][aria-label="Labels filter"]');
  const rows = sub.locator("[cmdk-item]");
  await expect(rows.nth(3)).toBeVisible();
  const before = await rows.count();
  // Each row's node is tagged; a toggle that rebuilt the list would drop the tags.
  await sub.evaluate((node) => node.querySelectorAll("[cmdk-item]").forEach((row, i) => row.setAttribute("data-tag", String(i))));
  await sub.hover();
  await rows.nth(1).click();
  await rows.nth(2).click();
  await expect(rows.nth(1)).toHaveAttribute("aria-checked", "true");
  await expect(rows.nth(2)).toHaveAttribute("aria-checked", "true");
  expect(await rows.count()).toBe(before);
  expect(await sub.locator("[cmdk-item][data-tag]").count()).toBe(before);
  await app.page.keyboard.press("ArrowLeft");
  await expect(sub).toBeHidden();
  await expect(app.page.locator('[aria-label="Add Filter…"]')).toBeFocused();
});

// React's DevTools hook, installed before the app: it counts React commits, so a scroll that renders shows up.
const COUNT_COMMITS = `(() => { let n = 0; window.__REACT_DEVTOOLS_GLOBAL_HOOK__ = { isDisabled: false, supportsFiber: true, renderers: new Map(),
  inject() { return 1; }, onCommitFiberRoot() { window.commits = ++n; }, onCommitFiberUnmount() {}, onPostCommitFiberRoot() {},
  checkDCE() {}, onScheduleFiberRoot() {} }; })()`;

test("BJ-board-scroll: a 1,100-issue board column scrolls without rendering on most frames, keeping its mounted cards", async ({ open }) => {
  await fixture.reset({ bulk: 1100, bulkVariety: 60 });
  const app = await open("", { setup: COUNT_COMMITS });
  const column = app.page.locator("[data-board-column]").filter({ visible: true }).first();
  await expect(column.locator("[role=row][data-key]").first()).toBeVisible();
  const result = await column.locator(".board-column-body").evaluate(async (body) => {
    const w = window as unknown as { commits?: number };
    const raf = () => new Promise<number>(requestAnimationFrame);
    // A card on screen before the scroll; tagged, so a re-mount (a new node) would drop the tag.
    const kept = body.querySelector<HTMLElement>("[role=row][data-key]")!;
    kept.dataset.tag = "kept";
    const longFrames: number[] = [];
    const observer = new PerformanceObserver((list) => { for (const e of list.getEntries()) longFrames.push(e.duration); });
    observer.observe({ type: "long-animation-frame" });
    await raf();
    const before = w.commits ?? 0;
    // A slow scroll first: 40px a frame stays within the first window, so the card on screen is still mounted.
    for (let i = 0; i < 5; i++) { body.scrollTop += 40; await raf(); }
    const stillMounted = kept.isConnected && kept.dataset.tag === "kept";
    let rows = 0;
    for (let i = 0; i < 120; i++) {
      body.scrollTop += 120;
      await raf();
      rows = Math.max(rows, document.querySelectorAll("[role=row][data-key]").length);
    }
    await raf();
    observer.disconnect();
    return { commits: (w.commits ?? 0) - before, frames: 125, stillMounted, rows, long: longFrames.filter((d) => d > 100).length };
  });
  // Before (06e8b45): 2.83 commits a frame and 78–95 of 119 frames over 50ms; after: 0.42–0.49 commits a frame and 5–15.
  // Each commit is a window move; a frame within the window renders nothing.
  expect(result.commits / result.frames).toBeLessThan(0.8);
  expect(result.stillMounted).toBe(true);
  // The whole board's mounted rows stay a window's worth, every column together.
  expect(result.rows).toBeLessThan(150);
  expect(result.long).toBeLessThan(20);
});

test("BJ-board-scroll: the selection moving between columns re-renders neither column's other cards", async ({ open }) => {
  await fixture.reset({ bulk: 1100, bulkVariety: 60 });
  const app = await open("", { setup: COUNT_COMMITS });
  const columns = app.page.locator("[data-board-column]").filter({ visible: true });
  await columns.first().locator("[role=row][data-key]").first().click({ position: { x: 10, y: 10 } });
  await app.key("Escape");
  const commitsOf = () => app.page.evaluate(() => (window as unknown as { commits?: number }).commits ?? 0);
  // j/k moves the selection one card: one commit for it, never one per column of rows told about another column's key.
  const start = await commitsOf();
  for (let press = 0; press < 10; press++) await app.key("j");
  await expect(columns.first().locator('[data-selected="true"]')).toBeInViewport();
  expect((await commitsOf()) - start).toBeLessThan(40);
  // ← and → cross columns, and the selection is still shown and in view.
  await app.key("ArrowRight");
  await expect(columns.nth(1).locator('[data-selected="true"]')).toBeInViewport();
  expect(await columns.first().locator('[data-selected="true"]').count()).toBe(0);
});
