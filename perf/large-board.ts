/** Disposable fake-Jira benchmark (BJ-110, BJ-111): initial script gzip, then a 2,000-issue board and list:
 *  mounted cards and DOM nodes, the ⌘B layout switch's interaction time, long-task totals and scroll frames.
 *  Usage: build the fixture (`bun scripts/build-server.ts scripts/fixture-server.ts dist/fixture`), then
 *  `E2E_PORT_BASE=5200 bun perf/large-board.ts > out.json`. */
import { chromium } from "@playwright/test";
const port = Number(process.env.E2E_PORT_BASE ?? 5200);
const server = Bun.spawn(["bun", "dist/fixture/fixture-server.js"], {
  env: { ...process.env, FIXTURE_PORT: String(port), FIXTURE_EXIT_ON_EOF: "1", NODE_ENV: "production" },
  stdin: "pipe", stdout: "pipe", stderr: "inherit",
});
const reader = server.stdout.getReader();
while (!(new TextDecoder().decode((await reader.read()).value)).includes("Disposable browser fixture on")) {}
const browser = await chromium.launch();
try {
  await fetch(`http://localhost:${port}/__fixture`, { method: "POST", body: JSON.stringify({ bulk: 2000 }) });
  const results = [];
  for (let run = 0; run < 3; run++) {
    const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
    await page.addInitScript(() => {
      const w = window as any;
      w.longTasks = [];
      w.events = [];
      new PerformanceObserver(list => w.longTasks.push(...list.getEntries().map(e => e.duration))).observe({ type: "longtask", buffered: true });
      new PerformanceObserver(list => w.events.push(...list.getEntries().map(e => ({ name: e.name, duration: e.duration })))).observe({ type: "event", durationThreshold: 16, buffered: true } as PerformanceObserverInit);
    });
    const scripts = new Map<string, number>();
    const pending: Promise<void>[] = [];
    page.on("response", response => {
      if (response.request().resourceType() === "script") pending.push(response.body().then(body => { scripts.set(response.url(), Bun.gzipSync(new Uint8Array(body)).length); }));
    });
    await page.goto(`http://localhost:${port}`);
    await page.locator("[data-key]").first().waitFor();
    // Include idle preloads, not only the HTML's static imports.
    await page.waitForTimeout(1000);
    await Promise.all(pending);
    const initialGzip = [...scripts.values()].reduce((a, b) => a + b, 0);
    const sum = (key: "longTasks") => page.evaluate(k => { const w = window as any, total = w[k].reduce((a: number, b: number) => a + b, 0); w[k] = []; return Math.round(total); }, key);
    const loadLongTasks = await sum("longTasks");
    for (const layout of ["board", "list"]) {
      let switchMs: number | undefined;
      if (layout === "list") {
        await page.evaluate(() => { (window as any).events = []; });
        await page.keyboard.press("Meta+b");
        await page.locator(`[data-layout=list]`).waitFor();
        await page.waitForTimeout(300);
        // Event Timing: keydown to the next paint, the switch's interaction time.
        switchMs = await page.evaluate(() => Math.max(0, ...(window as any).events.filter((e: { name: string }) => e.name.startsWith("key")).map((e: { duration: number }) => e.duration)));
      }
      await page.locator(`[data-layout=${layout}]`).waitFor();
      const switchLongTasks = layout === "list" ? await sum("longTasks") : undefined;
      const measurement = await page.evaluate(async (layout) => {
        const root = [...document.querySelectorAll<HTMLElement>(`[data-layout=${layout}]`)].find(e => e.offsetParent)!;
        const targets = [root, ...root.querySelectorAll<HTMLElement>("*")].filter(e => e.clientHeight && e.scrollHeight > e.clientHeight + 1 && /auto|scroll/.test(getComputedStyle(e).overflowY));
        const mounted = root.querySelectorAll("[data-key]").length, nodes = document.getElementsByTagName("*").length;
        const frames: number[] = [];
        let previous = 0;
        for (let step = 0; step < 180; step++) await new Promise<void>(resolve => requestAnimationFrame(time => {
          if (previous) frames.push(time - previous);
          previous = time;
          for (const target of targets) target.scrollTop = (target.scrollHeight - target.clientHeight) * (step / 179);
          resolve();
        }));
        frames.sort((a,b) => a-b);
        return { p95: frames[Math.ceil(frames.length * .95)-1], mounted, nodes, containers: targets.length };
      }, layout);
      const scrollLongTasks = await sum("longTasks");
      results.push({ run, layout, initialGzip, loadLongTasks, switchMs, switchLongTasks, scrollLongTasks, ...measurement });
    }
    await page.close();
  }
  console.log(JSON.stringify(results, null, 2));
} finally { await browser.close(); server.kill(); }
