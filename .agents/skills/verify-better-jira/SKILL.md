---
name: verify-better-jira
description: Drive better-jira the way a user does and prove a change works, on a write-enabled instance against a personal sandbox Jira through the browse MCP, or on the fake Jira through the Playwright e2e harness. Use to reproduce a bug, verify a fix or feature, or capture before/after evidence.
---

# Verify better-jira

Two surfaces. Pick by what the proof needs.

- **Real Jira (primary).** A production build of the app writing only to your personal sandbox Jira instance (`instances/personal/`), driven in a dedicated browser profile with the browse MCP. Proves what real Jira does with the app's writes.
- **Fake Jira.** The Playwright suite in `e2e/` against `scripts/fixture-server.ts`. Use it for states real Jira can't make on demand: refused writes, unanswered writes, a change "made in Jira" mid-test, a dropped connection at an exact moment.

Never drive `:3000` (reserved for a read-only work Jira copy).

## Launch

**Main checkout:** drive `:3002` directly (`bun start personal`, on `instances/personal/`). It runs the code it was built from: after a change, the main session restarts it, and nothing reloads on its own. `up` and `down` refuse here.

**Worktree:** start a throwaway build of the worktree's code, from its root:

```sh
.agents/skills/verify-better-jira/verify.sh up        # port 3031; or: verify.sh up <port>
```

It runs `bun scripts/personal-jira.ts serve <port> dist/verify-cache.db dist/personal` in a Rex window `verify-<port>` using `instances/personal/` (or `REAL_JIRA_HOME`). Shell env beats the instance's credentials file, so the pinned values always win. It is ready when `/api/issues` answers a non-empty list, and `up` then runs `doctor`. The state of the running instance is in `.raj/tmp/verify/instance`.

Open your own named browser tab allowed onto the instance only (`3002`, or the worktree's port), and close it when finished.

Teardown: close the tab, and in a worktree run `verify.sh down` (see Cleanup).

## Doctor

```sh
.agents/skills/verify-better-jira/verify.sh doctor
```

Read-only. In the main checkout it checks `:3002`; in a worktree, the instance `up` started, held by the pid it recorded. It passes only when `/api/client` reports the expected sandbox `site` and `writable: true`, and the instance holds issues. It warns when a file under `src/` is newer than `dist/personal/index.js`. Run it first, and again whenever anything looks off. If it reports another site, stop and never drive that instance.

## Drive

- Inspect with `await snapshot({ within: "body", interactive: true })` and act on refs or roles.
- Open an issue by clicking its title text: `page.getByText("<title>", { exact: true }).first().click()`.
- Save state is the status `Jira save status`: `Saved to Jira`, `Still sending N to Jira: …`, or `Not saved to Jira: …`.
- Offline: `await browse.emulate({ offline: true })`, and `{ offline: false }` to reconnect.
- Read back what Jira holds (read-only GET against your sandbox Jira):

```sh
.agents/skills/verify-better-jira/verify.sh jira '/rest/api/3/issue/SAM1-9?fields=summary,priority,status,updated'
.agents/skills/verify-better-jira/verify.sh jira '/rest/api/3/issue/SAM1-9/changelog'
```

Fake Jira: `bun run test:e2e` runs everything. `bunx playwright test <file> -g "<name>"` runs one flow, and `--repeat-each 30` runs an intermittent one. Write a new flow in `e2e/*.e2e.ts` with `test` and `app` from `e2e/app.ts`.

`bun run test:real` (`e2e-real/`) runs real-Jira journeys on a dedicated build at `:3052`, reads each result back from Jira, and puts issues back after every test.

The feature map in `features/README.md` holds one recipe per feature.

## Evidence

```sh
D=$(.agents/skills/verify-better-jira/verify.sh evidence <run-id>)   # .raj/tmp/verify/runs/<run-id>
```

- Capture the action and resulting state: screenshot before/after, save status text, ARIA snapshot, and `verify.sh jira` JSON before/after.
- Exercise the real user path, never internal setters or test-only endpoints.

## Cleanup

1. Put back any Jira data the run changed, through the UI, and confirm with `verify.sh jira`.
2. In a worktree, `verify.sh down` kills only the pid it recorded, closes the Rex window, and removes `dist/personal` and `dist/verify-cache.db`.
3. Close your browser tab.

## Gotchas

- One throwaway per worktree: `up` refuses while `.raj/tmp/verify/instance` exists.
- Set `REX_SESSION` (from `rex session list`) when launching worktree instances in Rex.
- Two runs editing the same sandbox issue at once clobber each other; pick distinct issues.
- Never add or remove a board on a worktree's throwaway if it shares `instances/personal/settings.json` with `:3002`.
