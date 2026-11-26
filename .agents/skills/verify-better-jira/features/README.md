# better-jira verification map

This directory is the maintained source for verifying what a better-jira user can do. Read this index, then use the matching feature file as the recipe. The e2e specs in `e2e/` cover the same areas on the fake Jira. This map covers the real one.

## Baseline preconditions

- `verify.sh doctor` passes: the instance is ours, on the personal sandbox Jira, writable (`settings.json` has `"writes": true`, or `JIRA_WRITES=<sandbox-origin>` is set), and holds issues.
- The `verify-better-jira` tab is open in your personal browser profile on the instance URL.
- The sandbox Jira holds board 1 (`SAM1 board`) with SAM1-1 … SAM1-10, and `KAN board` with KAN-1, KAN-2, KAN-3, KAN-15, KAN-16. SAM1-6, SAM1-8 and SAM1-9 are plain To Do tasks, safe to edit and put back (SAM1-6 and SAM1-8 have priorities; SAM1-9 has none, so avoid setting a priority on SAM1-9).

## Driving conventions

- Prefer roles and accessible names (`Issue title`, `Jira save status`, column `grid` + card `row` named `<KEY> <title>`) over CSS or position.
- A change counts as saved when `Jira save status` reads `Saved to Jira` and `verify.sh jira` shows the new value.
- Put back every value you changed, through the UI, and confirm it with `verify.sh jira`.

## Proof and skip reporting

- Save to `$(verify.sh evidence <run-id>)`: Jira JSON before and after, screenshots before and after, the status text, and the feature ID and entry point used.
- A write that must land once is proven by the issue's changelog, not by the current value alone.
- Report an unreachable entry point with what you tried and the missing precondition.

## Features

- [Offline edits](./offline-edits.md): edits made offline wait, then reach Jira once on reconnect. Proven end to end.
- [Issue edits](./issue-edits.md): title and properties from the issue view and from board cards.
- [Board moves](./board-moves.md): dragging a card to another column transitions it in Jira.
- [Comments](./comments.md): add, edit, reply to and delete comments.
