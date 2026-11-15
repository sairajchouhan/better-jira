import { type Board, type Issue } from "@/shared/issue-model";
import { describe, expect, test } from "bun:test";
import {
  collapseAllFrom,
  ORDERINGS,
  PROPERTIES,
  pickLabels,
  boardCells,
  displayHiddenCount,
  buckets,
  canOrderGroups,
  groupVisibility,
  drawnGroups,
  hasEstimates,
  moveGroup,
  orderGroups,
  storedGroupOrder,
  defaultPreferences,
  rankBetween,
  resultsFeedback,
  draftForGroup,
  listRows,
  matchesFilters,
  matchesRule,
  navigationIssues,
  listPosition,
  operatorsFor,
  parentName,
  parsePreferences,
  sameDisplay,
  hasDisplayChanges,
  resetDisplayPreferences,
  selectIssues,
  statusDuration,
  updateFilter,
  type FilterGroup,
  type Rule,
} from "./view-model";


const board: Board = {
  id: 1,
  name: "Board",
  columns: [
    { name: "Todo", statuses: [{ id: "todo", name: "Todo", category: "new" }] },
    { name: "Doing", statuses: [{ id: "doing", name: "In Progress", category: "indeterminate" }] },
    { name: "Done", statuses: [{ id: "done", name: "Done", category: "done" }] },
  ],
};
const now = new Date("2026-11-06T12:00:00Z").getTime();
const issue = (key: string, patch: Partial<Issue> = {}): Issue => ({
  key,
  boards: [1],
  summary: key,
  status: "todo",
  assignee: null,
  labels: [],
  comments: 0,
  updated: "2026-11-06T10:00:00Z",
  resolved: null,
  ...patch,
});
const all = [
  issue("A-1", {
    assignee: { id: "me", name: "Me" },
    priority: "High",
    labels: ["bug", "ui"],
    rank: "c",
    created: "2026-10-01T00:00:00Z",
  }),
  issue("A-2", {
    assignee: { id: "other", name: "Other" },
    priority: "Low",
    labels: ["ui"],
    rank: "a",
    parent: "A-1",
    status: "doing",
    due: "2026-11-07",
  }),
  issue("A-3", { status: "done", resolved: "2026-11-05T12:00:00Z", rank: "b" }),
  issue("A-4", { status: "done", resolved: "2026-10-01T12:00:00Z" }),
];
const rule = (field: Rule["field"], values: string[], op: Rule["op"] = "is"): Rule => ({
  id: field,
  field,
  op,
  values,
});
describe("view selection", () => {
  test("All issues includes older completions and still respects board, mine, and search", () => {
    const prefs = defaultPreferences();
    expect(
      selectIssues([...all, issue("B-1", { boards: [2] })], board, prefs, false, "", "me", now).map(
        (i) => i.key,
      ),
    ).toEqual(["A-4", "A-2", "A-3", "A-1"]);
    // BJ-341: an issue kept on no board (a linked issue opened once) is in no list, not even across boards for My issues.
    const kept = issue("OTHER-9", { boards: [], assignee: { id: "me", name: "Me" } });
    expect(selectIssues([...all, kept], board, prefs, true, "", "me", now, true).map((i) => i.key)).toEqual(["A-1"]);
    // An issue another board holds too is on this one as well.
    expect(
      selectIssues([...all, issue("S-1", { boards: [2, 1] })], board, prefs, false, "", "me", now).map((i) => i.key),
    ).toContain("S-1");
    expect(selectIssues(all, board, prefs, true, "A-1", "me", now).map((i) => i.key)).toEqual([
      "A-1",
    ]);
    prefs.display.subIssues = false;
    expect(selectIssues(all, board, prefs, false, "", "me", now).some((i) => i.key === "A-2")).toBe(
      false,
    );
  });
  test("Active and Backlog use Jira workflow columns rather than treating every new status as backlog", () => {
    const backlogBoard = {
      ...board,
      columns: [
        { name: "Backlog", statuses: [{ id: "backlog", name: "Backlog", category: "new" }] },
        ...board.columns,
      ],
    };
    const issues = [...all, issue("A-5", { status: "backlog" })];
    const prefs = defaultPreferences();
    prefs.scope = "active";
    expect(
      selectIssues(issues, backlogBoard, prefs, false, "", "me", now).map((i) => i.key),
    ).toEqual(["A-2", "A-1"]);
    prefs.scope = "backlog";
    expect(
      selectIssues(issues, backlogBoard, prefs, false, "", "me", now).map((i) => i.key),
    ).toEqual(["A-5"]);
  });
  test("combines multi-value OR within a property and nested AND/OR across properties", () => {
    const group: FilterGroup = {
      id: "root",
      join: "and",
      children: [
        rule("labels", ["bug", "ui"]),
        { id: "or", join: "or", children: [rule("assignee", ["$me"]), rule("priority", ["Low"])] },
      ],
    };
    expect(all.filter((i) => matchesFilters(i, group, all, "me", now)).map((i) => i.key)).toEqual([
      "A-1",
      "A-2",
    ]);
    const next = updateFilter(group, "or", { join: "and" });
    expect(all.some((i) => matchesFilters(i, next, all, "me", now))).toBe(false);
    expect(group.children).toHaveLength(2);
    expect(updateFilter(group, "labels", null).children).toHaveLength(1);
  });
  test("supports missing values, exclusions, content, and parent/child relations", () => {
    expect(matchesRule(all[2]!, rule("assignee", ["$none"]), all, "me", now)).toBe(true);
    expect(matchesRule(all[0]!, rule("labels", ["bug"], "isNot"), all, "me", now)).toBe(false);
    expect(matchesRule(all[0]!, rule("content", ["a-1"], "contains"), all, "me", now)).toBe(true);
    expect(matchesRule(all[0]!, rule("relations", ["parent"]), all, "me", now)).toBe(true);
    expect(matchesRule(all[1]!, rule("relations", ["child"]), all, "me", now)).toBe(true);
  });
  test("handles relative dates, missing dates, and invalid numeric ranges", () => {
    expect(matchesRule(all[1]!, rule("due", ["7"], "next"), all, "me", now)).toBe(true);
    expect(matchesRule(all[2]!, rule("resolved", ["7"], "within"), all, "me", now)).toBe(true);
    expect(matchesRule(all[3]!, rule("resolved", ["7"], "within"), all, "me", now)).toBe(false);
    expect(matchesRule(all[0]!, rule("due", [], "empty"), all, "me", now)).toBe(true);
    expect(matchesRule(all[1]!, rule("due", ["oops"], "next"), all, "me", now)).toBe(false);
  });
  test("groups labels in every matching group and retains empty workflow columns", () => {
    const groups = buckets([all[0]!], "label", board, all);
    expect(groups.find((g) => g.id === "bug")?.issues.map((i) => i.key)).toEqual(["A-1"]);
    expect(groups.find((g) => g.id === "ui")?.issues.map((i) => i.key)).toEqual(["A-1"]);
    expect(buckets([], "status", board).map((g) => g.name)).toEqual(["Todo", "Doing", "Done"]);
    expect(buckets([], "status", board, [], ["Done", "Todo"]).map((g) => g.name)).toEqual(["Done", "Doing", "Todo"]);
  });
  test("orders priority, reverses direction, and keeps undated issues last", () => {
    const p = defaultPreferences();
    p.display.ordering = "priority";
    expect(selectIssues(all, board, p, false, "", "me", now)[0]?.key).toBe("A-1");
    p.display.descending = true;
    expect(selectIssues(all, board, p, false, "", "me", now).at(-1)?.key).toBe("A-1");
    p.display.ordering = "due";
    expect(selectIssues(all, board, p, false, "", "me", now)[0]?.key).toBe("A-2");
  });
  test("saved preferences round-trip and malformed settings fall back without crashing", () => {
    const p = defaultPreferences();
    p.display.layout = "list";
    p.display.properties = [];
    p.filters.children = [rule("assignee", ["$me"])];
    p.scope = "active";
    p.hidden = { status: ["Done"] };
    p.collapsed = { assignee: ["me"] };
    expect(parsePreferences(JSON.parse(JSON.stringify(p)))).toEqual(p);
    const invalid = parsePreferences({
      display: { layout: "bad", columns: "bad", subIssues: false },
      filters: { children: [null, { field: "token", values: [] }] },
    });
    expect(invalid.display.layout).toBe("board");
    expect(invalid.display.subIssues).toBe(false);
    expect(invalid.filters.children).toEqual([]);
    // Hidden and collapsed groups keep only known groupings and string ids; a malformed map reads as none.
    const groups = parsePreferences({ hidden: { status: ["Done", 4], nope: ["x"] }, collapsed: ["status"] });
    expect([groups.hidden, groups.collapsed]).toEqual([{ status: ["Done"] }, {}]);
  });
  test("unfinished OR branches do not override completed filters", () => {
    const group: FilterGroup = {
      id: "root",
      join: "or",
      children: [
        rule("assignee", ["$me"]),
        rule("priority", []),
        { id: "empty", join: "and", children: [] },
      ],
    };
    expect(all.filter((i) => matchesFilters(i, group, all, "me", now)).map((i) => i.key)).toEqual([
      "A-1",
    ]);
  });
  test("list navigation follows nested display order and handles cycles once", () => {
    expect(
      listRows([all[1]!, all[0]!], all, "matching").map((r) => [r.issue.key, r.depth]),
    ).toEqual([
      ["A-1", 0],
      ["A-2", 1],
    ]);
    expect(listRows([all[0]!], all, "all").map((r) => r.issue.key)).toEqual(["A-1", "A-2"]);
    const cycle = [issue("C-1", { parent: "C-2" }), issue("C-2", { parent: "C-1" })];
    expect(listRows(cycle, cycle, "matching")).toHaveLength(2);
  });
  test("issue-page navigation skips repeated cards in overlapping label groups", () => {
    const groups = buckets([all[0]!, all[1]!], "label", board, all).map((g) => g.issues);
    expect(groups.flat().filter((i) => i.key === "A-1")).toHaveLength(2);
    expect(navigationIssues(groups).map((i) => i.key)).toEqual(["A-1", "A-2"]);
  });
  test("the issue stepper shows only for an issue in a list of two or more, as Linear's jf", () => {
    expect(listPosition([all[0]!, all[1]!], "A-2")).toEqual({ index: 1, total: 2 });
    expect(listPosition([all[0]!, all[1]!], "Z-9")).toBeUndefined();
    expect(listPosition([all[0]!], "A-1")).toBeUndefined();
    expect(listPosition([], "A-1")).toBeUndefined();
  });
  test("column and row creation carries type, priority and assignee defaults into the draft", () => {
    expect(draftForGroup("type", "Bug", board, all, "active")).toEqual({ type: "Bug" });
    expect(draftForGroup("priority", "$none", board, all, "active")).toEqual({ priority: "" });
    expect({
      ...draftForGroup("status", "Doing", board, all, "active"),
      ...draftForGroup("assignee", "me", board, all, "active"),
    }).toEqual({ status: "doing", assignee: { id: "me", name: "Me" } });
    const withBacklog = {
      ...board,
      columns: [
        { name: "Backlog", statuses: [{ id: "backlog", name: "Backlog", category: "new" }] },
        ...board.columns,
      ],
    };
    expect(draftForGroup("category", "new", withBacklog, all, "active")).toEqual({
      status: "todo",
    });
  });
  test("filters watcher lists only when complete and supports milestone and numeric status duration", () => {
    const item = issue("A-5", {
      watchers: [{ id: "me", name: "Me" }],
      watchersComplete: true,
      milestones: [{ id: "release", name: "Release" }],
      prCount: 0,
      statusSince: "2026-10-30T12:00:00Z",
    });
    expect(matchesRule(item, rule("watchers", ["$me"]), all, "me", now)).toBe(true);
    expect(
      matchesRule(
        { ...item, watchersComplete: false },
        rule("watchers", ["$none"]),
        all,
        "me",
        now,
      ),
    ).toBe(false);
    expect(
      matchesRule(
        { ...item, watchersComplete: false },
        rule("watchers", ["other"], "isNot"),
        all,
        "me",
        now,
      ),
    ).toBe(false);
    expect(matchesRule(item, rule("milestone", ["release"]), all, "me", now)).toBe(true);
    expect(matchesRule(item, rule("statusAge", ["6.5"], "gt"), all, "me", now)).toBe(true);
    expect(matchesRule(item, rule("pullRequests", ["0"]), all, "me", now)).toBe(true);
    // R3-views-filters-D-3: an issue without Jira's Development field has no pull requests, so it counts as 0.
    expect(
      matchesRule({ ...item, prCount: undefined }, rule("pullRequests", ["0"]), all, "me", now),
    ).toBe(true);
    expect(
      matchesRule({ ...item, prCount: undefined }, rule("pullRequests", ["1"], "lt"), all, "me", now),
    ).toBe(true);
  });
  test("persists enriched properties and formats status duration without negative ages", () => {
    const p = defaultPreferences();
    p.display.properties = ["milestone", "statusAge", "pullRequests"];
    p.display.ordering = "estimate";
    p.filters.children = [rule("watchers", ["$me"]), rule("statusAge", ["7"], "gt")];
    expect(parsePreferences(JSON.parse(JSON.stringify(p)))).toEqual(p);
    expect(statusDuration("2026-11-06T13:00:00Z", now)).toBe("<1m");
    expect(statusDuration("2026-11-06T11:00:00Z", now)).toBe("1h");
    expect(statusDuration("2026-11-04T12:00:00Z", now)).toBe("2d");
  });
  test("every supported filter property distinguishes a match from a nonmatch", () => {
    const rich = issue("A-5", {
      summary: "Personal draft",
      description: "A description",
      assignee: { id: "me", name: "Me" },
      creator: { id: "me", name: "Me" },
      priority: "High",
      labels: ["ui"],
      project: { key: "P", name: "Jira project" },
      type: "Bug",
      parent: "A-0",
      relations: [{ key: "A-1", kind: "blocking" }],
      links: ["https://example.com"],
      created: "2026-11-01",
      updated: "2026-11-05",
      due: "2026-11-07",
      resolved: "2026-11-05",
      started: "2026-11-02",
      statusSince: "2026-11-05",
      milestones: [{ id: "m1", name: "Release" }],
      watchers: [{ id: "me", name: "Me" }],
      watchersComplete: true,
      prCount: 2,
      estimate: 3,
    });
    const cases: [Rule["field"], Rule["op"], string, string][] = [
      ["status", "is", "todo", "doing"],
      ["assignee", "is", "$me", "other"],
      ["creator", "is", "$me", "other"],
      ["priority", "is", "High", "Low"],
      ["labels", "is", "ui", "api"],
      ["relations", "is", "blocking", "blocked"],
      // Project is the epic (A-0, below) and Project properties are its fields, never the Jira project.
      ["project", "is", "A-0", "P"],
      ["projectStatus", "is", "doing", "todo"],
      ["projectPriority", "is", "Urgent", "High"],
      ["projectLabels", "is", "roadmap", "ui"],
      ["type", "is", "Bug", "Task"],
      // A-0 is an epic: it is A-5's project, so A-5 has no parent issue (shared/epics.ts parentOf).
      ["parent", "is", "$none", "A-0"],
      ["milestone", "is", "m1", "other"],
      ["watchers", "is", "$me", "other"],
      ["projectLead", "is", "$me", "other"],
      ["content", "contains", "personal", "absent"],
      ["links", "contains", "example.com", "absent"],
      ["created", "after", "2026-10-01", "2026-12-01"],
      ["updated", "after", "2026-10-01", "2026-12-01"],
      ["due", "before", "2026-12-01", "2026-10-01"],
      ["resolved", "before", "2026-12-01", "2026-10-01"],
      ["started", "after", "2026-10-01", "2026-12-01"],
      ["statusAge", "gt", "0.5", "10"],
      ["pullRequests", "gt", "1", "3"],
      ["estimate", "gt", "2", "4"],
    ];
    const epic = issue("A-0", {
      type: "Epic",
      status: "doing",
      priority: "Urgent",
      labels: ["roadmap"],
      assignee: { id: "me", name: "Me" },
    });
    for (const [field, op, matching, other] of cases) {
      expect(matchesRule(rich, rule(field, [matching], op), [...all, epic, rich], "me", now)).toBe(true);
      expect(matchesRule(rich, rule(field, [other], op), [...all, epic, rich], "me", now)).toBe(false);
    }
  });
});

test("B2: rankBetween lands strictly between its neighbours in code-unit order", () => {
  const ranks = ["0|i00000:", "0|i00001:", "0|i0000a:", "0|i0000b:"];
  for (let i = 0; i <= ranks.length; i++) {
    const r = rankBetween(ranks[i - 1], ranks[i]);
    if (i > 0) expect(r > ranks[i - 1]!).toBe(true);
    if (i < ranks.length) expect(r < ranks[i]!).toBe(true);
  }
  const ranked = [
    issue("R-1", { rank: "a" }),
    issue("R-2", { rank: "B" }),
    issue("R-3", { rank: "_" }),
  ];
  expect(
    selectIssues(ranked, board, defaultPreferences(), false, "", "me").map((i) => i.key),
  ).toEqual(["R-2", "R-3", "R-1"]);
  let low = "0|i00000:",
    high = "0|i00001:";
  for (let n = 0; n < 50; n++) {
    const mid = rankBetween(low, high);
    expect(mid > low && mid < high).toBe(true);
    high = mid;
  }
});

describe("QA round 1 (G7)", () => {
  test("R1-D32: an emptied Match any root reverts to AND, on removal and on reload", () => {
    const or: FilterGroup = { id: "root", join: "or", children: [rule("labels", ["ui"])] };
    expect(updateFilter(or, "labels", null).join).toBe("and");
    expect(updateFilter(or, "root", null).join).toBe("and");
    expect(
      parsePreferences({ filters: { id: "root", join: "or", children: [] } }).filters.join,
    ).toBe("and");
  });
  test("R1-D39: the Links filter matches Jira web links kept as link resources", () => {
    const linked = issue("L-1", {
      resources: [
        { id: "r", kind: "link", title: "Marker", updated: "", url: "https://example.com/marker" },
      ],
    });
    expect(matchesRule(linked, rule("links", ["example.com"], "contains"), [linked], "me")).toBe(
      true,
    );
  });
  test("R1-D40/D88: enum fields offer is / is not (+ empty), never text operators; Status is never empty", () => {
    const ops = (f: Rule["field"]) => operatorsFor(f).map(([op]) => op);
    expect(ops("status")).toEqual(["is", "isNot"]);
    expect(ops("priority")).toEqual(["is", "isNot", "empty", "notEmpty"]);
    expect(ops("pullRequests")).toContain("empty");
    expect(ops("estimate")).toContain("notEmpty");
    const none = issue("P-1", { prCount: 0 });
    expect(matchesRule(none, rule("pullRequests", [], "empty"), [none], "me")).toBe(true);
  });
  test("R1-D41: completed by recency falls back to the time the issue entered Done", () => {
    const done = [
      issue("D-1", { status: "done", statusSince: "2026-11-05T18:01:05Z", created: "2026-10-01" }),
      issue("D-2", { status: "done", statusSince: "2026-11-05T18:19:44Z", created: "2026-10-02" }),
    ];
    const prefs = defaultPreferences();
    prefs.display.ordering = "created";
    prefs.display.descending = true; // ascending by age: D-1 first
    expect(selectIssues(done, board, prefs, false, "", "me").map((i) => i.key)).toEqual([
      "D-1",
      "D-2",
    ]);
    prefs.display.completedRecency = true;
    expect(selectIssues(done, board, prefs, false, "", "me").map((i) => i.key)).toEqual([
      "D-2",
      "D-1",
    ]);
  });
  test("R2-D2: completed by recency is one order whatever the ordering, direction or open issues", () => {
    const list = [
      issue("KAN-145", {
        status: "done",
        resolved: "2026-11-08T20:17:12.698Z",
        rank: "b",
        created: "1",
      }),
      issue("KAN-146", { status: "todo", rank: "a", created: "4" }),
      issue("KAN-147", {
        status: "done",
        resolved: "2026-11-08T20:17:16.312Z",
        rank: "c",
        created: "2",
      }),
      issue("KAN-148", { status: "doing", rank: "e", created: "6" }),
      issue("KAN-150", {
        status: "done",
        resolved: "2026-11-08T20:17:16.177Z",
        rank: "d",
        created: "3",
      }),
      issue("KAN-151", { status: "todo", rank: "f", created: "5" }),
    ];
    for (const ordering of ["manual", "created", "title"] as const)
      for (const descending of [false, true]) {
        const prefs = defaultPreferences();
        Object.assign(prefs.display, { ordering, descending, completedRecency: true });
        const keys = selectIssues(list, board, prefs, false, "", "me").map((i) => i.key);
        expect(keys.filter((k) => ["KAN-145", "KAN-147", "KAN-150"].includes(k))).toEqual([
          "KAN-147",
          "KAN-150",
          "KAN-145",
        ]);
      }
  });
  test("R2-D3: Overdue stays relative to today", () => {
    const overdue = rule("due", ["P0D"], "before");
    const day = (d: string) => new Date(`${d}T12:00:00`).getTime();
    const due = (d: string) => issue("D-1", { due: d });
    expect(matchesRule(due("2026-11-07"), overdue, [], "me", day("2026-11-08"))).toBe(true);
    expect(matchesRule(due("2026-11-08"), overdue, [], "me", day("2026-11-08"))).toBe(false);
    expect(matchesRule(due("2026-11-08"), overdue, [], "me", day("2026-11-09"))).toBe(true);
  });
  test("FILTER-12: operators read by value count and field kind, and labels match any or all of their values", () => {
    const label = (f: Rule["field"], count: number) => operatorsFor(f, count).map(([, l]) => l);
    expect(label("status", 1)).toEqual(["is", "is not"]);
    expect(label("status", 2)).toEqual(["is any of", "is not"]);
    expect(label("labels", 1)).toEqual(["include", "do not include", "is empty", "is not empty"]);
    expect(label("labels", 2)).toEqual([
      "include all of",
      "include any of",
      "exclude if any of",
      "exclude if all",
      "is empty",
      "is not empty",
    ]);
    const both = issue("L-1", { labels: ["ui", "api"] }),
      one = issue("L-2", { labels: ["ui"] });
    const all = rule("labels", ["ui", "api"], "isAll"),
      notAll = rule("labels", ["ui", "api"], "notAll");
    expect([both, one].map((i) => matchesRule(i, all, [], "me"))).toEqual([true, false]);
    expect([both, one].map((i) => matchesRule(i, notAll, [], "me"))).toEqual([false, true]);
  });
  test("R2-D5: issue type is never empty in Jira, so it offers no empty operators", () => {
    expect(operatorsFor("type").map(([op]) => op)).toEqual(["is", "isNot"]);
  });
  test("R1-D90: display equality ignores the order properties were toggled in", () => {
    const a = defaultPreferences().display;
    expect(sameDisplay(a, { ...a, properties: [...a.properties].reverse() })).toBe(true);
    expect(sameDisplay(a, { ...a, properties: a.properties.slice(1) })).toBe(false);
  });
  test("BJ-208: Reset is Linear's disregardSettings: display, hidden groups and group order go; collapsed groups stay", () => {
    const baseline = defaultPreferences().display;
    const prefs = {
      ...defaultPreferences(),
      display: { ...baseline, layout: "list" as const },
      hidden: { status: ["done"], assignee: ["me"] },
      order: { status: ["done", "todo"] },
      collapsed: { status: ["todo"] },
    };
    expect(hasDisplayChanges(prefs, baseline)).toBe(true);
    const reset = { ...prefs, ...resetDisplayPreferences(baseline) };
    expect(reset.display).toEqual(baseline);
    expect(reset.display).not.toBe(baseline);
    expect([reset.hidden, reset.order, reset.collapsed]).toEqual([{}, {}, { status: ["todo"] }]);
    expect(hasDisplayChanges(reset, baseline)).toBe(false);
    // Hidden groups or a group order alone are user changes (the toolbar's dot and the Reset footer); collapsed are not.
    expect(hasDisplayChanges({ ...reset, hidden: { status: ["done"] } }, baseline)).toBe(true);
    expect(hasDisplayChanges({ ...reset, order: { status: ["done"] } }, baseline)).toBe(true);
    expect(hasDisplayChanges({ ...reset, hidden: { assignee: ["me"] } }, baseline)).toBe(false);
  });
  test("R1-D91: parent groups and choices show the parent's title", () => {
    expect(parentName("A-1", [issue("A-1", { summary: "Epic title" })])).toBe("A-1 Epic title");
    expect(buckets(all, "parent", board).find((b) => b.id === "A-1")?.name).toBe("A-1 A-1");
  });
});

describe("board layout", () => {
  test("boardCells splits each column by swimlane, and one lane of everything leaves the columns whole", () => {
    const columns = buckets(all, "status", board);
    const lanes = buckets(all, "assignee", board);
    const cells = boardCells(columns, lanes);
    const keys = cells.map((lane) => lane.map((cell) => cell.map((i) => i.key)));
    expect(lanes.map((l) => l.name)).toEqual(["Me", "Other", "No assignee"]);
    expect(keys).toEqual([[["A-1"], [], []], [[], ["A-2"], []], [[], [], ["A-3", "A-4"]]]);
    expect(boardCells(columns, buckets(all, "none", board))[0]).toEqual(columns.map((c) => c.issues));
  });
  test("resultsFeedback counts without temporary narrowing, keeping a saved view's own filters", () => {
    const prefs = defaultPreferences();
    prefs.filters = { id: "f", join: "and", children: [rule("assignee", ["me"])] };
    const none = { overlay: { id: "o", join: "and" as const, children: [] }, query: "", mine: false };
    expect(resultsFeedback(all, board, prefs, null, none, false, "me", now)).toEqual({ baseline: 4, temporary: false });
    const view = { board: 1, filters: { id: "v", join: "and" as const, children: [rule("status", ["done"])] }, mine: false };
    expect(resultsFeedback(all, board, prefs, view, { ...none, query: "A" }, false, "me", now)).toEqual({ baseline: 2, temporary: true });
    expect(resultsFeedback(all, board, prefs, null, { ...none, mine: true }, false, "me", now).temporary).toBe(true);
    expect(resultsFeedback(all, board, prefs, { ...view, mine: true }, { ...none, mine: true }, false, "me", now)).toEqual({ baseline: 0, temporary: false });
  });
});

test("BJ-38: completed windows use resolution or status entry and preserve open issues", () => {
  const all = [issue("open"), issue("today", { status: "done", resolved: "2026-11-06T10:00:00Z" }),
    issue("week", { status: "done", resolved: null, statusSince: "2026-11-02T10:00:00Z" }),
    issue("month", { status: "done", resolved: "2026-10-20T10:00:00Z" }),
    issue("old", { status: "done", resolved: "2025-01-01T00:00:00Z" }),
    issue("unknown", { status: "done", resolved: null })];
  for (const [window, count] of [["all", 6], ["day", 2], ["week", 3], ["month", 4], ["none", 1]] as const) {
    const prefs = defaultPreferences();
    prefs.display.completedIssues = window;
    expect(selectIssues(all, board, prefs, false, "", "me", now)).toHaveLength(count);
    expect(parsePreferences(prefs).display.completedIssues).toBe(window);
  }
  expect(parsePreferences({ display: { completedIssues: "invalid" } }).display.completedIssues).toBe("all");
});

test("BJ-61: display hidden counts respect filters and reveal duplicate label groups once", () => {
  const all = [issue("open"), issue("child", {parent:"open"}), issue("done", {status:"done"})];
  const prefs = defaultPreferences();
  prefs.display.subIssues = false;
  prefs.display.completedIssues = "none";
  expect(displayHiddenCount(all, board, prefs, false, "", "me", now)).toBe(2);
  expect(displayHiddenCount(all, board, prefs, false, "open", "me", now)).toBe(0);
  prefs.display.subIssues = true;
  prefs.display.completedIssues = "all";
  expect(displayHiddenCount(all, board, prefs, false, "", "me", now)).toBe(0);
  prefs.hidden.status = ["Todo"];
  expect(displayHiddenCount(all, board, prefs, false, "", "me", now)).toBe(2);
});

describe("group ordering (BJ-205)", () => {
  const g = (...ids: string[]) => ids.map((id) => ({ id }));
  const ids = (groups: { id: string }[]) => groups.map((x) => x.id);
  test("orderGroups puts stored groups in their own slots in stored order, as Linear's Nat does", () => {
    expect(ids(orderGroups(g("a", "b", "c", "d"), ["c", "a"]))).toEqual(["c", "b", "a", "d"]);
    expect(ids(orderGroups(g("a", "b", "c"), []))).toEqual(["a", "b", "c"]);
  });
  test("orderGroups keeps a new group in its default slot and skips stale or repeated ids", () => {
    expect(ids(orderGroups(g("a", "new", "b", "c"), ["c", "gone", "b", "a", "c"]))).toEqual(["c", "new", "b", "a"]);
    expect(ids(orderGroups(g("a", "b"), ["gone"]))).toEqual(["a", "b"]);
  });
  test("moveGroup moves a group onto its target's slot, up or down", () => {
    expect(moveGroup(["a", "b", "c", "d"], "a", "c")).toEqual(["b", "c", "a", "d"]);
    expect(moveGroup(["a", "b", "c", "d"], "d", "b")).toEqual(["a", "d", "b", "c"]);
    expect(moveGroup(["a", "b"], "a", "a")).toEqual(["a", "b"]);
  });
  test("storedGroupOrder keeps stored ids of groups not on screen after the new order", () => {
    expect(storedGroupOrder(["b", "a"], ["a", "x", "b"])).toEqual(["b", "a", "x"]);
  });
  test("only groupings with a custom order offer Group ordering", () => {
    expect(canOrderGroups("status")).toBe(true);
    expect(canOrderGroups("assignee")).toBe(true);
    expect(canOrderGroups("priority")).toBe(false);
    expect(canOrderGroups("none")).toBe(false);
  });
  test("groupVisibility hides user-hidden groups, and empty ones while Show empty groups is off", () => {
    const prefs = defaultPreferences();
    prefs.display.columns = "status";
    prefs.hidden = { status: ["Doing"] };
    const columns = buckets([all[0]!, all[1]!], "status", board, all);
    prefs.display.emptyGroups = false;
    let v = groupVisibility(columns, prefs);
    expect(v.show.map((c) => c.name)).toEqual(["Todo"]);
    expect(v.hidden.map((c) => c.name)).toEqual(["Doing", "Done"]);
    expect(v.hiddenIds).toEqual(["Doing"]);
    prefs.display.emptyGroups = true;
    v = groupVisibility(columns, prefs);
    expect(v.show.map((c) => c.name)).toEqual(["Todo", "Done"]);
  });
  test("BJ-331: while the zero state shows, no group is drawn, shown or hidden; an empty unfiltered board keeps its groups", () => {
    const prefs = defaultPreferences();
    prefs.display.columns = "status";
    prefs.display.emptyGroups = true;
    prefs.hidden = { status: ["Doing"] };
    const none = groupVisibility(buckets([], "status", board, all), prefs);
    expect(none.hidden.map((c) => c.name)).toEqual(["Doing"]);
    expect(drawnGroups(none, true)).toMatchObject({ show: [], hidden: [], hiddenIds: ["Doing"] });
    expect(drawnGroups(none, false)).toBe(none);
  });
  test("BJ-334: a board has estimates only when one of its issues carries one; no board means every board", () => {
    const issues = new Map(all.map((i) => [i.key, { ...i, estimate: undefined } as Issue]));
    expect(hasEstimates(issues, board.id)).toBe(false);
    const other = new Map([...issues, ["X-1", { ...all[0]!, key: "X-1", boards: [board.id + 1], estimate: 3 } as Issue]]);
    expect(hasEstimates(other, board.id)).toBe(false);
    expect(hasEstimates(other)).toBe(true);
    expect(hasEstimates(other, board.id + 1)).toBe(true);
  });
  test("a stored order round-trips through saved preferences and malformed orders are dropped", () => {
    const prefs = defaultPreferences();
    prefs.order = { status: ["Done", "Todo"] };
    expect(parsePreferences(JSON.parse(JSON.stringify(prefs))).order).toEqual({ status: ["Done", "Todo"] });
    expect(parsePreferences({ ...prefs, order: "oops" }).order).toEqual({});
    expect(parsePreferences({ ...prefs, order: { status: [1, "Done"] } }).order.status ?? []).not.toContain(1);
  });
  test("the hidden-by-display count includes issues in a group the user hid", () => {
    const prefs = defaultPreferences();
    prefs.display.columns = "status";
    const base = displayHiddenCount(all, board, prefs, false, "", "me", now);
    prefs.hidden = { status: ["Todo"] };
    expect(displayHiddenCount(all, board, prefs, false, "", "me", now)).toBe(base + 1);
  });
});

test("board Display options use Linear's link wording; pickLabels reads the shared table (BJ-215)", () => {
  expect(ORDERINGS.find(([id]) => id === "links")?.[1]).toBe("Link count");
  expect(PROPERTIES.find(([id]) => id === "links")?.[1]).toBe("Links");
  expect(pickLabels(ORDERINGS, ["links", "due"])).toEqual([
    ["links", "Link count"],
    ["due", "Due date"],
  ]);
  expect(() => pickLabels(PROPERTIES, ["nope" as never])).toThrow();
});

test("toggle-all gives every group the opposite of the clicked group's state (Linear's `Bit` toggleAllGroups)", () => {
  const groups = ["todo", "doing", "done"];
  // The clicked group is open while another is collapsed: every group collapses.
  expect(collapseAllFrom(["done"], groups, "todo").sort()).toEqual(["doing", "done", "todo"]);
  // The clicked group is collapsed while the others are open: every group opens.
  expect(collapseAllFrom(["todo"], groups, "todo")).toEqual([]);
  // Collapsed groups of other groupings' ids outside `groups` are kept.
  expect(collapseAllFrom(["gone", "todo"], groups, "todo")).toEqual(["gone"]);
});
