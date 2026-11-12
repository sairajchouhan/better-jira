import { test, expect, fixture, PREFS_KEY } from "./app";

test("BJ-110 keeps the document visible while its first editor chunk loads", async ({ open }) => {
  const app = await open();
  const initial = await app.page.evaluate(() => performance.getEntriesByType("resource").filter((r: any) => r.initiatorType === "script").map(r => r.name));
  for (const url of initial) {
    const code = await (await app.page.request.get(url)).text();
    expect(code).not.toContain("Invalid content for node");
    expect(code).not.toContain("sept:9,\"sept.\":9");
  }
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
  try {
    await expect(app.page.locator('[aria-busy="true"].rich-content').first()).toBeVisible();
    expect(editorRequested).toBe(true);
  } finally { release(); }
  await expect(app.page.locator(".ProseMirror").first()).toBeVisible();
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
      }
      // Native scroll containers remain in place, including the board's outer swimlane scroller.
      await root.evaluate(element => {
        for (const target of [element, ...element.querySelectorAll<HTMLElement>("*")]) {
          if (target.scrollHeight > target.clientHeight && /auto|scroll/.test(getComputedStyle(target).overflowY)) target.scrollTop = target.scrollHeight;
        }
      });
      await expect.poll(async () => root.locator("[data-key]").count()).toBeLessThan(600);
      const last = root.locator("[data-key]").last();
      await expect(last).toBeVisible();
      const key = await last.getAttribute("data-key");
      // A click selects a visible row; j/k must mount the adjacent row across the window edge.
      await last.click();
      await app.key("Escape");
      await app.key("k");
      await expect(root.locator('[data-selected="true"]').first()).toBeInViewport();
      await app.key("j");
      await expect(root.locator(`[data-key="${key}"]`)).toBeInViewport();
    });
  }
}
