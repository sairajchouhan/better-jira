# Comments

A user comments on an issue, edits and deletes their comments, and replies inside a thread. Jira holds each comment, and a reload shows the same thread.

## Sub-features

- `comment-add`: write in `Leave a comment…` and submit.
- `comment-edit`: hover the comment, click `Comment options` (or `Reply options` on a reply) › `Edit`, then `Save comment` (visible button text `Save`).
- `comment-reply`: `Reply to thread`, then `Submit reply`.
- `comment-delete`: `Comment options` (root) or `Reply options` (reply) › `Delete`, then confirm in the dialog (`Delete`). `⌘Z` undoes it; the Jira `DELETE` is held for an 8 s undo window.

## How to get to it (user POV)

- Open an issue and scroll to `Activity`. The comment box is at its foot.

## Driving it with browse (real Jira)

Preconditions:

- `verify.sh doctor` passes, and SAM1-9 is open.

- **Add.** Click the textbox `Leave a comment…`, type a unique text such as `verify <run-id>`, then click `Submit comment`. The comment shows in `Activity` and `Jira save status` reads `Saved to Jira`.
- **Read back.** `verify.sh jira '/rest/api/3/issue/SAM1-9/comment?maxResults=100'` lists it.
- **Edit.** Hover the root comment, click `Comment options` › `Edit`, change the text in `Edit comment`, then click `Save comment` (visible label `Save`). Wait for `Saved to Jira` and read it back.
- **Reply.** Click `Reply to thread`, type in the `Reply to thread` textbox, then click `Submit reply`. Wait for `Saved to Jira`, reload, and verify the reply stays nested inside the thread (with `parentId` matching the root comment ID in Jira).
- **Delete (cleanup).** Hover each reply and use `Reply options` › `Delete` › dialog `Delete`; hover the root comment and use `Comment options` › `Delete` › dialog `Delete`. Wait **>8 s** (the `COMMENT_UNDO_WINDOW` hold) plus settlement (`Saved to Jira`) before reading back or reloading — during the 8 s hold, `Jira save status` still shows `Saved to Jira` while Jira still holds the comment. Read back with `verify.sh jira '/rest/api/3/issue/SAM1-9/comment?maxResults=100'` that none is left.

On fake Jira: `e2e/comments-journeys.e2e.ts`.

## Gotchas

- `bun run test:real` drives add, edit and delete on real Jira. Reply is not yet driven there.
- Comments are real on the sandbox Jira. Always delete the ones the run made.
