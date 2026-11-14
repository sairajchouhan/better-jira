import { expect, test } from "bun:test";
import { Glob } from "bun";
import { userText } from "./user-text";
import { FIELDS, GROUPINGS, PROPERTIES } from "./view-model";

/**
 * The epic is called Epic everywhere a person reads it (user's call, 2026-11-14: Linear's Project, Jira's word). This guard reads
 * every string literal and JSX text in the client and shared code and fails on the word "project" (any case), except ids (one
 * lowercase token: the `"project"` field, `"prop-project"`) and the uses below, which mean something else. Comments are skipped.
 */
const ALLOWED: Record<string, string> = {
  // Search words: typing Linear's word still finds the Epic actions.
  "project delete": "the No epic row's keywords (Linear's VBn), so 'project' still finds it",
  "project move add to epic": "the ⇧P command's keywords",
  // A URL, not a word. (The Jira project itself is Linear's Team and reads Space: see space-naming.test.ts.)
  "https://your-team.atlassian.net/jira/software/projects/KAN/boards/1": "a Jira board URL example",
};
/** Words allowed in one file only: Linear's icon names (keyed by its filter names, never shown), Linear's shortcut sections. */
const ALLOWED_IN: Record<string, string[]> = {
  "src/client/features/filters/filter-icons.tsx": ["Project", "Project properties"],
  "src/client/features/filters/filter-menu.tsx": ["Project", "Project properties"],
  "src/client/features/filters/property-filter.tsx": ["Project"],
  "src/client/features/navigation/shortcut-panel.ts": ["Projects"],
};

const WORD = /\bprojects?\b/i;
/** A field id, DOM id or key: one lowercase token, never read as words. */
const ID = /^[a-z][\w-]*$/;

test("userText reads strings and JSX text, never comments or identifiers", () => {
  const found = userText(`// a project comment
const a = "Add to project", b = issue.project?.key; /* project */
const c = \`\${issue.project.name} is a project\`;
const el = <span title="x">removed from project <B>{name}</B></span>;`);
  expect(found).toContain("Add to project");
  expect(found).toContain("  is a project");
  expect(found).toContain("removed from project");
  expect(found.join("|")).not.toContain("comment");
  expect(found.filter((t) => WORD.test(t))).toHaveLength(3);
});

test("no user-facing 'project' means the epic: menus, filters, pills, ⌘K, tooltips, toasts and activity say Epic", async () => {
  const hits: string[] = [];
  for await (const path of new Glob("src/{client,shared}/**/*.{ts,tsx}").scan(".")) {
    if (/\.test\.tsx?$/.test(path)) continue;
    for (const text of userText(await Bun.file(path).text())) {
      if (!WORD.test(text) || ID.test(text) || ALLOWED[text] !== undefined || ALLOWED_IN[path]?.includes(text)) continue;
      hits.push(`${path}: ${JSON.stringify(text)}`);
    }
  }
  expect(hits).toEqual([]);
});

test("the shared label tables name the epic Epic: Grouping, Display properties, and Filter fields", () => {
  const label = (table: readonly (readonly [string, string])[], id: string) => table.find(([key]) => key === id)?.[1];
  expect(label(GROUPINGS, "project")).toBe("Epic");
  expect(label(PROPERTIES, "project")).toBe("Epic");
  expect(label(FIELDS, "project")).toBe("Epic");
  expect(["projectStatus", "projectPriority", "projectLabels", "projectLead"].map((id) => label(FIELDS, id))).toEqual([
    "Epic status",
    "Epic priority",
    "Epic labels",
    "Epic lead",
  ]);
  for (const table of [GROUPINGS, PROPERTIES, FIELDS]) for (const [, name] of table) expect(name).not.toMatch(WORD);
});
