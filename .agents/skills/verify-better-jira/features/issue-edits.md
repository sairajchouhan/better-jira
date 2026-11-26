# Issue edits

A user changes an issue's title and properties (status, priority, assignee, type) from the issue view or straight from its board card, and Jira holds the new values.

## Sub-features

- `edit-title`: rename from `Issue title`.
- `edit-priority`: pick a priority from the issue view or the card.
- `edit-status`: pick a status from the card's `Status on <KEY>`.

## How to get to it (user POV)

- Open an issue from the board and edit in the issue view.
- Use a card's property buttons on the board without opening the issue.

## Driving it with browse (real Jira)

Preconditions:

- `verify.sh doctor` passes, and the tab is on `/board/1/all`.
- Record the issue first: `verify.sh jira '/rest/api/3/issue/SAM1-8?fields=summary,priority,status' > $D/jira-before.json`. Confirm `fields.priority` is non-null and note the current `summary`, `priority.name`, and `status.name` (picking the current status is a no-op).

- **Rename.** Click the card's current summary text to open it, fill `Issue title` with a new title, and press `Tab`. Wait for `Jira save status` to read `Saved to Jira`.
- **Priority from the card.** Click `Priority on SAM1-8`, then choose a different priority `menuitem` inside dialog `Set priority` by prefix regex (e.g. `/^High/` — menu items include trailing shortcut digits like `High2`). The card's priority button is icon-only; verify its `title` attribute (or hover `role="tooltip"`) matches the new priority name, and wait for `Saved to Jira`.
- **Status from the card.** Click `Status on SAM1-8`, then choose a different status `menuitem` inside dialog `Change status` by prefix regex (e.g. `/^In Progress/`). The card moves to that column's `grid`; wait for `Saved to Jira`.
- **Read back.** `verify.sh jira '/rest/api/3/issue/SAM1-8?fields=summary,priority,status'` shows every new value. Reload and check that the board matches.
- **Put back.** Restore each value the same way, wait for `Saved to Jira`, and confirm with `verify.sh jira`.

On fake Jira: `e2e/issue-detail-properties.e2e.ts`, `e2e/edit.e2e.ts`, `e2e/board-cards.e2e.ts`.

## Gotchas

- `bun run test:real` drives the rename and the priority from the issue view on real Jira. The card controls are not yet driven there.
- The priority names come from the Jira site, and picker `menuitem` accessible names include their numeric shortcut hint (`Highest1`, `High2`, …). Read the menu and match by prefix rather than exact string.
- Jira can't clear a priority once an issue has one: REST refuses `null`, `{}` and id `-1`. On writable sites the app also hides `No priority` in priority menus and rejects `priority: null` server-side. Only change the priority of an issue that already has one, or it can't be put back.
