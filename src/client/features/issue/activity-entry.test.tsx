import { expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import type { Issue } from "@/shared/issue-model";
import { ActivityIcon, ActivityRowWords, describeActivity, priorityRank, titleChangeLabel } from "./activity-entry";
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
  // Linear's list (`GOn`/`XOn`): "a and b", "a, b, and c"; past five added labels, "and N others".
  expect(words(event("labels", ["a"], ["b", "c"]))).toBe("added labels b and c and removed label a");
  expect(words(event("labels", [], ["a", "b", "c"]))).toBe("added labels a, b, and c");
  expect(words(event("labels", [], ["a", "b", "c", "d", "e", "f", "g"]))).toBe("added labels a, b, c, d, e, and 2 others");
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
  expect(words(event("weblink", null, { id: "4", name: "Wiki Page" }))).toBe("linked Wiki Page");
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

/** A grouped row's head as the reader sees it: actors, then Linear's grouped wording. */
const group = (...changes: PropertyActivity[]) => {
  const rows = activityRows(changes);
  expect(rows).toHaveLength(1);
  return renderToStaticMarkup(<ActivityRowWords row={rows[0]!} issue={issue} />)
    .replace(/<[^>]+>/g, "")
    .replace(/\s+/g, " ")
    .trim();
};
const time = (minutes: number) => new Date(Date.parse("2026-03-01T09:00:00Z") + minutes * 60_000).toISOString();
const state = (id: string) => ({ id, name: id });

test("F2: Linear's grouped status wording (`so`): two moves, a round trip, and a longer run by its ends", () => {
  expect(group(event("status", state("To Do"), state("Selected")), event("status", state("Selected"), state("Doing"), ada, time(5)))).toBe(
    "Ada Example moved to Selected, then to Doing",
  );
  expect(
    group(
      event("status", state("Selected"), state("To Do")),
      event("status", state("To Do"), state("Doing"), ada, time(5)),
      event("status", state("Doing"), state("Selected"), ada, time(9)),
    ),
  ).toBe("Ada Example moved to Doing, then back to Selected");
  expect(
    group(
      event("status", state("To Do"), state("Selected")),
      event("status", state("Selected"), state("Doing"), ada, time(5)),
      event("status", state("Doing"), state("Review"), ada, time(9)),
    ),
  ).toBe("Ada Example moved from To Do to Review");
});

test("F2: Linear's grouped priority wording (`pc`)", () => {
  expect(group(event("priority", null, "Low"), event("priority", "Low", "High", ada, time(1)))).toBe(
    "Ada Example set priority to Low, then set to High",
  );
  expect(
    group(event("priority", null, "Low"), event("priority", "Low", "High", ada, time(1)), event("priority", "High", null, ada, time(2))),
  ).toBe("Ada Example changed priority a few times before removing it");
});

test("F2: Linear's grouped label wording (`yc`): added, removed, and added and then removed", () => {
  // DRFT-953's agent label: on and off again, then a new label added.
  expect(
    group(
      event("labels", ["x"], ["x", "agent-working"]),
      event("labels", ["x", "agent-working"], ["x"], ada, time(20)),
      event("labels", ["x"], ["x", "agent-working"], ada, time(40)),
      event("labels", ["x", "agent-working"], ["x"], ada, time(41)),
      event("labels", ["x"], ["x", "drift"], ada, time(42)),
    ),
  ).toBe("Ada Example added drift, added and then removed agent-working");
  expect(group(event("labels", ["old"], []), event("labels", [], ["old"], ada, time(3)))).toBe(
    "Ada Example removed and then added old",
  );
  expect(group(event("labels", [], ["a"]), event("labels", ["a", "b"], ["a"], ada, time(3)))).toBe("Ada Example added a and removed b");
});

test("F2: a title group names every actor (`R`)", () => {
  const grace = { id: "grace", name: "Grace Example" };
  expect(group(event("title", "A", "B"), event("title", "B", "C", grace, time(5)))).toBe(
    "Ada Example and Grace Example changed title twice",
  );
});

test("BJ-202: relation type changes within one record use Linear's wording", () => {
  expect(group(event("relation", { key: "ABC-9", kind: "related" }, null), event("relation", null, { key: "ABC-9", kind: "blocking" }))).toBe("Ada Example changed the relation with ABC-9 from related to blocking");
  expect(activityRows([event("relation", { key: "ABC-9", kind: "related" }, null), event("relation", null, { key: "ABC-9", kind: "blocking" }, ada, time(5))])).toHaveLength(2);
});

test("BJ-202: grouped links and cycles use their own summaries", () => {
  expect(group(event("weblink", null, { id: "1", name: "One" }), event("weblink", null, { id: "2", name: "Two" }, ada, time(1)))).toBe("Ada Example added 2 links");
  const sprint = (id: string) => [{ id, name: `Sprint ${id}` }];
  expect(group(event("cycle", null, sprint("1")), event("cycle", sprint("1"), sprint("2"), ada, time(1)))).toBe("Ada Example added issue to Sprint 1 and moved to Sprint 2");
  expect(group(event("cycle", sprint("1"), sprint("2")), event("cycle", sprint("2"), null, ada, time(1)))).toBe("Ada Example moved issue through one cycle and then removed it from Sprint 2");
  expect(words(event("field", { name: "environment", value: "" }, { name: "environment", value: "" }))).toBe("updated the environment");
});

test("3.7: a link row reads Linear's \"linked [source icon] title\" with the Resources row's title, behind the actor's avatar", () => {
  const url = "https://github.com/acme/widgets/pull/1";
  const linked = { ...issue, resources: [{ id: "r1", kind: "link", title: url, url, updated: "", preview: { title: "acme/widgets#1" } }] } as Issue;
  const html = renderToStaticMarkup(<>{describeActivity(event("weblink", null, { id: "7", name: url }), linked)}</>);
  expect(html.replace(/<[^>]+>/g, "").replace(/\s+/g, " ").trim()).toBe("linked acme/widgets#1");
  expect(html).toContain(`src="/api/favicon?origin=${encodeURIComponent("https://github.com")}"`);
  expect(html).toContain(`href="${url}"`);
  expect(html).not.toContain("Web Link");
  const [row] = activityRows([event("weblink", null, { id: "7", name: url })]);
  expect(renderToStaticMarkup(<ActivityIcon row={row!} issue={linked} />)).not.toContain("<svg");
});

