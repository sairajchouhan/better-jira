import { expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import type { Issue } from "@/shared/issue-model";
import { ActivityEntry, ActivityIcon, ActivityRowWords, ActivityRun, describeActivity, priorityRank, titleChangeLabel, type ActivityItem } from "./activity-entry";
import { DescriptionHistoryProvider } from "./description-history";
import { set } from "@/client/state/store";
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
  // Prod parity #3: Jira shows who had it; Linear's `Os` doesn't, so it is named in Linear's "from X" / "removed … X" pattern.
  expect(words(event("assignee", { id: "u2", name: "Grace" }, { id: "u3", name: "Lin" }))).toBe("re-assigned from Grace to Lin");
  expect(words(event("assignee", null, { id: "ada", name: "Ada Example" }))).toBe("self-assigned the issue");
  expect(words(event("assignee", { id: "u2", name: "Grace" }, { id: "ada", name: "Ada Example" }))).toBe(
    "self-assigned the issue (previously Grace)",
  );
  expect(words(event("assignee", { id: "u2", name: "Grace" }, null))).toBe("removed assignee Grace");
  const year = new Date().getFullYear();
  expect(words(event("due", null, `${year}-11-07`))).toBe("set the due date to Nov 7");
  expect(words(event("due", `${year}-11-07`, `${year}-11-09`))).toBe("changed the due date from Nov 7 to Nov 9");
  expect(words(event("due", `${year}-11-07`, null))).toBe("removed due date");
  // Linear's formatAbsoluteDate adds the year outside this one.
  expect(words(event("due", null, "2019-11-07"))).toBe("set the due date to Nov 7, 2019");
  expect(words(event("parent", null, "ABC-9"))).toBe("set parent to ABC-9");
  expect(words(event("parent", "ABC-8", "ABC-9"))).toBe("changed parent issue from ABC-8 to ABC-9");
  expect(words(event("parent", "ABC-8", null))).toBe("removed parent ABC-8");
  expect(words(event("title", "Old", "New title"))).toBe("changed title to New title");
  expect(renderToStaticMarkup(<>{describeActivity(event("title", "Old", "x".repeat(80)), issue)}</>)).toContain(
    `title="Previously: Old"`,
  );
  // lodash truncate({ length: 70, omission: "…" }): 69 characters and the omission.
  expect(words(event("title", "Old", "x".repeat(80)))).toBe(`changed title to ${"x".repeat(69)}…`);
  expect(words(event("title", "Old", "x".repeat(70)))).toBe(`changed title to ${"x".repeat(70)}`);
  expect(words(event("estimate", null, 2))).toBe("estimated complexity as 2");
  expect(words(event("estimate", 2, 5))).toBe("increased estimate from 2 to 5");
  expect(words(event("estimate", 5, 2))).toBe("lowered estimate from 5 to 2");
  expect(words(event("estimate", 2, null))).toBe("removed estimate");
  // A Jira project move keeps Jira's word: it is the Jira project, not the epic.
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
  // Prod parity #13: the Linear term stays, and says it is Jira's Fix version on hover.
  expect(renderToStaticMarkup(<>{describeActivity(event("milestone", null, { id: "7", name: "Release 1" }), issue)}</>)).toContain(
    'title="Jira Fix version"',
  );
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
  const move = event("project", { id: "1", name: "Old", key: "OLD-1" }, { id: "2", name: "New", key: "NEW-1" });
  const markup = renderToStaticMarkup(<>{describeActivity(move, issue)}</>);
  expect(markup).toContain('title="OLD-1"');
  expect(markup).toContain('title="NEW-1"');
  // Prod parity #10: Jira lists the Key change as its own row; people search by old keys, so they are in the text.
  expect(words(move)).toBe("changed project from Old (OLD-1) to New (NEW-1)");
});

test("prod parity #12: a status change names the resolution its transition set", () => {
  const move = event("status", { id: "qa", name: "QA" }, { id: "rtd", name: "Ready to Deploy", resolution: "Ready to deploy" });
  expect(words(move)).toBe("moved from QA to Ready to Deploy and set resolution to Ready to deploy");
  expect(group(event("status", state("To Do"), state("Doing")), event("status", state("Doing"), { ...state("Done"), resolution: "Wont do" }, ada, time(5)))).toBe(
    "Ada Example moved from To Do to Doing, then to Done and set resolution to Wont do",
  );
});

test("prod parity #20: a field value an app wrote as a link opens as a link", () => {
  const html = renderToStaticMarkup(
    <>{describeActivity(event("field", null, { name: "Associations", value: '&lt;a href="https://example.com/case/1"&gt;CASE-1&lt;/a&gt;' }), issue)}</>,
  );
  expect(html).toContain('href="https://example.com/case/1"');
  expect(html).toContain(">CASE-1</a>");
  const wiki = renderToStaticMarkup(<>{describeActivity(event("field", null, { name: "Associations", value: "[CASE-2|https://example.com/case/2]" }), issue)}</>);
  expect(wiki).toContain('href="https://example.com/case/2"');
  // A script URL is never a link.
  expect(renderToStaticMarkup(<>{describeActivity(event("field", null, { name: "X", value: "[a|javascript:alert(1)]" }), issue)}</>)).not.toContain("href");
});

test("prod parity #8: an \"updated the description\" row opens the description history at its version", () => {
  const edit = event("description", "Steps: a", "Steps: a, b");
  const plain = renderToStaticMarkup(<>{describeActivity(edit, issue)}</>);
  expect(plain).toBe("updated the description");
  const linked = renderToStaticMarkup(
    <DescriptionHistoryProvider issueKey="ABC-1" events={[edit]}>{describeActivity(edit, issue)}</DescriptionHistoryProvider>,
  );
  expect(linked).toContain('title="Show description history"');
  expect(linked).toContain("<button");
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
  // Prod parity #2: Linear's "moved to A, then to B" hides where the run started; Jira shows it, so the start is named.
  expect(group(event("status", state("To Do"), state("Selected")), event("status", state("Selected"), state("Doing"), ada, time(5)))).toBe(
    "Ada Example moved from To Do to Selected, then to Doing",
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
  // Prod parity #6: a label removed, added and removed again ends off, so the summary says removed (Linear's `yc` said
  // "removed and then added", by which came first); added, removed and added again ends on.
  expect(
    group(
      event("labels", ["agent-working"], []),
      event("labels", [], ["agent-working"], ada, time(1)),
      event("labels", ["agent-working"], [], ada, time(2)),
    ),
  ).toBe("Ada Example removed agent-working");
  expect(
    group(event("labels", [], ["flag"]), event("labels", ["flag"], [], ada, time(1)), event("labels", [], ["flag"], ada, time(2))),
  ).toBe("Ada Example added flag");
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


test("prod parity #36: an activity row keeps its icon in its own box and its time in the words' run, so a long row wraps beside the icon", () => {
  const html = renderToStaticMarkup(
    <ActivityEntry id="activity-1" data-activity="status" icon={<svg />} time={<time>2h ago</time>}>
      <span>Ada Example</span> moved from To Do to In Progress
    </ActivityEntry>,
  );
  expect(html).toBe(
    '<li id="activity-1" data-activity="status" class="activity-event"><span class="activity-event-icon"><svg></svg></span>' +
      '<span class="activity-event-text"><span class="activity-event-words"><span>Ada Example</span> moved from To Do to In Progress</span>' +
      ' · <span class="whitespace-nowrap"><time>2h ago</time></span></span></li>',
  );
});

test("R3 G18: the folded \"Show N events\" row keeps its chevron in the icon box, so a long summary wraps beside it", () => {
  const had = Object.getOwnPropertyDescriptor(globalThis, "location");
  if (!had) Object.defineProperty(globalThis, "location", { configurable: true, value: { hash: "" } });
  try {
    const events: ActivityItem[] = Array.from({ length: 9 }, (_, i) => ({
      at: `2025-01-0${i + 1}T10:00:00Z`,
      anchor: `activity-${i}`,
      summary: [{ action: "changed", value: "status", weight: 1 }],
      node: <li key={i}>{i}</li>,
    }));
    const html = renderToStaticMarkup(<ol><ActivityRun events={events} place={{ position: "only" }} /></ol>);
    const folded = /<li data-activity-collapsed="true" class="activity-event">(.*?)<\/li>/.exec(html)?.[1] ?? "";
    expect(folded).toStartWith('<span class="activity-event-icon"><button type="button" aria-label="Expand all activity"');
    expect(/class="activity-event-text">(.*)<\/span>$/.exec(folded)?.[1]?.replace(/<[^>]+>/g, "")).toBe("Show 3 events: changed status…");
  } finally {
    if (!had) Reflect.deleteProperty(globalThis, "location");
  }
});

test("R3 G19: an opened row's detail sits in its own box after the row, as Linear's ActivityHistoryEntry, so the row keeps its line", () => {
  const html = renderToStaticMarkup(
    <ActivityEntry id="activity-1" data-activity="status" icon={<svg />} time={<time>2h ago</time>} detail={<ol aria-label="Grouped changes" />}>
      Ada Example changed status
    </ActivityEntry>,
  );
  expect(html).toBe(
    '<li id="activity-1" data-activity="status" class="activity-event-entry"><div class="activity-event">' +
      '<span class="activity-event-icon"><svg></svg></span><span class="activity-event-text"><span class="activity-event-words">' +
      'Ada Example changed status</span>\u00a0·\u00a0<span class="whitespace-nowrap"><time>2h ago</time></span></span></div>' +
      '<div class="activity-event-detail"><ol aria-label="Grouped changes"></ol></div></li>',
  );
});

test("R3 G21 #36: a relation row's target flows inline in the row's words, key unbroken and title cut to 36, as Linear's `Ao`", () => {
  const relation = { kind: "related", key: "XYZ-12", issue: { summary: "A made-up related issue whose title runs well past the cut", status: { name: "Doing", category: "indeterminate" } } };
  const html = renderToStaticMarkup(<>{describeActivity(event("relation", null, relation), issue)}</>);
  // The hover card's trigger is inline, not an unbreakable inline-flex box that starts its own line.
  expect(html).toMatch(/^added related issue <span class="inline"[^>]*><b class="whitespace-nowrap font-medium">XYZ-12<\/b> A made-up related issue whose title…<\/span>$/);
});

test("R3 G21 #39: a project move's issue keys never break at their hyphen", () => {
  const html = renderToStaticMarkup(
    <>{describeActivity(event("project", { id: "1", name: "Alpha", key: "ALP-7" }, { id: "2", name: "Beta", key: "BET-9" }), issue)}</>,
  );
  expect(html).toContain('<span class="whitespace-nowrap">(ALP-7)</span>');
  expect(html).toContain('<span class="whitespace-nowrap">(BET-9)</span>');
  expect(words(event("project", { id: "1", name: "Alpha", key: "ALP-7" }, { id: "2", name: "Beta", key: "BET-9" }))).toBe(
    "changed project from Alpha (ALP-7) to Beta (BET-9)",
  );
});

test("BJ-262: an epic change reads as Linear's project change (`Qs`) with Epic: added to, removed from, changed epic from", () => {
  const epic = (key: string, summary: string) => ({ key, summary, board: 1, status: "todo", type: "Epic", labels: [] }) as unknown as Issue;
  set({ issues: new Map([["ABC-7", epic("ABC-7", "Checkout revamp")], ["ABC-8", epic("ABC-8", "Payments epic")]]) });
  expect(words(event("epic", null, "ABC-7"))).toBe("added to epic Checkout revamp");
  expect(words(event("epic", "ABC-7", null))).toBe("removed from epic Checkout revamp");
  expect(words(event("epic", "ABC-7", "ABC-8"))).toBe("changed epic from Checkout revamp to Payments epic");
  // Linear's appendWord: the word is left out when the name already says it.
  expect(words(event("epic", null, "ABC-8"))).toBe("added to Payments epic");
  // An epic the mirror doesn't hold is named by its key; the key is on hover either way.
  expect(words(event("epic", null, "ZZ-1"))).toBe("added to epic ZZ-1");
  expect(renderToStaticMarkup(<>{describeActivity(event("epic", null, "ABC-7"), issue)}</>)).toContain(`title="ABC-7"`);
  set({ issues: new Map() });
});
