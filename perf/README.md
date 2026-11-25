# Browser performance harness

Run with Bun from this checkout, with dependencies already installed:

```sh
bun perf/vitals.ts --url http://localhost:3061 --cpu 1 --runs 2 --out /absolute/report.json
```

Omit `--cpu` to run both 1x and 4x. Each iteration uses a fresh Chromium context for cold, then returns to the first board and reloads with local persistence retained for warm. Both have HTTP cache disabled by Playwright routing. The harness requires `/api/client` to report `writable: false`, blocks all page non-GET requests to `*.atlassian.net`, fails on other page non-read requests, and blocks service workers. It never sends Jira mutations. It polls mirror properties for zero pending enrichment and ten seconds of unchanged data before launching Chromium. Two boards and at least 21 distinct navigable issues are required. No app source instrumentation or mocking is used.

## Scenario

1440×900 viewport. CPU throttling via CDP. Focus the first issue; j 25 times, k 25 times; assert at least 21 distinct issue keys. Enter/Escape opens/closes detail. Switch to the second board, Meta+K open/type “Switch”/close, F filter open/close. Toggle board and list layouts locally with Meta+B; scroll every overflowing container in the visible layout to its end over 90 rAF frames each. Fail if no overflowing container exists. No edits, creates, deletes, comments or status changes.

## Metrics

- LCP/FCP before first input; TTFB from navigation timing. Initial board readiness is first issue DOM plus two animation frames. TBT sums long-task excess over 50ms from FCP to that readiness cutoff. CLS uses session windows over the scenario.
- Event Timing entries have durationThreshold 16ms; group by interactionId using maximum duration. INP-proxy p98 is censored synthetic data, not field INP.
- Every action records latency from automation start through a DOM/URL assertion and two animation frames, plus React commits and rendered-fiber estimate within that interval. A 60ms observer-delivery wait is excluded. Playwright overhead and frame alignment remain included.
- The injected DevTools hook counts commits and traverses the committed fiber tree. Rendered-fiber estimate counts PerformedWork flags on fibers not reused by identity from the previous tree. This React internal-flag estimate adds traversal overhead, is not CPU duration or an exact invocation count, and excludes aborted work.
- Scroll frame p95 uses actual scroll rAF deltas pooled across board/list within a session. Script `transferSize` comes from Resource Timing, with encoded size retained alongside it. HTTP caching is disabled in both cache groups by the required route guard.
- Raw observer entries, interactions, selected issue keys, errors, footer text, blocked requests, scroll positions, resource sizes, mirror progress and runtime versions are saved. Markdown gives nearest-rank median/p95 over run-level values. A p95 of p95s is not a pooled percentile.

## Company A/B driver

