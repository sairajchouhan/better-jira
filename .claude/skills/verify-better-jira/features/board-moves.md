# Board moves

A user drags a card to another column. The card stays there, Jira transitions the issue to that status, and a reload shows the same board.

## Sub-features

- `move-drag`: drag a card onto another column.
- `move-persist`: the move survives a reload and shows in Jira.

## How to get to it (user POV)

- Drag the card by its `Drag <KEY> <title>` handle onto a card or the empty space in another column.

## Driving it with browse (real Jira)

Preconditions:

- `verify.sh doctor` passes, and the tab is on `/board/1/all`.
- SAM1-6 `Set Up Notifications for Users` is in `To Do`.

- **Record Jira.** `verify.sh jira '/rest/api/3/issue/SAM1-6?fields=status' > $D/jira-before.json`.
- **Drag.** `await page.getByRole("button", { name: "Drag SAM1-6 Set Up Notifications for Users" }).dragTo(page.getByRole("button", { name: "Drag SAM1-7 Create Wallet Integration" }))`. The card shows under `In Progress`, and the `To Do` heading count drops by one.
- **Read back.** `verify.sh jira '/rest/api/3/issue/SAM1-6?fields=status'` reads `In Progress`. Reload, and the card is still in `In Progress`.
- **Put back.** Drag it back to `To Do`, and confirm with `verify.sh jira`.

On fake Jira: `e2e/move.e2e.ts`.

## Gotchas

- `bun run test:real` drives this on real Jira. The drop also ranks the card in Jira (a `Rank` changelog entry), so putting it back means its rank too.
- A move Jira's workflow doesn't allow is refused, and the card goes back. That is correct behavior, not a failure of the run.
