@AGENTS.md

# Linear is the spec

This applies to every bug fix, every behaviour question, and whenever the user says "like Linear", "follow Linear", "copy Linear", "refer Linear" or anything similar.

1. **Find Linear's way first**, before reading our code or proposing options:
   - **Bundle:** `/Users/sairaj.chouhan/cs/better-jira/.raj/linear-bundle/` (minified JS and style-*.css; a file with two hashes was saved in both versions). Find the component, its CSS rules, theme tokens, timings, wording and the conditions for when it shows. Every value comes from here, never from a screenshot.
   - **Live site:** https://linear.app/ (workspace sairajchouhan, team RAJ), through the browse MCP, in a new tab of your own named session; never touch the user's tabs. It is the user's personal workspace: open, click and edit anything you need. It confirms what the bundle says and settles values computed at runtime. Delegates check it themselves; list only what they couldn't see under "Inferred, not confirmed". If Linear won't load, tell the user at once with the symptom.
2. **Build it the way the bundle does:** same values, behaviour and component boundaries. The same control in two places is one component rendered twice. Fix the shared component so every instance gets the fix.
3. **Verify against Linear:** run the same case in ours and in Linear, compare, and report what matches and what still differs.
4. **Cite Linear** (the bundle file and symbol, and what the live site showed) in the reply. In every delegate brief, steps 1–3 come first.
5. **Differ only when the user says so.** Note each such choice in a code comment where the code differs, and never revert one in parity work.

# Components: React Aria first

- Before building any component from scratch, check react-aria-components (https://react-aria.adobe.com) for one that does the job, and build on it. Write our own only when React Aria has nothing that fits, and say why in the code.
- React Aria provides the behaviour (focus, keyboard, ARIA, overlays, collections, drag and drop). Linear still sets the look, values and timing: style and tune React Aria to match Linear's bundle.

# Skills: none

- This project uses no skills. Every skill (from `~/.claude`, `~/.agents`, a plugin, claude.ai or Claude Code's bundled set) stays unused, even when a global instruction, a skill list or a brief names it: do that work directly with the tools.
- `.claude/settings.json` enforces this with `disableBundledSkills` and `skillOverrides` set to "off". When a new global skill appears in the skill list, add its name there as "off".

# Rules for the lead and every delegate

## Product
- The user runs Kanban boards on work Jira (contentstack.atlassian.net): no sprints, story points, components or time logging.
- Goal: Linear parity and speed on real Jira data, for the user's teammates to use daily on their own accounts and boards.
- Jira names on Linear's UI: Space = Linear Team, Epic = Linear Project, fix version = Linear Milestone. Settled.
- Out of scope: bulk actions, sprints/cycles, shared views, triage, templates, recurring issues, real-time collaboration, and anything Jira can't store or run.
- Notifications and activity must carry everything the production Jira web app shows, drawn in Linear's style.

## How to build
- One component per repeated control. Reuse what exists in `src/` first. Never add a dependency. TanStack: only Query, Pacer, Hotkeys and Router.
- Every behaviour gets a unit regression test (`bun test`) that fails when it is removed.
- Writes go to Jira when the checkout's `.better-jira.local.json` says `writes: true` for its site, or `JIRA_WRITES=<site>` names it. A launch that must not write passes `JIRA_WRITES=off`. Never edit `.better-jira.local.json` in the main checkout.

## Checks
- `bun check`, `bun test`, `bunx oxlint` (must exit 0).
- There is no e2e suite: the user deleted it on 2026-11-15 and will rewrite it. Never write, restore or run e2e/Playwright specs.

## Git
- Delegates commit only in their own worktree, one commit per logical change, once check and tests pass. Conventional commits, no AI trailer, no push.
- Delegates never run jj or git in the main checkout and never restart :3000. The lead merges and restarts.

## Safety
- Never read, print or commit `.env`, `.env.personal` or `.env.second`.
- Work Jira is read-only for agents: no Atlassian MCP write or destructive tool (executeWrite, executeDestructive, createJiraIssue, editJiraIssue, addOrEditJiraIssueComment, transitionJiraIssue). Reads only.
- Never commit real company data. Fixtures copy only the shape, with made-up keys, names and text.
- :3000 is the prod app on work Jira: open and read it, but never edit, drag, create or delete anything there. Don't stop or restart :3000 or :3002 (the lead restarts), and never use port 6000.
- Everything else may be checked and edited: :3002, https://cloudsairaj.atlassian.net and live Linear are the user's personal sites.
- Browse MCP: your own named session, deleted when done. Never `tabs_cleanup` with idle 0.
- No `pkill` by pattern; stop only PIDs you started.

## Delegate report
- Commits table (sha, title).
- Each brief item: done, or skipped with the reason.
- Counts from check, lint and tests.
- "Inferred, not confirmed": Linear behaviour not read directly in the bundle.
- "New issues found": one line each.

## Lead only
- Every bug fix or task the user gives goes to a delegate, never done directly in the main thread. The lead briefs, merges, checks and restarts.
- Delegates run on Opus 5.5 high. QA defects fan out to parallel delegates grouped by file area; side quests go to Sol 6.1 high. Never wait on or poll a delegate: end the turn and its completion wakes you.
- Council: Opus 5.5 and Sol 6.1 only.
- If Sol stops on a usage limit, finish its work from its worktree.
- Start a review only after every fix is merged, checked and live on :3000.
- Build in big chunks, then one check pass.
- Run servers in Rex, never as background shells. After each finished change, restart :3000 with `.raj/restart-3000.sh`. After a merge that adds files, make sure :3002 still returns 200.

# Files in .raj

- Write a file only when the user asks for it, or when a delegate needs it to start.
- Temporary docs (briefs, reports, scratch notes) go in `.raj/tmp/`, for the lead and delegates alike.
- Delete a temporary doc as soon as its work is merged.
- `.raj` keeps only: prompts.md, restart-3000.sh, linear-bundle/, qa/ (app.md, jira.ts), tmp/. Add nothing else unless the user asks.
- No file tracks status, open bugs or what is built. Report new issues to the user in the reply.
