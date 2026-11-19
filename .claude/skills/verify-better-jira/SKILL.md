---
name: verify-better-jira
description: Drive better-jira (the Linear clone on Jira) the way a user does and prove a change works, on a write-enabled instance against the personal Jira (cloudsairaj) through the browse MCP, or on the fake Jira through the Playwright e2e harness. Use to reproduce a bug, verify a fix or feature, or capture before/after evidence.
---

# Verify better-jira

Two surfaces. Pick by what the proof needs.

- **Real Jira (primary).** A production build of the app on its own port, writing only to https://cloudsairaj.atlassian.net, driven in the `raj-chrome` browser with the browse MCP. Proves what real Jira does with the app's writes.
- **Fake Jira.** The Playwright suite in `e2e/` against `scripts/fixture-server.ts`. Use it for states real Jira can't make on demand: refused writes, unanswered writes, a change "made in Jira" mid-test, a dropped connection at an exact moment.

Never drive :3000 (work Jira, read-only) and never use :3002 for edits. :3002 is the `bun --hot` dev server, and the app writes to Jira only from a production server (`canWrite` in `src/server/jira.ts`), so every edit there fails.

## Launch

From the repo root:

```sh
.claude/skills/verify-better-jira/verify.sh up        # port 3031; or: verify.sh up <port>
```

It builds the app into `dist/verify` and starts it in a Rex window `verify-<port>` with `NODE_ENV=production`, `JIRA_WRITES=https://cloudsairaj.atlassian.net`, its own cache `dist/verify/cache.db`, and the personal credentials from `.env.personal`. Shell env beats `--env-file`, so the pinned values always win. It is ready when `/api/issues` answers a non-empty list, about 5 s, and `up` then runs `doctor`. The state of the running instance is in `.raj/tmp/verify/instance`.

The browse tab: open your own named tab in `raj-chrome`, allowed onto the instance only.

```js
// mcp__browse__tabs
{ action: "new", id: "verify-better-jira", browser: "raj-chrome", url: "http://localhost:3031/", allowedOrigins: ["http://localhost:3031"] }
```

Teardown: `verify.sh down` and close the tab (see Cleanup).

## Doctor

```sh
.claude/skills/verify-better-jira/verify.sh doctor
```

Read-only. It passes only when the port is held by the pid `up` recorded, `/api/client` reports `site` = cloudsairaj and `writable: true`, and the instance holds issues. It warns when a file under `src/` is newer than the build: a proof of new code then needs `verify.sh down && verify.sh up`. Run it first, and again whenever anything looks off. If it reports another site, stop and run `down`. Never drive that instance.

## Drive

Real Jira, with `mcp__browse__execute` and `tab: "verify-better-jira"`:

- Inspect with `await snapshot({ within: "body", interactive: true })` and act on refs or roles. The handles below are real.
- Board: the first board is `SAM1 board` (`/board/1/all`). Columns are `To Do`, `In Progress`, `In Review`, `Done`. A card is the button `Drag <KEY> <title>`, with `Status on <KEY>`, `Assignee on <KEY>`, `Priority on <KEY>`, `Type on <KEY>`.
- Open an issue by clicking its title text: `page.getByText("<title>", { exact: true }).first().click()`. The URL becomes `?issue=<KEY>`, and the title is the textbox `Issue title`.
- Save state is the status `Jira save status`. It reads `Saved to Jira` when Jira has every write, `Still sending N to Jira: …` while writes wait, and `Not saved to Jira: …` after a refusal.
- Offline: `await browse.emulate({ offline: true })`, and `{ offline: false }` to reconnect. `navigator.onLine` follows it.
- Read back what Jira holds (read-only GET, refuses any site but cloudsairaj):

```sh
.claude/skills/verify-better-jira/verify.sh jira '/rest/api/3/issue/SAM1-9?fields=summary,priority,status,updated'
.claude/skills/verify-better-jira/verify.sh jira '/rest/api/3/issue/SAM1-9/changelog'   # proves a write landed once
```

Fake Jira: `bun run test:e2e` runs everything. `bunx playwright test <file> -g "<name>"` runs one flow, and `--repeat-each 30` runs an intermittent one. Write a new flow in `e2e/*.e2e.ts` with the `test` and `app` from `e2e/app.ts`. `app.seed`, `app.jiraWrites`, `app.jiraIssue` and `app.requests` (with bodies) are the read-back; the doc comments in `e2e/app.ts` list the controls. When ports clash with another run, set `E2E_PORT_BASE` (default 3200).

The feature map in `features/README.md` holds one recipe per feature. Drive every entry point it lists for a feature before calling that feature verified.

## Evidence

```sh
D=$(.claude/skills/verify-better-jira/verify.sh evidence <run-id>)   # .raj/tmp/verify/runs/<run-id>
```

- Capture the action and the resulting state: a screenshot before and after, the save status text, and an ARIA snapshot line of the changed element.
- Capture the side effect from Jira itself: `verify.sh jira` before, during (when it matters, e.g. offline) and after, saved as JSON in `$D`. For "sent once", save the changelog.
- browse writes `page.screenshot({ path: files.path("<name>.png") })` into its own files folder (`files.dir` in the result). Move each file into `$D` right away.
- Exercise the real user path, never internal setters or test-only endpoints. On real Jira, nothing is mocked. On the fake, the fixture stands in only for Jira's REST boundary.
- Report a path you couldn't reach with the command you tried and the missing precondition. Never report it verified through another path.

## Cleanup

1. Put back any Jira data the run changed, through the UI, and confirm with `verify.sh jira`. cloudsairaj is shared by every run.
2. `verify.sh down` closes the Rex window, kills only the pid it recorded, and removes `dist/verify` and its cache. Evidence in `.raj/tmp/verify/runs/` stays. Delete it once the work it proves is merged.
3. Close the tab: `mcp__browse__tabs { action: "close", tab: "verify-better-jira" }`.

## Gotchas

- One instance per checkout: `up` refuses while `.raj/tmp/verify/instance` exists. In a worktree, `.env.personal` is missing. Link it from the main checkout without reading it: `ln -s /Users/sairaj.chouhan/cs/better-jira/.env.personal .env.personal`.
- Rex session: `verify.sh` opens its window in the user's session `session:01a1e801-…`. Set `REX_SESSION` when that session is gone (`rex session list`).
- Two runs editing the same cloudsairaj issue at once clobber each other. Pick distinct issues.
- Never add or remove a board on the verify instance. Board choices are saved to `.better-jira.local.json`, which the :3000 prod app also reads.
- The `raj-chrome` browser must be connected (`browse status` lists it). If it isn't, ask the user to open that Chrome profile. Don't fall back to `work-chrome`.
