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

## Development and verification

```sh
bun run dev
bun test
bun check
bun run build
```

For disposable browser checks, `bun scripts/fixture-server.ts` serves the same UI at http://localhost:3001 with synthetic issues and no Jira client. Its fixture control route can inject read failures. It never imports Jira credentials or the real mirror. Do not use its synthetic account for normal work.

The rich document adapter follows [Jira ADF structure](https://developer.atlassian.com/cloud/jira/platform/apis/document/structure/). The editor uses [ProseMirror](https://prosemirror.net/docs/), and date parsing uses the English parser from [Chrono](https://github.com/wanasit/chrono).
