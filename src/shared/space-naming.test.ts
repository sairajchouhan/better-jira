import { expect, test } from "bun:test";
import { Glob } from "bun";
import { assigneeGroups } from "./board-catalog";
import { FILTER_FIELDS } from "./inbox-model";
import { PUSH_CATEGORIES } from "./inbox-push";
import { userText } from "./user-text";

/**
 * Linear's Team is called Space everywhere a person reads it (user's call, 2026-11-14): a Linear team is a Jira space here (it
 * owns the issue key, workflow statuses, members and board). Behaviour stays Linear's Team. This guard reads every string
 * literal and JSX text in the client and shared code and fails on the word "team" (any case), except ids (one lowercase token:
 * `"team-open"`, `"team"`) and the uses below, which mean something else. Comments are skipped.
 */
const ALLOWED: Record<string, string> = {
  // Jira's own "Team" field (Atlassian Teams, a custom field), not the space: jira-history.ts maps it and Activity words it.
  Team: "jira-history.ts: the changelog field Jira itself names Team",
  "removed team": "Activity: Jira's Team field cleared",
  "changed team to": "Activity: Jira's Team field set",
  "changed team from": "Activity: Jira's Team field changed",
  // Search words: typing Linear's word still finds the Space commands.
  "team board": "⌘K keywords on Open space, Add space and Go to space N",
  // Not words a person reads as the space.
  "/team/$board/$scope": "Linear's /team/… URL shape, a route",
  "team- ": "the Go to space N command ids (`team-${n}`)",
  " team": "fuzzy-score's person marker for a member of the board (`${PERSON}team`)",
  "https://your-team.atlassian.net/jira/software/projects/KAN/boards/1": "a Jira board URL example",
};
/** Files where an allowed word may appear; "Team" is allowed only where Jira's field is read. */
const ALLOWED_IN: Record<string, string[]> = {
  "src/client/features/issue/jira-history.ts": ["Team"],
};
const ONLY_IN = new Set(Object.values(ALLOWED_IN).flat());

const WORD = /\bteams?\b/i;
/** A field id, DOM id or key: one lowercase token, never read as words. */
const ID = /^[a-z][\w-]*$/;

test("no user-facing 'team': menus, pickers, ⌘K, toasts, columns, filters and activity say Space", async () => {
  const hits: string[] = [];
  for await (const path of new Glob("src/{client,shared}/**/*.{ts,tsx}").scan(".")) {
    if (/\.test\.tsx?$/.test(path)) continue;
    for (const text of userText(await Bun.file(path).text())) {
      if (!WORD.test(text) || ID.test(text)) continue;
      if (ONLY_IN.has(text) ? ALLOWED_IN[path]?.includes(text) : ALLOWED[text] !== undefined) continue;
      hits.push(`${path}: ${JSON.stringify(text)}`);
    }
  }
  expect(hits).toEqual([]);
});

test("the shared labels name the space Space: assignee picker heading, inbox filter, push categories", () => {
  const me = { id: "me", name: "Me" };
  expect(assigneeGroups({ me, current: null, jiraUsers: [], issues: [], board: 1 }).teamHeading).toBe("Space members");
  expect(FILTER_FIELDS.find(([id]) => id === "project")?.[1]).toBe("Space");
  expect(PUSH_CATEGORIES.find(([id]) => id === "subscriptions")?.[2]).toBe(
    "Issues, epics, initiatives, spaces, and views you're subscribed to",
  );
});
