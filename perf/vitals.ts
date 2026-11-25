/* oxlint-disable no-underscore-dangle -- React DevTools hook and the page-side __perf store need these names */
import { chromium, type Page } from "@playwright/test";
import { parseArgs } from "util";

const { values } = parseArgs({
  args: Bun.argv.slice(2),
  options: {
    cpu: { type: "string" },
    url: { type: "string" },
    runs: { type: "string", default: "10" },
    out: { type: "string", default: "perf/results.json" },
  },
});
if (!values.url)
  throw Error("Usage: bun perf/vitals.ts --url http://localhost:3050 --runs 10 --out results.json");
const base = new URL(values.url),
  runs = Number(values.runs);
if (!Number.isInteger(runs) || runs < 1) throw Error("runs must be a positive integer");
const quantile = (xs: number[], q: number) =>
  xs.length ? [...xs].sort((a, b) => a - b)[Math.max(0, Math.ceil(q * xs.length) - 1)]! : null;
const sleep = (ms: number) => Bun.sleep(ms);
async function api(path: string) {
  const r = await fetch(new URL(path, base));
  if (!r.ok) throw Error(`${path}: ${r.status}`);
  return r.json() as any;
}
// Require the server write gate before launching any browser.
const home = await fetch(base);
if (!home.ok || !(await home.text()).includes("<html")) throw Error("URL did not return app HTML");
const client = await api("/api/client");
if (client.writable !== false) throw Error("Read-only Jira server required");
const boards = await api("/api/boards");
if (boards.length < 2) throw Error("Scenario requires two boards");
const readinessStart = Date.now();
let stableSince = 0,
  fingerprint = "",
  progress: any;
while (Date.now() - readinessStart < 600_000) {
  const p = await api("/api/properties");
  progress = p.progress;
  const next = JSON.stringify(p);
  if (p.progress.total > 0 && p.progress.pending === 0) {
    if (next !== fingerprint) stableSince = Date.now();
    if (stableSince && Date.now() - stableSince >= 10_000) break;
  } else stableSince = 0;
  fingerprint = next;
  await sleep(1000);
}
if (!stableSince || Date.now() - stableSince < 10_000) throw Error("Mirror did not become stable");

function instrument() {
  const w = window as any;
  const p = (w.__perf = {
    paints: [] as any[],
    lcp: [] as any[],
    shifts: [] as any[],
    tasks: [] as any[],
    events: [] as any[],
    commits: [] as any[],
    boardReady: null as number | null,
    supported: PerformanceObserver.supportedEntryTypes,
  });
  const observe = (type: string, to: any[], extra = {}) => {
    if (!PerformanceObserver.supportedEntryTypes.includes(type)) return;
    new PerformanceObserver((list) => {
      for (const e of list.getEntries() as any)
        to.push({
          name: e.name,
          startTime: e.startTime,
          duration: e.duration,
          value: e.value,
          hadRecentInput: e.hadRecentInput,
          interactionId: e.interactionId,
          processingStart: e.processingStart,
          processingEnd: e.processingEnd,
        });
    }).observe({ type, buffered: true, ...extra });
  };
  observe("paint", p.paints);
  observe("largest-contentful-paint", p.lcp);
  observe("layout-shift", p.shifts);
  observe("longtask", p.tasks);
  observe("event", p.events, { durationThreshold: 16 });
  let renderer = 0;
  let previousFibers = new WeakSet<object>();
  w.__REACT_DEVTOOLS_GLOBAL_HOOK__ = {
    supportsFiber: true,
    renderers: new Map(),
    inject(r: any) {
      const id = ++renderer;
      this.renderers.set(id, r);
      return id;
    },
    onScheduleFiberRoot() {},
    onCommitFiberUnmount() {},
    onPostCommitFiberRoot() {},
    onCommitFiberRoot(id: number, root: any) {
      let fibers = 0,
        visited = 0;
      const currentFibers = new WeakSet<object>();
      const walk = (f: any) => {
        if (!f) return;
        visited++;
        currentFibers.add(f);
        if (!previousFibers.has(f) && f.flags & 1) fibers++;
        walk(f.child);
        walk(f.sibling);
      };
      walk(root.current);
      previousFibers = currentFibers;
      p.commits.push({ at: performance.now(), renderer: id, fibers, visited });
    },
  };
  const ready = () => {
    if (
      p.boardReady === null &&
      document.querySelector("[data-key]") &&
      document.querySelector("[data-layout]")
    ) {
      requestAnimationFrame(() =>
        requestAnimationFrame(() => {
          if (p.boardReady === null) p.boardReady = performance.now();
        }),
      );
    }
  };
  new MutationObserver(ready).observe(document, { childList: true, subtree: true });
}
const frames = async (page: Page) =>
  page.evaluate(
    () => new Promise<void>((r) => requestAnimationFrame(() => requestAnimationFrame(() => r()))),
  );
async function boardReady(page: Page) {
  await page.locator("[data-key]:visible").first().waitFor();
  await page.waitForFunction(() => (window as any).__perf.boardReady !== null);
  await frames(page);
}
const records: any[] = [];
const browser = await chromium.launch({ headless: true });
try {
  for (const cpu of values.cpu ? [Number(values.cpu)] : [1, 4])
    for (let run = 1; run <= runs; run++) {
      const context = await browser.newContext({
        viewport: { width: 1440, height: 900 },
        reducedMotion: "no-preference",
        serviceWorkers: "block",
      });
      try {
        const blocked: string[] = [];
        await context.route("**/*", async (route) => {
          const r = route.request(),
            u = new URL(r.url());
          if (u.hostname.endsWith(".atlassian.net") && r.method() !== "GET") {
            blocked.push(`${r.method()} ${u.hostname}${u.pathname}`);
            await route.abort();
            return;
          }
          await route.continue();
        });
        await context.addInitScript(instrument);
        const page = await context.newPage();
        page.setDefaultTimeout(20_000);
        const cdp = await context.newCDPSession(page);
        await cdp.send("Emulation.setCPUThrottlingRate", { rate: cpu });
        const errors: string[] = [],
          writes: string[] = [];
        page.on("pageerror", (e) => errors.push(e.message));
        page.on("request", (r) => {
          if (!["GET", "HEAD", "OPTIONS"].includes(r.method()))
            writes.push(`${r.method()} ${new URL(r.url()).pathname}`);
        });
        for (const cache of ["cold", "warm"]) {
          const url = new URL(base);
          url.searchParams.set("board", String(boards[0].id));
          url.searchParams.delete("issue");
          url.searchParams.delete("inbox");
          if (cache === "cold") await page.goto(url.href, { waitUntil: "load" });
          else {
            await page.goto(url.href, { waitUntil: "load" });
            await page.reload({ waitUntil: "load" });
          }
          await boardReady(page);
          // Capture load entries before the first input finalizes LCP. No artificial network-idle on SSE.
          await page.waitForTimeout(250);
          const load = await page.evaluate(() => {
            const p = (window as any).__perf,
              nav = performance.getEntriesByType("navigation")[0] as PerformanceNavigationTiming;
            const fcp =
              p.paints.find((e: any) => e.name === "first-contentful-paint")?.startTime ?? null;
            return {
              lcp: p.lcp.at(-1)?.startTime ?? null,
              fcp,
              ttfb: nav.responseStart - nav.startTime,
              firstBoard: p.boardReady,
              tbt: p.tasks.reduce(
                (s: number, t: any) =>
                  s +
                  (fcp !== null && t.startTime >= fcp && t.startTime < p.boardReady
                    ? Math.max(
                        0,
                        Math.min(t.startTime + t.duration, p.boardReady) - t.startTime - 50,
                      )
                    : 0),
                0,
              ),
              supported: p.supported,
            };
          });
          const interactions: any[] = [];
          async function action(
            name: string,
            trigger: () => Promise<any>,
            verify?: () => Promise<any>,
          ) {
            const start = await page.evaluate(() => performance.now());
            await trigger();
            if (verify) await verify();
            await frames(page);
            const end = await page.evaluate(() => performance.now());
            // Allow observer delivery without counting that wait in action completion latency.
            await page.waitForTimeout(60);
            const data = await page.evaluate(
              ({ start, end }) => {
                const p = (window as any).__perf;
                const commits = p.commits.filter((c: any) => c.at >= start && c.at <= end);
                return {
                  commits: commits.length,
                  fibers: commits.reduce((n: number, c: any) => n + c.fibers, 0),
                  events: p.events.filter((e: any) => e.startTime >= start && e.startTime <= end),
                };
              },
              { start, end },
            );
            const uiState = await page.evaluate(() => ({
              selected:
                document
                  .querySelector("[data-selected=true][data-key]")
                  ?.getAttribute("data-key") ?? null,
              appTiming:
                document.querySelector("span.font-mono.text-emerald-500")?.textContent ?? null,
            }));
            interactions.push({ name, start, end, latency: end - start, ...data, ...uiState });
          }
          await page.locator("[data-key]:visible").first().focus();
          for (let i = 0; i < 50; i++)
            await action(`navigate-${i + 1}`, () => page.keyboard.press(i < 25 ? "j" : "k"));
          const distinctNavigation = new Set(
            interactions
              .filter((a) => a.name.startsWith("navigate-"))
              .map((a) => a.selected)
              .filter(Boolean),
          ).size;
          if (distinctNavigation < 21)
            throw Error(`Only ${distinctNavigation} distinct issues visited`);
          await action(
            "issue-open",
            () => page.keyboard.press("Enter"),
            () => page.locator(".issue-detail:visible").waitFor(),
          );
          await action(
            "issue-close",
            () => page.keyboard.press("Escape"),
            () => page.locator(".issue-detail:visible").waitFor({ state: "hidden" }),
          );
          await action(
            "board-switch",
            () =>
              page
                .getByRole("navigation", { name: "Main navigation" })
                .getByRole("button", { name: boards[1].name, exact: false })
                .click(),
            async () => {
              await page.waitForURL((u) => u.searchParams.get("board") === String(boards[1].id));
              await page.locator("[data-key]:visible").first().waitFor();
            },
          );
          await action(
            "command-open",
            () => page.keyboard.press("Meta+k"),
            () => page.locator("[cmdk-input]").waitFor(),
          );
          await action("command-type", () => page.locator("[cmdk-input]").fill("Switch"));
          await action(
            "command-close",
            () => page.keyboard.press("Escape"),
            () => page.locator("[cmdk-input]").waitFor({ state: "hidden" }),
          );
          await action(
            "filter-open",
            () => page.keyboard.press("f"),
            () => page.locator(".filter-menu").waitFor(),
          );
          await action(
            "filter-close",
            () => page.keyboard.press("Escape"),
            () => page.locator(".filter-menu").waitFor({ state: "hidden" }),
          );
          const scrolls: any[] = [];
          for (const layout of ["board", "list"]) {
            if (
              (await page.locator("[data-layout]:visible").first().getAttribute("data-layout")) !==
              layout
            )
              await action(
                `layout-${layout}`,
                () => page.keyboard.press("Meta+b"),
                () => page.locator(`[data-layout="${layout}"]:visible`).first().waitFor(),
              );
            await page.waitForTimeout(250);
            await action(`scroll-${layout}`, async () => {
              scrolls.push(
                await page.evaluate(async (layout) => {
                  const root = [...document.querySelectorAll("[data-layout]")].find(
                    (e) => (e as HTMLElement).offsetParent !== null,
                  )!;
                  const targets = [root, ...root.querySelectorAll("*")].filter(
                    (e: any) =>
                      e.clientHeight > 0 &&
                      e.scrollHeight > e.clientHeight + 1 &&
                      /auto|scroll/.test(getComputedStyle(e).overflowY),
                  ) as HTMLElement[];
                  if (!targets.length) throw Error(`No overflowing ${layout} containers`);
                  const deltas: number[] = [];
                  let last: number | null = null;
                  for (let i = 0; i < 90; i++) {
                    await new Promise<void>((r) =>
                      requestAnimationFrame((t) => {
                        if (last !== null) deltas.push(t - last);
                        last = t;
                        for (const e of targets)
                          e.scrollTop = (e.scrollHeight - e.clientHeight) * ((i + 1) / 90);
                        r();
                      }),
                    );
                  }
                  return {
                    layout,
                    deltas,
                    containers: targets.length,
                    positions: targets.map((e) => ({
                      top: e.scrollTop,
                      max: e.scrollHeight - e.clientHeight,
                    })),
                  };
                }, layout),
              );
            });
          }
          const scroll = { deltas: scrolls.flatMap((s) => s.deltas), layouts: scrolls };
          await page.waitForTimeout(100);
          const final = await page.evaluate(() => (window as any).__perf);
          const eventGroups = new Map<number, number>();
          for (const a of interactions)
            for (const e of a.events)
              if (e.interactionId)
                eventGroups.set(
                  e.interactionId,
                  Math.max(eventGroups.get(e.interactionId) ?? 0, e.duration),
                );
          const events = [...eventGroups.values()],
            latencies = interactions.map((a) => a.latency);
          let cls = 0,
            windowValue = 0,
            windowStart = 0,
            previous = 0;
          for (const s of final.shifts)
            if (!s.hadRecentInput) {
              if (s.startTime - previous > 1000 || s.startTime - windowStart > 5000) {
                windowStart = s.startTime;
                windowValue = 0;
              }
              windowValue += s.value;
              cls = Math.max(cls, windowValue);
              previous = s.startTime;
            }
          if (writes.length) throw Error(`Unexpected write requests: ${writes.join(", ")}`);
          const jsResources = await page.evaluate(() =>
            performance
              .getEntriesByType("resource")
              .filter((r: any) => r.initiatorType === "script")
              .map((r: any) => ({
                name: new URL(r.name).pathname,
                transferSize: r.transferSize,
                encodedBodySize: r.encodedBodySize,
              })),
          );
          const mirrorAfter = (await api("/api/properties")).progress;
          const result = {
            cpu,
            run,
            cache,
            mirrorAfter,
            blocked,
            distinctNavigation,
            jsResources,
            footer: await page.locator("footer").allTextContents(),
            load,
            interactions,
            scroll,
            errors: [...errors],
            raw: final,
            metrics: {
              ...Object.fromEntries(Object.entries(load).filter(([k]) => k !== "supported")),
              cls,
              eventP50: quantile(events, 0.5),
              eventP95: quantile(events, 0.95),
              eventMax: events.length ? Math.max(...events) : null,
              inpProxyP98: quantile(events, 0.98),
              eventInteractions: events.length,
              interactionP50: quantile(latencies, 0.5),
              interactionP95: quantile(latencies, 0.95),
              interactionMax: Math.max(...latencies),
              commits: interactions.reduce((n, a) => n + a.commits, 0),
              fibers: interactions.reduce((n, a) => n + a.fibers, 0),
              totalCommits: final.commits.length,
              totalFibers: final.commits.reduce((n: number, c: any) => n + c.fibers, 0),
              appBoardSwitch:
                Number(
                  interactions
                    .find((a) => a.name === "board-switch")
                    .appTiming?.match(/switch board · ([\d.]+)ms/)?.[1],
                ) || null,
              boardSwitch: interactions.find((a) => a.name === "board-switch").latency,
              issueOpen: interactions.find((a) => a.name === "issue-open").latency,
              commandOpen: interactions.find((a) => a.name === "command-open").latency,
              filterOpen: interactions.find((a) => a.name === "filter-open").latency,
              jkStep: quantile(
                interactions.filter((a) => a.name.startsWith("navigate-")).map((a) => a.latency),
                0.5,
              ),
              jsTransferBytes: jsResources.reduce((n, r) => n + r.transferSize, 0),
              scrollFrameP95: quantile(scroll.deltas, 0.95),
            },
          };
          records.push(result);
          console.log(
            `CPU ${cpu}x run ${run}/${runs} ${cache}: board ${load.firstBoard?.toFixed(1)}ms, ${result.metrics.commits} commits, ${events.length} timed interactions`,
          );
        }
      } finally {
        await context.close();
      }
    }
} finally {
  await browser.close();
}
const summary: any = {};
for (const cpu of values.cpu ? [Number(values.cpu)] : [1, 4])
  for (const cache of ["cold", "warm"]) {
    const rows = records.filter((r) => r.cpu === cpu && r.cache === cache),
      metrics: any = {};
    for (const key of Object.keys(rows[0].metrics)) {
      const xs = rows.map((r) => r.metrics[key]).filter((x) => typeof x === "number");
      metrics[key] = { median: quantile(xs, 0.5), p95: quantile(xs, 0.95), n: xs.length };
    }
    summary[`${cpu}x-${cache}`] = metrics;
  }
const output = {
  schemaVersion: 1,
  createdAt: new Date().toISOString(),
  url: base.href,
  runs,
  chromium: browser.version(),
  bun: Bun.version,
  viewport: { width: 1440, height: 900 },
  mirrorProgress: progress,
  boards: boards.map((b: any) => ({ id: b.id, name: b.name })),
  summary,
  records,
};
await Bun.write(values.out!, JSON.stringify(output, null, 2) + "\n");
const fmt = (v: any) => (v === null ? "N/A" : v.toFixed(2));
const keys = Object.keys(Object.values(summary)[0] as any);
let md =
  "# better-jira browser performance baseline\n\nEach cell is median / p95 across runs. Timings are milliseconds; CLS is unitless; commit/fiber metrics are counts.\n\n| Metric | 1x cold | 1x warm | 4x cold | 4x warm |\n|---|---:|---:|---:|---:|\n";
for (const key of keys)
  md += `| ${key} | ${Object.values(summary)
    .map((s: any) => `${fmt(s[key].median)} / ${fmt(s[key].p95)}`)
    .join(" | ")} |\n`;
md += "\nSee perf/README.md for definitions, caveats, and the repeat command.\n";
await Bun.write(values.out!.replace(/\.json$/, "") + ".md", md);
console.log(md);
