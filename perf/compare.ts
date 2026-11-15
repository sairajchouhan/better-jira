import { Glob } from "bun";
const dir = "/Users/sairaj.chouhan/cs/better-jira/.raj/qa/perf";
const inputs: any[] = [];
for await (const file of new Glob("compiler-?-?x-block?.json").scan({ cwd: dir, absolute: true })) {
  const match = file.match(/compiler-([AB])-(\d)x-block(\d)/)!;
  inputs.push({
    variant: match[1],
    cpu: Number(match[2]),
    block: Number(match[3]),
    file,
    serverLog: await Bun.file(file.replace(".json", "-server.log")).text(),
    data: await Bun.file(file).json(),
  });
}
inputs.sort((a, b) => a.cpu - b.cpu || a.block - b.block || a.variant.localeCompare(b.variant));
const q = (x: number[], p: number) =>
  x.length ? [...x].sort((a, b) => a - b)[Math.max(0, Math.ceil(p * x.length) - 1)]! : null;
const stat = (x: number[]) => ({
  n: x.length,
  median: q(x, 0.5),
  p95: q(x, 0.95),
  q1: q(x, 0.25),
  q3: q(x, 0.75),
});
const fmt = (x: number | null) => (x === null ? "N/A" : x.toFixed(2));
const pct = (a: number | null, b: number | null) =>
  a === null || b === null || a === 0
    ? a === b
      ? "0.0%"
      : "N/A"
    : `${(((b - a) / a) * 100).toFixed(1)}%`;
const keys = [
  "lcp",
  "fcp",
  "ttfb",
  "cls",
  "tbt",
  "inpProxyP98",
  "boardSwitch",
  "issueOpen",
  "commandOpen",
  "filterOpen",
  "jkStep",
  "scrollFrameP95",
  "jsTransferBytes",
];
const rows: any[] = [];
const checks: any[] = [];
for (const cpu of [1, 4])
  for (const cache of ["cold", "warm"]) {
    const select = (variant: string) =>
      inputs
        .filter((i) => i.cpu === cpu && i.variant === variant)
        .flatMap((i) =>
          i.data.records
            .filter((r: any) => r.cache === cache)
            .map((r: any) => ({ ...r, block: i.block })),
        );
    const A = select("A"),
      B = select("B");
    if (A.length !== 10 || B.length !== 10)
      throw Error(`Incomplete ${cpu} ${cache}: ${A.length}/${B.length}`);
    for (const r of [...A, ...B]) {
      if (r.blocked.length || r.errors.length || r.mirrorAfter.errors || r.distinctNavigation < 21)
        throw Error("Validation failed");
      if (!r.footer.join(" ").includes("Local only")) throw Error("Footer write guard missing");
      for (const layout of r.scroll.layouts)
        if (!layout.containers || layout.positions.some((p: any) => Math.abs(p.top - p.max) > 2))
          throw Error("Scroll did not reach end");
    }
    const value = (r: any, key: string) => {
      if (!key.includes(":")) return r.metrics[key];
      const [action, metric] = key.split(":") as [string, string];
      const xs = r.interactions
        .filter((a: any) => (action === "jk" ? a.name.startsWith("navigate-") : a.name === action))
        .map((a: any) => a[metric]);
      return xs.reduce((n: number, v: number) => n + v, 0) / xs.length;
    };
    const fullKeys = [
      ...keys,
      ...[
        "issue-open",
        "issue-close",
        "board-switch",
        "command-open",
        "command-type",
        "command-close",
        "filter-open",
        "filter-close",
        "jk",
        "layout-board",
        "layout-list",
        "scroll-board",
        "scroll-list",
      ].flatMap((a) => ["commits", "fibers"].map((m) => `${a}:${m}`)),
    ];
    for (const key of fullKeys) {
      const a = stat(
          A.map((r) => value(r, key)).filter((v) => typeof v === "number" && Number.isFinite(v)),
        ),
        b = stat(
          B.map((r) => value(r, key)).filter((v) => typeof v === "number" && Number.isFinite(v)),
        );
      const separated = a.n && b.n && (a.q3! < b.q1! || b.q3! < a.q1!);
      rows.push({
        cpu,
        cache,
        metric: key,
        A: a,
        B: b,
        deltaMedian: pct(a.median, b.median),
        deltaP95: pct(a.p95, b.p95),
        noise: !a.n || !b.n ? "Unavailable" : separated ? "Separated IQRs" : "Overlapping IQRs",
      });
    }
    checks.push({
      cpu,
      cache,
      nA: A.length,
      nB: B.length,
      postSessionPending: [
        ...A.map((r) => ({
          variant: "A",
          block: r.block,
          run: r.run,
          pending: r.mirrorAfter.pending,
        })),
        ...B.map((r) => ({
          variant: "B",
          block: r.block,
          run: r.run,
          pending: r.mirrorAfter.pending,
        })),
      ].filter((r) => r.pending > 0),
      totalIssues: [...new Set([...A, ...B].map((r) => r.mirrorAfter.total))],
      distinctIssues: [
        Math.min(...[...A, ...B].map((r) => r.distinctNavigation)),
        Math.max(...[...A, ...B].map((r) => r.distinctNavigation)),
      ],
    });
  }
let md = "# React Compiler A/B: company Jira\n\n";
md +=
  "Same app commit `c7989671df55dd611385d8a9f169b034cc733da5`, built A without the compiler and B with the compiler. 80 measured sessions: ten cold and ten warm per variant at 1x and 4x CPU. Five alternating blocks of two runs per variant at each CPU; each run measures cold then warm.\n\n";
md += "VERDICT_PLACEHOLDER\n\n";
md +=
  "All timings are ms; transfer is bytes; CLS is unitless. Each A/B cell is run-level median / p95 (nearest rank). Δ is (B−A)/A: negative favors B. Zero baseline with nonzero B gives N/A. “Separated IQRs” means the central halves do not overlap; it is a descriptive noise screen, not a significance test or causal guarantee.\n\n";
for (const cpu of [1, 4])
  for (const cache of ["cold", "warm"]) {
    md += `## ${cpu}x CPU, ${cache}\n\n| Metric | A median / p95 | B median / p95 | Δ median | Δ p95 | Noise screen |\n|---|---:|---:|---:|---:|---|\n`;
    for (const r of rows.filter((r) => r.cpu === cpu && r.cache === cache))
      md += `| ${r.metric} | ${fmt(r.A.median)} / ${fmt(r.A.p95)} | ${fmt(r.B.median)} / ${fmt(r.B.p95)} | ${r.deltaMedian} | ${r.deltaP95} | ${r.noise} |\n`;
    md += "\n";
  }
const syncLines = inputs.flatMap((i) =>
  i.serverLog
    .split("\n")
    .filter((l: string) => l.includes("[sync]"))
    .map((line: string) => ({ variant: i.variant, cpu: i.cpu, block: i.block, line })),
);
md += "## Method, guards and noise\n\n";
md +=
  "- Both variants ran alone from the same checkout root and cache DB. The ignored env file is a symlink to the company env; it was never printed. Ignored local settings supplied the site and boards. A consistent SQLite backup of the existing company mirror seeded the checkout cache; startup sync then settled before measurement. Build B completed before measurement. Server startup and bundle compilation are excluded.\n";
md +=
  "- Two attempted blocks were discarded in full: A/4x/block4 fourth session visited only 18 distinct issues, and B/4x/block5 second session visited 20 (harness minimum 21). No partial blocks were saved. Both complete blocks were retried unchanged. These are scenario-validity retries, not selection on timing; each variant had one failure. The run log preserves both failures. This also limits claims about fast-key navigation reliability under throttling.\n";
md +=
  "- Every server boot verified `/api/client` for the company site with `writable: false`. Every session asserted the “Local only” footer. `JIRA_WRITES` was `off`. The server gate rejects mutations; the scenario made no edits, creates, deletes, comments or status changes. Playwright aborted any page non-GET request to `*.atlassian.net`; no such attempt occurred. The harness fails on any other page non-read request. Server-side documented POST bulk changelog fetches are reads.\n";
md +=
  "- Playwright routing disables browser HTTP cache. Cold means a fresh browser context; warm retains localStorage/IndexedDB but still has HTTP cache disabled. This differs from the old personal baseline, so its numbers are not used in the comparison. Server/OS remain warm; no network throttling. Viewport 1440×900, headless Chromium, CPU throttling via CDP.\n";
md +=
  "- Scenario: j 25 times then k 25 times (at least 21 distinct selected issue keys asserted), Enter/Escape issue detail, switch to second board, Meta+K open/type “Switch”/close, F filter open/close, toggle to each board/list layout and scroll actual overflowing containers to their ends over 90 animation frames. Board order stays fixed. Scroll frame p95 pools board and list rAF deltas within each session, then compares run-level p95s.\n";
md +=
  "- React commits/fibers are counted per action interval; jk values average the 50 steps within each session before cross-run summaries. The injected production DevTools hook walks fibers and estimates rendered work using PerformedWork flags with identity filtering. It adds identical instrumentation to both builds, is not an exact render count, and may miss aborted work. Layout-board actions can be absent if already on board; N/A records that absence.\n";
md +=
  "- Interaction latency includes Playwright actionability/transport and two animation frames. Event Timing INP-proxy p98 is threshold-censored at 16ms and is synthetic, not field INP. TBT runs from FCP to initial-board readiness; CLS covers the scenario. Live Jira detail/avatar requests, SSE, polling, host scheduling, JIT and thermal drift remain noise sources. Interleaving reduces drift but does not eliminate it. Ten runs give a coarse p95 (the maximum); IQR overlap does not prove equivalence. Many metrics are examined without inferential multiple-comparison claims.\n";
md +=
  "- JS transfer uses Resource Timing `transferSize` for scripts (including protocol overhead); encoded sizes and asset names remain in JSON. Load LCP/FCP are captured before first scripted input. Full observer and interaction records are embedded in the adjacent JSON. No app source was edited or committed.\n\n";
md += `Live sync log entries (external data drift, not scenario writes): ${JSON.stringify(syncLines)}.\n\n`;
md += `Validation: ${JSON.stringify(checks)}. Apple M1 Pro, macOS 27.2.1. Chromium ${inputs[0].data.chromium}; Bun ${inputs[0].data.bun}. Every block began after ten seconds of stable properties and zero pending enrichment. Three sessions ended with newly pending enrichment (A/1x/block4 cold run1: 1; B/1x/block4 cold run1: 1; B/4x/block3 cold run1: 2), consistent with live sync during the scenario; these are retained and flagged as noise. All sessions had zero enrichment errors, no page errors, no blocked write attempts, and confirmed end scroll positions.\n\n`;
md +=
  '## Exact commands\n\nSetup and build, from the app checkout root (env contents never displayed):\n\n```sh\nln -s /Users/sairaj.chouhan/cs/better-jira/.env .env\ncp /Users/sairaj.chouhan/cs/better-jira/.better-jira.local.json .better-jira.local.json\nsqlite3 -readonly /Users/sairaj.chouhan/cs/better-jira/cache.db ".backup cache.db"\nbun run build:server\n```\n\nInterleaved commands (each server stopped before the next):\n\n```sh\n' +
  (await Bun.file(`${dir}/compiler-commands.json`).json()).join("\n") +
  "\n```\n";
await Bun.write(
  `${dir}/compiler-vs-baseline.json`,
  JSON.stringify(
    {
      createdAt: new Date().toISOString(),
      checks,
      syncLines,
      runLog: await Bun.file(`${dir}/compiler-run.log`).text(),
      comparison: rows,
      inputs,
    },
    null,
    2,
  ),
);
await Bun.write(`${dir}/compiler-vs-baseline.md`, md);
console.log(
  JSON.stringify(
    rows.filter((r) => keys.includes(r.metric)),
    null,
    2,
  ),
);
const chartRows = rows.filter((r) => keys.includes(r.metric));
const html = `<!doctype html><html><head><meta charset="utf-8"><style>
:root{font-family:var(--font-sans)} body{margin:0} select{background:var(--secondary);color:var(--foreground);border:1px solid var(--border);padding:6px;border-radius:var(--radius);margin-right:8px} .legend{font-size:12px;color:var(--muted-foreground);margin:12px 0} svg{width:100%;height:330px} text{fill:var(--foreground);font-family:var(--font-sans);font-size:12px} .a{fill:var(--chart-2)} .b{fill:var(--chart-1)}
</style></head><body><label>Metric <select id="metric">${keys.map((k) => `<option>${k}</option>`).join("")}</select></label><label>Statistic <select id="stat"><option value="median">Median</option><option value="p95">p95</option></select></label><div class="legend">A: no compiler · B: compiler. Lower is better. Warm retains local persistence; HTTP cache disabled in both.</div><svg id="plot" viewBox="0 0 700 330" role="img" aria-label="A and B performance comparison"></svg><script>
const data=${JSON.stringify(chartRows)}; const metric=document.getElementById('metric'), stat=document.getElementById('stat'),plot=document.getElementById('plot');
function draw(){const rs=data.filter(r=>r.metric===metric.value), s=stat.value,max=Math.max(...rs.flatMap(r=>[r.A[s]||0,r.B[s]||0]),1);let svg='';rs.forEach((r,i)=>{const y=i*80;svg+='<text x="0" y="'+(y+16)+'">'+r.cpu+'x '+r.cache+'</text>';for(const [j,v] of ['A','B'].entries()){const x=r[v][s]||0;svg+='<text x="90" y="'+(y+j*26+18)+'">'+v+'</text><rect class="'+v.toLowerCase()+'" x="110" y="'+(y+j*26+4)+'" width="'+(x/max*430)+'" height="20" rx="3"/><text x="'+(120+x/max*430)+'" y="'+(y+j*26+18)+'">'+x.toFixed(1)+'</text>';}});plot.innerHTML=svg;}metric.onchange=draw;stat.onchange=draw;draw();
</script></body></html>`;
await Bun.write(`${dir}/compiler-vs-baseline.html`, html);
