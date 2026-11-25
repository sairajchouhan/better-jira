# Comments

A user comments on an issue, edits and deletes their comments, and replies inside a thread. Jira holds each comment, and a reload shows the same thread.

## Sub-features

- `comment-add`: write in `Leave a comment…` and submit.
- `comment-edit`: `Comment options` › `Edit`, then `Save comment`.
- `comment-reply`: `Reply to thread`, then `Submit reply`.
- `comment-delete`: `Comment options` › `Delete`, then confirm in the dialog. ⌘Z undoes it.

## How to get to it (user POV)

- Open an issue and scroll to `Activity`. The comment box is at its foot.

## Driving it with browse (real Jira)

Preconditions:

- `verify.sh doctor` passes, and SAM1-9 is open.

- **Add.** Fill the textbox `Leave a comment…` with a unique text such as `verify <run-id>`, then click `Submit comment`. The comment shows in `Activity` and `Jira save status` reads `Saved to Jira`.
- **Read back.** `verify.sh jira '/rest/api/3/issue/SAM1-9/comment'` lists it.
- **Edit.** Open that comment's `Comment options`, choose `Edit`, change the text in `Edit comment`, then `Save comment`. Read it back.
- **Reply.** `Reply to thread`, fill the textbox `Reply to thread`, then `Submit reply`. The reply shows inside the thread after a reload.
- **Delete (cleanup).** `Comment options` › `Delete`, then the dialog's `Delete`, for each comment the run made. Read back that none is left.

On fake Jira: `e2e/comments-journeys.e2e.ts`.

## Gotchas

- `bun run test:real` drives add, edit and delete on real Jira. Reply is not yet driven there.
- Comments are real on the sandbox Jira. Always delete the ones the run made.
