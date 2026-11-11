# Browser performance harness

From a checkout with dependencies installed (`bun install --frozen-lockfile`):

```sh
bun perf/vitals.ts --url http://localhost:3050 --runs 10 --out /absolute/path/results.json
```

The harness accepts any reachable better-jira URL, rejects the company Jira site, and requires two boards with visible issues. It launches headless Playwright Chromium, fixes the viewport at 1440×900, and runs CPU rates 1 and 4 via CDP. No dependencies are added. The server must already be running. It does not start or stop a server; it closes its browser and all contexts even if an assertion fails.

For the personal baseline, symlink the personal environment into the checkout and launch the server with `NODE_ENV=production PORT=3050 bun --env-file=.env.personal src/index.ts`. Do not use the project's start script. Verify the environment is personal before launching. Stop that server after the harness finishes.

## Scenario and repeatability

Before launching Chromium, require nonempty HTML and poll mirror properties until all enrichment is complete and the full response is unchanged for ten seconds (ten minute timeout). Polling does not suspend background Jira sync. Keep other clients and user activity away from the measured server. The baseline uses the first board returned by the server and switches to the second, preserving board order and query parameters across builds. Compare the recorded board IDs, issue counts, mirror errors and browser version before comparing results.

Each of ten iterations at each CPU rate uses a fresh context (no browser HTTP cache, localStorage or IndexedDB), then a warm reload in that context. A fresh context is browser-cold; the process, OS and server mirror remain warm. Before the measured warm reload, navigate back to the initial board, allowing HTTP cache and local app persistence to remain populated. CPU 1x runs precede CPU 4x runs; cold precedes warm. No network throttling, request interception, response mocking, or blocking is applied. Unexpected non-read browser requests fail the run. The actions intentionally perform no Jira mutations.

After load, focus the first issue, press j ten times and k ten times, Enter to open, Escape to close, click the second board, Meta+K to open commands, fill “Switch” without selecting a command, Escape, F to open filters, Escape, then scroll all overflowing board/list vertical containers over 60 animation frames to their bottom. Opening, closing and switching have DOM/URL assertions. With fewer than 20 issues, navigation can wrap or reach a boundary; raw interaction records include the selected key. Typing uses Playwright fill and is one scripted interaction. Meta+K assumes the macOS host used for this baseline.

## Metrics

JSON preserves raw observer entries, commit samples, scroll frames, per-action timestamps, selected issues, app footer text, runtime versions, and mirror progress. The adjacent Markdown contains nearest-rank median and p95 over ten run-level values in each CPU/cache group. Do not interpret a p95 of run-level p95 values as a pooled percentile.

- LCP and FCP: buffered PerformanceObserver entries before the first scripted input, after a 250 ms settling period. LCP may occur after first-board readiness. TTFB: navigation responseStart minus startTime (includes navigation setup and redirects).
- First board: navigation time origin to two animation frames after the first issue DOM appears. This is a browser-observed readiness proxy, not an application-internal mark. There is no explicit first-board-ready performance mark in the app. This cutoff approximates board interactivity; it does not claim the standardized TTI metric.
- TBT: sum of long-task excess over 50 ms for tasks starting between FCP and the board-ready cutoff, clipped at that cutoff. Tasks after readiness are retained in raw JSON, but excluded from TBT.
- CLS: maximum layout-shift session window (1 s gap, 5 s maximum), excluding shifts with recent input, through the entire scripted session.
- Event Timing p50/p95/max and INP proxy p98: group event entries by nonzero interactionId and take the maximum duration per interaction. Only entries reported at durationThreshold 16 ms are available; subthreshold events are censored, not zero. Entries are rounded by Chromium. This is a synthetic, short-session, threshold-censored INP proxy, not field INP. Sparse samples and absent entries are recorded explicitly (N/A when none).
- Interaction latency: automation action start through an asserted UI state and two requestAnimationFrames. Includes Playwright transport/actionability and frame alignment; it is separate from Event Timing and excludes the 60 ms observer-delivery wait. Per-action commits/fibers use this same interval. Background work inside that interval can be counted.
- React hook: injected before React initialization. Counts every onCommitFiberRoot callback and traverses the committed fiber tree, counting PerformedWork flag (bit 1) on fibers not reused by identity from the preceding committed tree. Identity filtering avoids counting stale flags in reused bailout subtrees. This is a React 19 internal-flag render-work estimate, not render duration, CPU time, or an exact component invocation count. Aborted concurrent renders and effect-only work are unavailable in this production build. The tree walk itself adds overhead proportional to tree size; use the identical harness for both builds. Raw commit samples also include visited-fiber counts. Interaction and whole-document totals are both reported.
- Board switch, issue open, command open: the matching scripted action latency. `appBoardSwitch` separately reads the app's existing “switch board · …ms” footer, whose implementation ends at rAF + setTimeout. Enter and keyboard command opening do not invoke the app's `timed` helper, so their exact internal timings cannot be recovered without source changes. The harness uses the same visible behavior boundary for those actions.
- Scroll frame p95: rAF deltas during actual programmatic scrolling. N/A if nothing overflows, with a reason in JSON. No artificial rows, smaller viewport or data mutations are used to force scrolling.

## Noise and limitations

The baseline personal mirror has 15 issues (10 on board 1, 5 on board 2), all enriched without errors. Both boards fit vertically at 1440×900, so scroll metrics are unavailable. This small fixture limits the render work and cannot exercise navigation through 20 distinct issues. Live Jira requests, avatars, issue detail fetches, server-sent events and periodic mirror polls remain enabled. Idle initial sync and stable data control the largest first-boot disturbance, but do not remove network latency or all ongoing polling. Per-document page errors and end-of-scenario mirror progress are retained. Server logs should be inspected for sync changes during the run. The first full sync and production bundle compilation were completed during setup/smoke testing, before baseline collection. Browser launch and server startup are excluded.

Only `perf/` belongs in the harness commit. Store measured reports outside version control. Run the same command and output prefix against the compiler build after its mirror is settled. Compare equal browser versions, viewport, data, CPU pass, cache category, run count and harness revision.
