# better-jira

A fast, Linear-inspired local UI for your Jira Cloud Kanban boards. It runs on your own machine (`127.0.0.1`), keeps a local SQLite mirror of your boards for instant navigation and search, and syncs your edits back to Jira.

## Quick start (one-command install)

Works on **macOS** (`arm64` / `x64`) and **Linux** (`x64` / `arm64`) — no Bun, Node, or Git required:

```sh
curl -fsSL https://raw.githubusercontent.com/sairajchouhan/better-jira/main/install.sh | sh
better-jira
```

On first launch, `better-jira` opens a local setup screen in your browser:

1. Enter your **Jira Cloud site** (`https://your-team.atlassian.net`), **Atlassian email**, and a **Jira API token** (linked directly from the setup screen).
2. Search and pick any **Jira spaces** (boards) you want in your sidebar, and choose whether edits sync back to Jira or stay local-only.
3. Click **Launch better-jira** — your active issues load first so you can start working immediately while older history streams in the background.

Press `Ctrl+C` in the terminal to stop it anytime.

### Useful CLI commands

```sh
better-jira                    # start on http://127.0.0.1:3000 and open browser
better-jira --port 3001        # use another local port
better-jira --instance work    # keep a separate Jira account/site under another name
better-jira --no-open          # start without opening the browser
better-jira status             # show running status and config/cache paths
better-jira open               # open the running instance in your browser
```

## Where files are stored

Everything stays local on your machine:

- **Config & credentials:** `~/.config/better-jira/instances/<name>/`
  - `credentials.env` (`0600` owner-only permissions) — `JIRA_EMAIL` and `JIRA_TOKEN`
  - `settings.json` — Jira site URL, board IDs, and write toggle
- **Rebuildable cache:** `~/.cache/better-jira/instances/<name>/`
  - `cache.db` — local SQLite mirror of your Jira issues (safe to delete anytime to force a fresh sync)
  - `trips.jsonl` — local log of controls that still send you to Jira

`better-jira` binds only to `127.0.0.1` and never exposes your Jira token to the network. See [SECURITY.md](./SECURITY.md) for details.

## Adding & removing spaces

- Click **+** next to **Your spaces** in the sidebar (or press `Cmd/Ctrl+K` → **Add space**) to search all Jira boards visible to your account and add them in one click.
- Remove any space anytime from the **Add space** modal (**Remove**) or by right-clicking the space in the sidebar (**Remove from sidebar**).

## What syncs to Jira

When **Send edits to Jira** is enabled (footer shows **Edits write to Jira**):

- Title, description, status, priority, assignee, labels, type, due date, epic, fix versions (shown as milestones), estimate
- Creating and deleting issues, comments (new, edited, deleted), issue links and web links, attachments, card order
- Subscribing to an issue (adds you as a Jira watcher)
- Marking inbox notifications read or unread

Edits save optimistically in your browser first and sync reliably in the background with offline retry and conflict protection. If you prefer read-only browsing, turn off **Send edits to Jira** during setup (or set `JIRA_WRITES=off`) so the footer shows **Local only: nothing is sent to Jira**.

## Keyboard shortcuts

- `Cmd/Ctrl+K` — Command menu
- `Cmd/Ctrl+/` — All keyboard shortcuts
- `C` — New issue
- `/` — Search
- `S` / `A` / `P` / `L` — Status / Assignee / Priority / Labels
- `G` then `M` — My issues
- `Space` — Peek issue, `Enter` — Open issue

## GitHub pull requests (optional)

Cards and issue sidebars show pull requests linked in Jira plus GitHub pull requests referencing the issue key. Uses your local `gh auth token` or `GITHUB_TOKEN` (read-only). Set `GITHUB_PR_SOURCES=off` to disable.

## Out of scope

Sprints/cycles, story points, components, time tracking, bulk actions, templates, recurring issues, and real-time collaboration.

## Run from source / development

Requires [Bun](https://bun.sh):

```sh
git clone https://github.com/sairajchouhan/better-jira.git
cd better-jira
bun install

# Try the UI immediately with synthetic fixture data (no Jira account needed):
bun scripts/fixture-server.ts

# Or build the standalone binary locally:
bun run build:binary
./dist/bin/better-jira
```

See [CONTRIBUTING.md](./CONTRIBUTING.md) for tests, linting, Playwright E2E, and formal TLA+ sync model verification.

## License

[MIT](./LICENSE)
