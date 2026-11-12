# Round 2 Package F

## BJ-110 — done

Removed the editor's unconditional idle preload. The existing editor seam now retains the read-only ADF content (including media context) until ProseMirror arrives. Chrono was already reached only through dynamic imports from the due-date and reminder menus; that split is retained. No dependency added.

Measured with `E2E_PORT_BASE=5200 bun perf/large-board.ts`, using the production React Compiler fixture build, Chromium, 1440×900, three fresh contexts and 2,000 bulk issues plus six standard issues. Initial gzip sums the actual script responses through one second after board readiness, including idle preloads, compressed with Bun.gzipSync. It is a reproducible payload measure, not wire transfer bytes. Scripts are not fetched from Jira.

| Initial JS gzip | Before | After BJ-110 |
|---|---:|---:|
| Every run | 466,727 bytes | 370,258 bytes |

Reduction: 96,469 bytes (20.7%). The static import graph was already split; the saving is the editor chunk no longer fetched during idle startup. Tests retain document content during suspension and exercise first-use loading. `bun check`, `bun test` (434 passed), and lint (exit 0) passed before committing.
