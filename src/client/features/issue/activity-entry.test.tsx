import { expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import type { Issue } from "@/shared/issue-model";
import { describeActivity, priorityRank, titleChangeLabel } from "./activity-entry";
import { activityRows, type ActivityField, type PropertyActivity } from "./issue-activity";

// Made-up shapes only (BJ-40): each Jira change kind sampled read-only from real tickets, worded as Linear's history chunk words it.
const issue = { key: "ABC-1" } as Issue,
  ada = { id: "ada", name: "Ada Example" };
let n = 0;
const event = (field: ActivityField, before: unknown, after: unknown, actor = ada, at = "2026-03-01T09:00:00Z"): PropertyActivity => ({
  id: String(++n),
  field,
  before,
  after,
  actor,
  at,
});
const words = (e: PropertyActivity, then = false) =>
  renderToStaticMarkup(<>{describeActivity(e, issue, then)}</>)
    .replace(/<[^>]+>/g, "")
    .replace(/&quot;/g, '"')
    .replace(/\s+/g, " ");

test("BJ-40: Linear's wording for the kinds Linear has (status, priority, assignee, due date, parent, title, estimate, project, cycle, team, labels)", () => {
  expect(words(event("status", { id: "1", name: "To Do" }, { id: "2", name: "In Progress" }))).toBe(
    "moved from To Do to In Progress",
  );
  expect(words(event("priority", null, "High"))).toBe("set priority to High");
  expect(words(event("priority", "Low", "Urgent"))).toBe("raised priority from Low to Urgent");
  expect(words(event("priority", "Highest", "Lowest"))).toBe("lowered priority from Highest to Lowest");
  expect(words(event("priority", "High", null))).toBe("removed priority");
  expect(words(event("assignee", null, { id: "u2", name: "Grace Example" }))).toBe("assigned to Grace Example");
  expect(words(event("assignee", { id: "u2", name: "Grace" }, { id: "u3", name: "Lin" }))).toBe("re-assigned to Lin");
  expect(words(event("assignee", null, { id: "ada", name: "Ada Example" }))).toBe("self-assigned the issue");
  expect(words(event("assignee", { id: "u2", name: "Grace" }, null))).toBe("removed assignee");
  expect(words(event("due", null, "2026-11-07"))).toBe("set the due date to Nov 7");
  expect(words(event("due", "2026-11-07", "2026-11-09"))).toBe("changed the due date from Nov 7 to Nov 9");
  expect(words(event("due", "2026-11-07", null))).toBe("removed due date");
  expect(words(event("parent", null, "ABC-9"))).toBe("set parent to ABC-9");
  expect(words(event("parent", "ABC-8", "ABC-9"))).toBe("changed parent issue from ABC-8 to ABC-9");
  expect(words(event("parent", "ABC-8", null))).toBe("removed parent ABC-8");
  expect(words(event("title", "Old", "New title"))).toBe("changed title to New title");
  expect(renderToStaticMarkup(<>{describeActivity(event("title", "Old", "x".repeat(80)), issue)}</>)).toContain(
    `title="Previously: Old"`,
  );
  expect(words(event("title", "Old", "x".repeat(80)))).toBe(`changed title to ${"x".repeat(70)}…`);
  expect(words(event("estimate", null, 2))).toBe("estimated complexity as 2");
  expect(words(event("estimate", 2, 5))).toBe("increased estimate from 2 to 5");
  expect(words(event("estimate", 5, 2))).toBe("lowered estimate from 5 to 2");
  expect(words(event("estimate", 2, null))).toBe("removed estimate");
  expect(words(event("project", { id: "1", name: "Old" }, { id: "2", name: "New" }))).toBe(
    "changed project from Old to New",
  );
  const sprint = (...names: string[]) => names.map((name) => ({ id: name.replace(/\D/g, ""), name }));
  expect(words(event("cycle", null, sprint("Auto Draft Sprint 10")))).toBe("added issue to Auto Draft Sprint 10");
  expect(words(event("cycle", sprint("Sprint 9"), sprint("Sprint 10")))).toBe("moved issue to Sprint 10");
  expect(words(event("cycle", sprint("Sprint 10"), null))).toBe("removed issue from Sprint 10");
  expect(words(event("cycle", null, sprint("Q3")))).toBe("added issue to Q3 cycle");
  // An unfinished issue carried into the next sprint: Jira lists both.
  expect(words(event("cycle", sprint("Sprint 9"), sprint("Sprint 9", "Sprint 10")))).toBe("added issue to Sprint 10");
  expect(words(event("cycle", sprint("Sprint 9", "Sprint 10"), sprint("Sprint 9")))).toBe(
    "removed issue from Sprint 10",
  );
  expect(words(event("team", null, "Builders"))).toBe("changed team to Builders");
  expect(words(event("team", "Builders", "Makers"))).toBe("changed team from Builders to Makers");
  expect(words(event("labels", ["a"], ["b", "c"]))).toBe("added labels b, c and removed label a");
});

test("BJ-40: Linear's relation wording, and Jira link types Linear lacks keep their phrase", () => {
  expect(words(event("relation", null, { key: "ABC-2", kind: "blocking" }))).toBe("marked this issue as blocking ABC-2");
  expect(words(event("relation", { key: "ABC-2", kind: "blocked" }, null))).toBe(
    "unmarked this issue as being blocked by ABC-2",
  );
  expect(words(event("relation", { key: "ABC-2", kind: "related" }, null))).toBe("removed related issue ABC-2");
  expect(words(event("relation", null, { key: "ABC-3", kind: "clones" }))).toBe("linked this issue: clones ABC-3");
  expect(words(event("relation", { key: "ABC-3", kind: "is connected to" }, null))).toBe(
    "removed link: is connected to ABC-3",
  );
});

test("BJ-40: Jira-only kinds read plainly in the same pattern", () => {
  expect(words(event("resolution", null, "Done"))).toBe("set resolution to Done");
  expect(words(event("resolution", "Done", null))).toBe("removed resolution");
  expect(words(event("type", "Task", "Bug"))).toBe("changed issue type from Task to Bug");
  expect(words(event("milestone", null, { id: "7", name: "Release 1" }))).toBe("added to milestone Release 1");
  expect(words(event("milestone", { id: "7", name: "Release 1" }, null))).toBe("removed from milestone Release 1");
  expect(words(event("component", null, { id: "5", name: "Editor" }))).toBe("added component Editor");
  expect(words(event("attachment", null, { id: "9", name: "clip.mp4" }))).toBe("attached clip.mp4");
  expect(words(event("attachment", { id: "9", name: "clip.mp4" }, null))).toBe("removed attachment clip.mp4");
  expect(words(event("weblink", null, { id: "4", name: 'This work item links to "Wiki Page"' }))).toBe(
    "linked Wiki Page",
  );
  expect(words(event("comment", { id: "1", name: "" }, null))).toBe("deleted a comment");
  expect(words(event("description", "", ""))).toBe("updated the description");
  expect(words(event("flag", null, "Impediment"))).toBe("flagged the issue");
  expect(words(event("field", null, { name: "Release notes", value: "Shipped" }))).toBe(
    "set Release notes to Shipped",
  );
  expect(
    words(event("field", { name: "Severity", value: "S2" }, { name: "Severity", value: "S1" })),
  ).toBe("changed Severity from S2 to S1");
  expect(words(event("field", { name: "Severity", value: "S2" }, null))).toBe("removed Severity");
});

test("BJ-40: Jira's priority names rank like Linear's levels", () => {
  expect(["Highest", "High", "Medium", "Low", "Lowest", ""].map(priorityRank)).toEqual([1, 2, 3, 4, 4, 0]);
});

test("BJ-13: one record's changes split like Linear's: small kinds two to a row, every other kind its own row, in Linear's order", () => {
  const rows = activityRows([
    event("due", null, "2026-11-07"),
    event("labels", [], ["a"]),
    event("priority", null, "High"),
    event("title", "a", "b"),
    event("assignee", null, { id: "u2", name: "Grace" }),
    event("status", "1", "2"),
    event("estimate", null, 3),
  ]);
  expect(rows.map((r) => [r.field, r.events.map((e) => e.field)])).toEqual([
    ["status", ["status"]],
    ["multi", ["assignee", "priority"]],
    ["multi", ["estimate", "labels"]],
    ["title", ["title"]],
    ["due", ["due"]],
  ]);
});

test("BJ-196: project names expose the old and new issue keys", () => {
  const markup = renderToStaticMarkup(<>{describeActivity(event("project", { id: "1", name: "Old", key: "OLD-1" }, { id: "2", name: "New", key: "NEW-1" }), issue)}</>);
  expect(markup).toContain('title="OLD-1"');
  expect(markup).toContain('title="NEW-1"');
});

test("BJ-196: title group counts use Linear's words through twenty", () => {
  expect(titleChangeLabel(2)).toBe("changed title twice");
  expect(titleChangeLabel(3)).toBe("changed title three times");
  expect(titleChangeLabel(20)).toBe("changed title twenty times");
  expect(titleChangeLabel(21)).toBe("changed title 21 times");
});
