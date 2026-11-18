# What we are building

We are cloning Linear on a Jira backend: the app should look and work exactly like Linear. Match Linear in everything; never invent or design something different. Differ only when the user says so.

- The user runs Kanban boards on work Jira (contentstack.atlassian.net): no sprints, story points, components or time logging.
- Goal: anyone who uses Jira can connect their own Jira and use this app every day instead, with Linear's speed and polish.
- Jira names on Linear's UI: Space = Linear Team, Epic = Linear Project, fix version = Linear Milestone. Settled.
- Out of scope: bulk actions, sprints/cycles, shared views, triage, templates, recurring issues, real-time collaboration, and anything Jira can't store or run.
- Notifications and activity must carry everything the production Jira web app shows, drawn in Linear's style.

# Where Linear lives

- **Bundle:** `/Users/sairaj.chouhan/cs/better-jira/.raj/linear-bundle/` (minified JS and style-*.css; a file with two hashes was saved in both versions). Exact values (CSS, theme tokens, timings, wording, when something shows) come from here, never from a screenshot.
- **Live site:** https://linear.app/sairajchouhan (workspace "mine", team "mine" with key RAJ), in the `raj-chrome` browse profile. It is the user's personal workspace: open, click and edit anything you need. If Linear won't load, tell the user at once with the symptom.

# Sites and servers

- **:3000** is the prod app on work Jira: open and read it, but never edit, drag, create or delete anything there.
- **:3002**, https://cloudsairaj.atlassian.net and live Linear are the user's personal sites: check and edit anything.
- Servers run in Rex, never as background shells. Only the main session stops or restarts :3000 and :3002: after each finished change, restart :3000 with `.raj/restart-3000.sh`; after a merge that adds files, make sure :3002 still returns 200. Never use port 6000.
- Never write to work Jira, through any app instance, script or tool. Anything that writes uses the user's personal Jira (cloudsairaj) and personal Linear.
- Browse MCP profiles: `work-chrome` (default) is for work Jira; `raj-chrome` is for personal Jira (cloudsairaj) and Linear. Pass `browser` when opening a tab.

# Safety

- Never read, print or commit `.env`, `.env.personal` or `.env.second`.
- Work Jira is read-only for agents: no Atlassian MCP write or destructive tool (executeWrite, executeDestructive, createJiraIssue, editJiraIssue, addOrEditJiraIssueComment, transitionJiraIssue). Reads only.
- Never commit real company data. Fixtures copy only the shape, with made-up keys, names and text.
- Browse MCP: your own named session, deleted when done; never touch the user's tabs. Never `tabs_cleanup` with idle 0.
- No `pkill` by pattern; stop only PIDs you started.

# Skills

- Use only pstack (the `pstack@cursor-plugins` plugin) and skills in this project's `.claude/skills/`. Every other skill (from `~/.claude`, `~/.agents`, another plugin, claude.ai or Claude Code's bundled set) stays unused, even when a global instruction, a skill list or a brief names it: do that work directly with the tools.
- `deslop` in `.claude/skills/` is a copy from Cursor's `cursor-team-kit`, which has no Claude Code build. When pstack names `/deslop`, use it.
- When pstack names `control-ui`, drive the app with the browse MCP. For CPU profiles, heap snapshots or network throttling, which browse lacks, use a one-off Playwright script with CDP.
- `.claude/settings.json` enforces this with `disableBundledSkills` and `skillOverrides` set to "off". When a new global skill appears in the skill list, add its name there as "off".
- Start every subagent with T3 Code's `delegate_task`, never the built-in Agent tool, even when a pstack skill says `Task` or `Agent`. Map the pstack model rule to `target` (e.g. `opus high` → provider `claudeAgent`, model `claude-opus-5-5`, effort `high`).

# Files in .raj

- `.raj` keeps only: prompts.md, pstack.md, restart-3000.sh, linear-bundle/, tmp/. Add nothing else unless the user asks.
- Write a file only when the user asks for it, or when a subagent needs it to start.
- Temporary docs (briefs, reports, scratch notes) go in `.raj/tmp/`; delete each as soon as its work is merged.
- No file tracks status, open bugs or what is built. Report new issues to the user in the reply.
