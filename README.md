# BetterJira

A personal Jira board with fast local editing and a Linear-inspired interface. Jira is the read source. Issue changes, comments, files, reactions, and subscriptions stay in your browser.

## Run it

Install Bun, clone the repository, then run:

```sh
bun install
bun run setup
bun start
```

Setup asks for your Jira Cloud site, account email, API token, and board IDs. It checks your account, lists accessible boards, and verifies the selected boards using read requests. Create an API token through your Atlassian account. Use a token with read access to the boards you select. Tokens are entered without terminal echo and stored in the ignored `.env` file with owner-only permissions. Site and board choices go in the ignored `.better-jira.local.json` file.

Open http://localhost:3000. The first mirror sync can take a while on a large board. Retry loading after it finishes. The app listens on the local loopback interface.

To use environment configuration instead, copy `.env.example` to `.env` and fill in `JIRA_URL`, `JIRA_EMAIL`, `JIRA_TOKEN`, and `JIRA_BOARDS`. Environment values override local settings. Optional `PORT` and `JIRA_CACHE` select the port and SQLite cache. The default cache filename separates sites and account emails. An existing explicit cache cannot be reused for a different source account.

```sh
bun run setup --check
```

This verifies configuration, credentials, and board access without changing files. Restart the server after changing setup.

### Pull requests from GitHub

Cards and rows show the pull requests Jira's development panel links, plus those GitHub links straight to an issue key: a key in the pull request's branch name, title, or body (`feat/ABC-12-tidy`, `Tidy the cache (ABC-12)`). This covers organisations Jira's GitHub app isn't connected to. The server only reads from GitHub. It never comments, reviews, or edits.

- **Token:** the GitHub CLI's own login (`gh auth token`, its active account), read at runtime and kept in memory. Set `GITHUB_TOKEN` to use another token instead. Neither is logged or saved.
- **Sources:** `GITHUB_PR_SOURCES` lists organisations (`acme`) and repositories (`acme/app`), comma separated. When it is unset, the server reads the owners of your own recent pull requests. `GITHUB_PR_SOURCES=off` turns GitHub off.
- **Window:** the first read covers pull requests updated in the last `GITHUB_PR_DAYS` days (30 by default). After that, one search every 30 seconds reads what changed since the last one. The server keeps the list in its cache and stops at GitHub's rate limit until it resets.

## Local edits and rich descriptions

The browser saves issue edits, locally created or deleted issues, comments, attachment contents, description revisions, and the last 100 undo/redo entries in IndexedDB. The footer shows Saving, Saved locally, or Not saved. Wait for Saved locally before closing the tab. View preferences, filters, favorites, and named views use browser storage too. Data is separate for each Jira site and account.

Fresh mirror data still supplies fields you have not edited. Locally edited fields remain local overrides across reloads. The issue options action Restore mirrored Jira version removes an issue's local overrides and is undoable. For a locally deleted issue, use Undo to restore it.

Description editing retains Jira's Atlassian Document Format, including marks, lists, tables, and node metadata. Content the editor cannot interpret appears as a preserved token. Editing surrounding text keeps that content intact. Save applies the document; Cancel discards the draft. Rich editor undo is separate from the issue undo history until you save.

Due dates accept phrases such as tomorrow, next Monday, 24h, 7 days, and Feb 9, or a calendar date. The preview shows the exact day in your local calendar. Incomplete dates cannot be saved. Reactions support search, skin tones, recent choices, and any pasted single emoji.

## Backups and recovery

Use Backup in the footer to download local changes, history, attachment contents, and recovery copies as JSON. Browser data does not sync between profiles or computers. Clearing this site's storage also clears local edits and files. Keep a backup before doing that. Backup export is available; importing a backup is not currently a UI workflow.

If storage fails, keep the tab open. Retry local storage after fixing the problem, or download a backup first. A failed save leaves the edit in memory and shows Not saved. If another tab saves newer data, the older tab refuses to overwrite it. Export that tab's unsaved work before reloading.

Damaged records are isolated while valid records load, and the original record is kept in recovery storage. A database from an unsupported schema version pauses editing so the app cannot overwrite it.

## Scope

Jira issue writes are disabled in the client itself. The only permitted Jira POST is the documented changelog bulk-fetch read. The UI has no bulk actions, AI integration, organization rules, or team-wide defaults. Milestones map to Jira fix versions. Reactions, files, subscriptions, and issue history are personal local data.

Credentials stay on the server. Do not expose this personal server to an untrusted network. The ignored SQLite cache and local backup contain private issue data.

## Keyboard shortcuts

Press **Cmd+/** on macOS or **Ctrl+/** on Windows/Linux for the searchable shortcut reference. **?** opens Help. These are separate actions, matching Linear's live Help menu.

The app uses TanStack Hotkeys for chords, multi-key sequences, platform modifiers, and scoped editor shortcuts. The reference and command/menu badges use the same binding definitions as execution.

| Action                             | Shortcut                     |
| ---------------------------------- | ---------------------------- |
| Command menu                       | Cmd/Ctrl+K                   |
| Search issues                      | / or O then I                |
| Active, Backlog, All issues        | G then A, G then B, G then E |
| My issues                          | G then M                     |
| Create issue                       | C; V for expanded creation   |
| Status, assignee, priority, labels | S, A, P, L                   |
| Rename selected issue              | Shift+R                      |
| Focus description                  | Control+Shift+I              |
| Set due date                       | Shift+D                      |
| Focus comment                      | Control+M                    |
| Peek / open focused issue          | Space / Enter                |
| Toggle board/list                  | Cmd/Ctrl+B                   |

Letter shortcuts do not run while typing. Issue actions need a selected issue. Editor shortcuts apply only inside the editor, so Cmd/Ctrl+B formats text there and switches layout outside it. Reordering uses Manual ordering. Unsupported Linear features such as AI, bulk actions, cycles, and project management have no advertised bindings.

## Development and verification

```sh
bun run dev
bun test
bun check
bun run build
```

For disposable browser checks, `bun scripts/fixture-server.ts` serves the same UI at http://localhost:3001 with synthetic issues and no Jira client. Its fixture control route can inject read failures. It never imports Jira credentials or the real mirror. Do not use its synthetic account for normal work.

The rich document adapter follows [Jira ADF structure](https://developer.atlassian.com/cloud/jira/platform/apis/document/structure/). The editor uses [ProseMirror](https://prosemirror.net/docs/), and date parsing uses the English parser from [Chrono](https://github.com/wanasit/chrono).
