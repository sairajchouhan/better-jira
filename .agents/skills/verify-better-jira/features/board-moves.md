# Board moves

A user drags a card to another column. The card stays there, Jira transitions the issue to that status, and a reload shows the same board.

## Sub-features

- `move-drag`: drag a card onto another column.
- `move-persist`: the move survives a reload and shows in Jira.

## How to get to it (user POV)

- In board layout (grouped by `Status`), drag the card (by its title or card surface; the `Drag <KEY> <title>` button is `sr-only` with `pointer-events: none`) onto a card or the empty space in another column.

## Driving it with browse (real Jira)

Preconditions:

- `verify.sh doctor` passes, and the tab is on `/board/1/all` in board layout (grouped by `Status`, manual ordering).
- SAM1-6 `Set Up Notifications for Users` is in `To Do`.

- **Record Jira.** Save both status and rank order:
  - `verify.sh jira '/rest/api/3/issue/SAM1-6?fields=status' > $D/jira-before.json`
  - `verify.sh jira '/rest/api/3/search/jql?jql=project%20%3D%20SAM1%20ORDER%20BY%20Rank%20ASC&fields=summary,status&maxResults=50' > $D/rank-before.json` (note SAM1-6's preceding `To Do` neighbour).
- **Drag.** Drag the card's title text inside its column `grid` → `row` onto a visible `row` in `In Progress`:
  `await page.getByRole("grid", { name: "To Do" }).getByRole("row", { name: "SAM1-6 Set Up Notifications for Users", exact: true }).getByText("Set Up Notifications for Users", { exact: true }).dragTo(page.getByRole("grid", { name: "In Progress" }).getByRole("row").first())`.
  The card moves to `grid` `In Progress`, and the `To Do` count drops by one while `In Progress` rises by one.
- **Wait for save, then read back.** Wait for `Jira save status` to read `Saved to Jira` before querying Jira or reloading (reloading mid-write triggers `beforeunload`). Confirm `verify.sh jira '/rest/api/3/issue/SAM1-6?fields=status'` reads `In Progress`. Reload, and confirm the card is still in `grid` `In Progress`.
- **Put back.** Drag SAM1-6's title text from `In Progress` back onto its original `To Do` neighbour from `$D/rank-before.json` (dropping on a card places it after that card), wait for `Saved to Jira`, and confirm status (`To Do`) and rank order with `verify.sh jira`.

On fake Jira: `e2e/move.e2e.ts`.

## Gotchas

- `bun run test:real` drives this on real Jira. The drop also ranks the card in Jira (a `Rank` changelog entry), so putting it back means its rank too.
- A move Jira's workflow doesn't allow is refused, and the card goes back. That is correct behavior, not a failure of the run.
