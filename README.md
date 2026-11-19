# better-jira

A fast, Linear-style board for your Jira Cloud Kanban boards. It runs on your own machine with your own Jira account, keeps a local copy of your boards for speed, and sends your edits to Jira.

## Quick start

Install [Bun](https://bun.sh), clone this repository, then run `bun install`, `bun run setup mine` and `bun start mine`, and open http://localhost:3000. `mine` names this copy of better-jira: pick any name. Setup asks for your Jira site (`https://your-team.atlassian.net`), the email you sign in with, an [API token](https://id.atlassian.com/manage-profile/security/api-tokens) and your boards (IDs, board links, or part of a name to search), checks each one against Jira with reads only, and asks whether your edits should go to Jira. The first sync of a large board takes a minute or two; the app opens when it's done.

```sh
bun install
bun run setup mine
bun start mine
```

Everything one copy reads or writes lives in its folder, `instances/mine/`: the token in `.env` (typed without echo, owner-only permissions), the site, boards and edits answer in `settings.json`, and the local copy of your boards in `cache.db`. Git ignores `instances/`. `bun run setup mine --check` checks the saved setup against Jira and changes nothing. Run setup again to change boards or the edits answer, then restart `bun start mine`. You can also add a board from the sidebar ("Add space").

For a second Jira site or account, set up another name (`bun run setup other`, then `PORT=3001 bun start other`). Each copy keeps its own folder and never reads another's. `bun start` alone lists the copies you have.

## What goes to Jira

If you answered yes in setup, `bun start` sends your edits to Jira under your account, and the footer says **Edits write to Jira**:

- title, description, status, priority, assignee, labels, type, due date, epic, fix versions (shown as milestones), estimate
- new issues, deleted issues, comments (new, edited, deleted), issue links and web links, attachments, card order
- subscribing to an issue (it makes you a Jira watcher)
- marking notifications read or unread in the inbox

Edits save as you go: the description saves a moment after you stop typing, everything else at once. Each edit is kept in your browser first, then sent; if Jira refuses one, a toast says "Jira did not save the change".

Your API token needs the same rights in Jira as you: edit, transition, comment and create in your boards' projects. Setup warns about any it is missing. A read-only account can still browse, but its edits fail.

If you answered no, or set `JIRA_WRITES=off`, the footer says **Local only: nothing is sent to Jira**. Edits then stay in that browser, and they are not sent later when edits are turned on. `bun run dev` never writes to Jira.

## What stays in your browser

Reactions, reminders, snoozed or deleted inbox rows, favorites, view settings, recents, drafts, undo history, description history and your manual sub-issue order stay in this browser's storage, per Jira site and account. They don't follow you to another browser or computer. Saved views live in the server's local cache file, per account.

## Not in scope

Sprints, story points, components, time tracking, bulk actions and AI features. Fix versions show as milestones and epics as Epics.

## Update

```sh
git pull
bun install
```

Then stop `bun start mine` (Ctrl+C) and run it again.

## Back up

Click the download icon in the footer for a backup of everything kept in this browser (local edits, history and files) as JSON. Do this before clearing the site's data or switching browsers; there is no import yet. Your Jira data itself is in Jira.

## Troubleshooting

- **The app shows "Couldn't load your Jira data", or the footer shows a red "Not syncing with Jira" line.** The message says what is wrong and what to do. Run `bun run setup mine --check` for the same checks in the terminal.
- **"Jira rejected your email and API token (401)".** The token was revoked or expired, or the email isn't the one you sign in with. Create a new token and run `bun run setup mine`.
- **"Can't read board N (403)" or "Board N doesn't exist (404)".** Ask the board's admin for access, or pick other boards with `bun run setup mine`.
- **"Can't reach the better-jira server".** `bun start` stopped; start it again.
- **A board looks stale or wrong.** Stop the server and delete its cache, `instances/mine/cache.db`; the next start syncs it again. Local edits in the browser are kept.
- **Port 3000 is taken.** Set `PORT=3001` in `instances/mine/.env`, or start with `PORT=3001 bun start mine`.

`bun start` listens on your machine only. Don't expose it to a network: it holds your Jira token.

## GitHub pull requests

Cards and the issue sidebar show pull requests linked in Jira, plus GitHub pull requests that name the issue key in their branch or title, or in their description after a magic word such as "Fixes" or "Part of", as Linear links them. It uses your GitHub CLI login (`gh auth token`) or `GITHUB_TOKEN`, and only reads. `GITHUB_PR_SOURCES` lists organisations or repositories to read (default: those of your own recent pull requests); `GITHUB_PR_SOURCES=off` turns it off.

## Keyboard

Cmd/Ctrl+K opens the command menu, Cmd/Ctrl+/ lists every shortcut, `?` opens Help. Common ones: C new issue, / search, S status, A assignee, P priority, L labels, G then M My issues, Space peek, Enter open.

## Development

```sh
bun run dev mine   # hot reload; never writes to Jira
bun test
bun check
bunx oxlint
```

`bun scripts/fixture-server.ts` serves the UI with made-up issues and no Jira at all, for trying things safely.
