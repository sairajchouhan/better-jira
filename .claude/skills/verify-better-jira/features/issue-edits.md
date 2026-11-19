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
- Record the issue first: `verify.sh jira '/rest/api/3/issue/SAM1-8?fields=summary,priority,status' > $D/jira-before.json`.

- **Rename.** Open `Develop Transaction History Feature`, fill `Issue title` with a new title, and press Tab. `Jira save status` reads `Saved to Jira`.
- **Priority from the card.** Click `Priority on SAM1-8`, then choose a `menuitem` by priority name. The card's priority button shows the new name.
- **Status from the card.** Click `Status on SAM1-8`, then choose `In Progress`. The card moves to the `In Progress` column.
- **Read back.** `verify.sh jira '/rest/api/3/issue/SAM1-8?fields=summary,priority,status'` shows every new value. Reload and check that the board matches.
- **Put back.** Restore each value the same way, and confirm with `verify.sh jira`.

On fake Jira: `e2e/issue-detail-properties.e2e.ts`, `e2e/edit.e2e.ts`, `e2e/board-cards.e2e.ts`.

## Gotchas

- Not yet driven on real Jira. The handles come from the live board snapshot and the e2e specs. The first real run confirms them and updates this file.
- The priority names come from the Jira site. Read the menu instead of assuming `High` or `Low`.
