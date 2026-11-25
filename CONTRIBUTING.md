# Contributing to better-jira

Thanks for your interest in contributing!

## Quick Dev Setup (No Jira Account Needed)

You can develop and test almost everything against the built-in disposable fake Jira server:

```sh
bun install
bun scripts/fixture-server.ts
```

Open http://localhost:3000 to drive the full app with synthetic fixture issues and zero external network calls.

## Developing Against a Real Jira Sandbox

1. Create a free personal Jira Cloud site (never test writes against a production/work Jira site).
2. Run:
   ```sh
   bun run setup sandbox
   bun run dev sandbox   # hot reload; always read-only (never writes to Jira)
   ```
3. To test production builds with writes enabled against your sandbox:
   ```sh
   bun start sandbox
   ```

## Checks Before Opening a PR

```sh
bun run typecheck
bun run lint
bun test
bun run build
```

Playwright end-to-end suite (against the disposable fixture server):

```sh
bunx playwright install chromium
bun run test:e2e -- --grep-invert "speed:"
```

Formal sync & inbox protocol verification (requires Java 21+ and `tla2tools.jar`):

```sh
bun run verify:models --prove-bugs
```

## Guidelines

- Keep Jira sync, outbox, and inbox reliability invariants intact (run `bun run verify:models --prove-bugs` if touching sync/outbox/inbox state).
- Never commit `.env`, `credentials.env`, `instances/`, or real company/user data. Fixtures must use synthetic keys, names, and text.
- Keep PRs focused and include unit or Playwright E2E tests for behavioral changes.
