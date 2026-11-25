# What we are building

We are building a fast, Linear-inspired local UI on a Jira Cloud backend: match Linear's speed, keyboard ergonomics, and polish unless the user asks for something different.

- Focused on Kanban boards on Jira Cloud: no sprints, story points, components, or time logging.
- Goal: anyone who uses Jira Cloud can connect their own Jira account and use this app every day instead, with local-first speed.
- Jira names on the UI: Space = Linear Team, Epic = Linear Project, fix version = Linear Milestone.
- Out of scope: bulk actions, sprints/cycles, shared views, triage, templates, recurring issues, real-time collaboration, and anything Jira can't store or run.
- Notifications and activity must carry everything the production Jira web app shows, drawn cleanly in Linear's style.

# Reference UI

- **Local reference bundle (optional, gitignored):** `.raj/linear-bundle/` (when present locally, exact tokens, timings, and wording can be checked there).
- **Live reference workspace (optional):** use your personal Linear workspace in a dedicated browser profile when checking interactive behavior.

# Sites and servers

- Each dev copy of the app is an instance: its `credentials.env` (or legacy `.env`), `settings.json`, and `cache.db` live in `instances/<name>/`, and `bun start <name>` builds it to `dist/<name>/` and runs it in production.
- **:3000** (`bun start work`, if configured) is a read-only work Jira instance: open and read it, but never edit, drag, create, or delete anything there.
- **:3002** (`bun start personal`) and **:3003** (`bun start second`, two-user checks) point at your personal sandbox Jira site: safe to edit and test against.
- Dev servers run in Rex, never as background shells. Only the main session stops or restarts `:3000`, `:3002`, and `:3003` (e.g. via `.raj/restart-3000.sh` when present). Never use port 6000.
- Never write to a work/production Jira site through any app instance, script, or tool. All write tests use a personal sandbox Jira or the disposable Playwright fixture (`scripts/fixture-server.ts`).

# Safety

- Never read, print, or commit `.env`, `.env.*`, `credentials.env`, or anything in `instances/`.
- Work Jira is strictly read-only for agents: never invoke any write or destructive Jira MCP tool against a work site.
- Never commit real company or personal data. Fixtures copy only the shape, with made-up keys, names, and text.
- Browser automation: use your own named session and close it when done; never touch the user's tabs.
- No `pkill` by pattern; stop only PIDs you started.

# Skills

- Use only pstack (vendored in `.agents/skills/`) and this project's own skills in `.agents/skills/` (`deslop`, `verify-better-jira`, `verify-sync-and-inbox`, symlinked into `.claude/skills/` for Claude Code).
- `.claude/settings.json` enforces this allowlist in Claude Code with `disableBundledSkills` and `skillOverrides`.
- Start every subagent with T3 Code's `delegate_task`, never a harness's built-in subagent/Agent tool, even when a pstack skill says `Task` or `Agent`. Map each role from the pstack model rule below to `target`.

## pstack model configuration

Read `.agents/rules/pstack-models.md` (symlinked at `.claude/rules/pstack-models.md`) for role models:

@[pstack-models](.agents/rules/pstack-models.md)

# Local scratch directory (`.raj`, gitignored)

- Write a temporary doc only when needed; keep scratch notes/reports in `.raj/tmp/` and delete them once merged.
- Do not commit status-tracking files; report findings directly in replies or issues.
