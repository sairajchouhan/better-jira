/** Disposable fake-Jira benchmark: initial script gzip and 2,000-issue scroll frames. */
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
    const scripts = new Map<string, number>();
    const pending: Promise<void>[] = [];
    page.on("response", response => {
      if (response.request().resourceType() === "script") pending.push(response.body().then(body => { scripts.set(response.url(), Bun.gzipSync(new Uint8Array(body)).length); }));
    });
    await page.goto(`http://localhost:${port}`);
    await page.locator("[data-key]").first().waitFor();
    // Include the existing idle preloads, not only the HTML's static imports.
    await page.waitForTimeout(1000);
    await Promise.all(pending);
    const initialGzip = [...scripts.values()].reduce((a, b) => a + b, 0);
    for (const layout of ["board", "list"]) {
      if (layout === "list") await page.keyboard.press("Meta+b");
      await page.locator(`[data-layout=${layout}]`).waitFor();
      const measurement = await page.evaluate(async (layout) => {
        const root = [...document.querySelectorAll<HTMLElement>(`[data-layout=${layout}]`)].find(e => e.offsetParent)!;
        const targets = [root, ...root.querySelectorAll<HTMLElement>("*")].filter(e => e.clientHeight && e.scrollHeight > e.clientHeight + 1 && /auto|scroll/.test(getComputedStyle(e).overflowY));
        const frames: number[] = [];
        let previous = 0;
        for (let step = 0; step < 180; step++) await new Promise<void>(resolve => requestAnimationFrame(time => {
          if (previous) frames.push(time - previous);
          previous = time;
          for (const target of targets) target.scrollTop = (target.scrollHeight - target.clientHeight) * (step / 179);
          resolve();
        }));
        frames.sort((a,b) => a-b);
        return { p95: frames[Math.ceil(frames.length * .95)-1], rendered: root.querySelectorAll("[data-key]").length, containers: targets.length };
      }, layout);
      results.push({ run, layout, initialGzip, ...measurement });
    }
    await page.close();
  }
  console.log(JSON.stringify(results, null, 2));
} finally { await browser.close(); server.kill(); }
