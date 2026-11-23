---
name: verify-sync-and-inbox
description: Formally verify changes to better-jira's sync protocol (stale full-record reads, multi-tab takeover, lost-answer uploads, draft-upload cleaner) and inbox read/unread marks (offline/NoAnswer retry, reload recovery, delete undo) using TLA+ and TLC. Use whenever editing outbox, local-edits, local-data, jira-sync, server-data, draft-uploads, jira-media, jira-writes uploads, inbox-store, or inbox.ts.
---

# Verify sync protocol and inbox marks

This skill checks two TLA+ models in `specs/` with TLC (`tla2tools.jar` v1.7.4) so concurrent interleavings, retries, reloads, and undo races cannot regress past fixes.

## Covered files and functions

Last confirmed in sync with code at commit `f7f03942` (base of PR 3). Before moving this commit forward, confirm every guarded action in both `.tla` files still matches the real implementation below.

- `specs/sync_protocol.tla` + `specs/sync_protocol.cfg` + `specs/sync_protocol.view.mjs`
  - `src/client/state/server-data.ts`: `fetchFull`, `preloadFull` (`writesAnswered(key) !== since` stale-read retry guard; commit `a0a7477c`)
  - `src/client/state/local-edits.ts`: `answeredWrites`, `writesAnswered`, `adoptJira`, `mergeFull`
  - `src/client/state/local-data.ts`: `LocalDatabase.stored`, `LocalDatabase.save`, `LocalDatabase.merged`, `mergeChanges` (3-way takeover merge; commit `ab2de404`)
  - `src/client/state/jira-sync.ts`: `takeOverClosed`, `writes.claimClosed`
  - `src/client/state/jira-media.ts` and `src/client/state/outbox.ts`: `postAttachment`, `prepareOps`, `NoAnswer` retry handling (commit `83c69811`)
  - `src/server/jira-writes.ts`: `uploadAttachment` + `writeLedger` idempotent replay and `found` flag
  - `src/client/features/issue/draft-uploads.ts`: `trackDraftUpload`, `cleanDraftUploads` (skip held and `found` files; commits `88f44ba6`, `9bb41d31`)
- `specs/inbox_marks.tla` + `specs/inbox_marks.cfg` + `specs/inbox_marks.view.mjs`
  - `src/client/state/inbox-store.ts`: `markRead`, `reach`, `restoreLocal`, `tidyLocal`, `resumeWrites`, `editPending` (commits `8a43e557`, `fbe2c7ea`, `6e330b6b`)
  - `src/client/features/inbox/inbox.ts`: `send`, `leaving` on `pagehide`
  - `src/server/notifications.ts`: `mark`, `NoAnswer`

## Properties verified

- `NoStaleReadRegression`: A slow `fetchFull` started before a write answered never overwrites the shown issue with Jira's older copy (harm: user's saved image or edit vanishes on load).
- `TakeoverKeepsConcurrentEdit`: Claiming closed-tab storage never overwrites a newer edit made in the active tab while `db.stored()` was in flight (harm: typed document text silently lost after reload).
- `LostAnswerNeverRefusedOrDuplicated`: A file upload Jira accepted before the answer was lost is never rolled back as refused and never creates two Jira attachments on retry (harm: duplicate files or lost image).
- `CleanerNeverDeletesHeldFile`: `cleanDraftUploads` never deletes a file still referenced by a draft, document, unsent change, or matched by `found` (harm: user's live image deleted from Jira).
- `NoStrandedReadMark`: Once no inbox write is in flight or pending, no local read override remains (harm: unread badge and row state stay permanently wrong).
- `PendingMarkMatchesLocal`: While an inbox mark is pending across offline or reload, the shown local state matches the pending target (harm: mark flickers back to unread).
- `NoAnswerNeverDropsMark`: A `503 NoAnswer` from Jira's notification gateway never drops or rolls back an unconfirmed mark (harm: offline read/unread action silently lost).

## Scope and bounds

- Single issue, single upload client id, single inbox notification group, versions bounded to `0..2`, one closed tab and one active tab.
- Proves ordering and interleaving properties inside the modeled transitions, not prose parsing, UI layout, or multi-issue cross-links.

## How to run

1. Check whether your change touches any file in **Covered files and functions**:
   `git diff --name-only f7f03942..HEAD`
2. Run both models and verify all six historical bug replays still fail TLC:
   `bun run verify:models --prove-bugs`
3. Read every result (and inspect any counterexample path or state graph) with the `/statechart` skill, passing the matching `specs/*.tla`, `specs/*.cfg`, and `specs/*.view.mjs`.

## Telling a real bug from a model drift

- If an invariant fails, replay the `/statechart` shortest counterexample step by step against the real TypeScript code (or a Playwright e2e test).
- If the real code exhibits the failure, fix the code and never weaken the invariant.
- If you intentionally changed the protocol, update the matching `.tla` action and `.view.mjs` label, confirm the invariants still hold and every `BUG_*` variant still fails `--prove-bugs`, and only then update the sync commit above.
