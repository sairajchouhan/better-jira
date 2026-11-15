@AGENTS.md

# better-jira: Linear is the spec

- Before any decision in this project, check how Linear does the same thing and do that. This covers every bug, layout or loading behaviour, menu, route or URL, wording, feature, value and "why does X happen". Check live Linear (team RAJ, in the user's Chrome, read-only) and Linear's bundle.
- Do this before diagnosing our own code, before proposing options, and as step 1 of every delegate brief. Cite what Linear does in the reply.
- Differ from Linear only when the user explicitly says they want something different. Record each such choice in `.raj/done.md` so parity work never reverts it.

# Components: React Aria first

- Before building any component from scratch, check react-aria-components (https://react-aria.adobe.com) for one that does the job, and build on it. Write our own only when React Aria has nothing that fits, and say why in the code.
- React Aria provides the behaviour (focus, keyboard, ARIA, overlays, collections, drag and drop). Linear still sets the look, values and timing: style and tune React Aria to match Linear's bundle.

# Rules for the lead and every delegate

## Product
- The user runs Kanban boards on work Jira (contentstack.atlassian.net): no sprints, story points, components or time logging.
- Goal: Linear parity and speed on real Jira data, for the user's teammates to use daily on their own accounts and boards.
- Deliberate differences from Linear are in `.raj/done.md`. Never revert them in parity work.
- Jira names on Linear's UI: Space = Linear Team, Epic = Linear Project, fix version = Linear Milestone. Settled.
- Out of scope: bulk actions, sprints/cycles, shared views, triage, templates, recurring issues, real-time collaboration, and anything Jira can't store or run.
- Notifications and activity must carry everything the production Jira web app shows, drawn in Linear's style.

## How to build
- Linear values and behaviour come from Linear's shipped bundle, never from screenshots: `/Users/sairaj.chouhan/cs/better-jira/.raj/linear-bundle/` (minified JS and style-*.css; a file with two hashes was saved in both versions).
- Apply both React skills on every edit, and say how in the report:
  - `/Users/sairaj.chouhan/cs/better-jira/.claude/skills/vercel-composition-patterns/`
  - `/Users/sairaj.chouhan/cs/better-jira/.claude/skills/vercel-react-best-practices/`
- Mirror Linear's component boundaries: the same control in two places is one component rendered twice. Fix a defect in the shared component so every instance gets it, never in one instance.
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
- Never touch ports 3000 or 3002, and never use port 6000. Only https://cloudsairaj.atlassian.net may be written, and only to `[QA] …` issues you create and delete again.
- Live Linear (team RAJ) is in the user's Chrome: look only, change nothing. Delegates don't open Linear; they list what needs a live look under "Inferred, not confirmed" and the lead checks it.
- Browse MCP: your own named session, deleted when done. Never `tabs_cleanup` with idle 0.
- No `pkill` by pattern; stop only PIDs you started.

## Delegate report
- Commits table (sha, title).
- Each brief item: done, or skipped with the reason.
- How each React skill was applied.
- Counts from check, lint and tests.
- "Inferred, not confirmed": Linear behaviour not read directly in the bundle.
- "New issues found": one line each.

## Lead only
- Delegates run on Opus 5.5 high. QA defects fan out to parallel delegates grouped by file area; side quests go to Sol 6.1 high. Never wait on or poll a delegate: end the turn and its completion wakes you.
- Council: Opus 5.5 and Sol 6.1 only.
- If Sol stops on a usage limit, finish its work from its worktree.
- Start a review only after every fix is merged, checked and live on :3000.
- Build in big chunks, then one check pass.
- Spot-check delegates' "Inferred, not confirmed" items in the user's own Linear tab. If Linear won't load, tell the user at once with the symptom.
- Run servers in Rex, never as background shells. After each finished change, restart :3000 with `.raj/restart-3000.sh`. After a merge that adds files, make sure :3002 still returns 200.
