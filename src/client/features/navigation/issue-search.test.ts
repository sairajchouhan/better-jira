import { type Issue } from "@/shared/issue-model";
import { expect, test } from "bun:test";
import { matchDocuments, matchesSearchFilters, matchIssues, shorthandKey } from "./issue-search";
import { plainDocument } from "@/shared/document";


const issue = (key: string, summary: string, extra: Partial<Issue> = {}): Issue => ({
  key, board: 1, summary, status: "1", assignee: null, labels: [], comments: 0,
  updated: "2026-11-01T00:00:00Z", resolved: null, ...extra,
});
const map = (...list: Issue[]) => new Map(list.map((i) => [i.key, i]));
const keys = (list: Issue[]) => list.map((i) => i.key);

test("BJ-36: a shorthand key opens that issue, hyphen optional", () => {
  expect(shorthandKey("sam11")).toBe("SAM-11");
  expect(shorthandKey("sam 11")).toBe("SAM-11");
  expect(shorthandKey("Sam-011")).toBeUndefined(); // Linear rejects a zero-padded number
  expect(shorthandKey("login bug")).toBeUndefined();
  const issues = map(issue("SAM-1", "Sam 11 notes"), issue("SAM-11", "Login"), issue("SAM-110", "Other"));
  expect(keys(matchIssues(issues, "sam11"))).toEqual(["SAM-11"]);
  expect(keys(matchIssues(issues, "sam 11"))[0]).toBe("SAM-11");
});

test("BJ-37: a quoted phrase matches only those words in that order", () => {
  const issues = map(issue("A-1", "login page broken"), issue("A-2", "broken login page"), issue("A-3", "page login"));
  expect(keys(matchIssues(issues, '"login page"')).sort()).toEqual(["A-1", "A-2"]);
  expect(keys(matchIssues(issues, '"broken page'))).toEqual([]); // an unclosed quote runs to the end
  expect(keys(matchIssues(issues, 'broken "login page"')).sort()).toEqual(["A-1", "A-2"]);
  expect(keys(matchIssues(issues, "page login")).sort()).toEqual(["A-1", "A-2", "A-3"]);
});

test("BJ-27: descriptions and comments match too, after title matches", () => {
  const issues = map(
    issue("A-1", "Checkout", { description: "Fails on the staging server", updated: "2026-11-05T00:00:00Z" }),
    issue("A-2", "Staging server down"),
    issue("A-3", "Payments", { commentText: "Repro on staging server too" }),
    issue("A-4", "Unrelated"),
  );
  expect(keys(matchIssues(issues, "staging server"))).toEqual(["A-2", "A-1", "A-3"]);
  expect(keys(matchIssues(issues, '"repro on staging"'))).toEqual(["A-3"]);
});

test("BJ-65: search finds documents by title and body text", () => {
  const doc = (id: string, title: string, body: string, updated: string) =>
    ({ id, kind: "document" as const, title, body: plainDocument(body), updated });
  const issues = map(
    issue("A-1", "Parent", { resources: [doc("d1", "Rollout plan", "Ship the beta to staging first", "2026-11-02"), { id: "l", kind: "link", title: "staging", updated: "2026-11-03" }] }),
    issue("A-2", "Other", { resources: [doc("d2", "Staging notes", "Credentials live elsewhere", "2026-11-01")] }),
  );
  const ids = (q: string) => matchDocuments(issues, q).map((m) => m.resource.id);
  expect(ids("staging")).toEqual(["d2", "d1"]); // the title match first; links never match
  expect(ids('"beta to staging"')).toEqual(["d1"]);
  expect(ids("")).toEqual(["d1", "d2"]); // every document, most recently updated first
});

test("BJ-63: search results follow the chosen ordering", () => {
  const issues = map(
    issue("A-1", "login", { updated: "2026-11-01", created: "2026-10-03" }),
    issue("A-2", "a login bug", { updated: "2026-11-03", created: "2026-10-01" }),
    issue("A-3", "the login form", { updated: "2026-11-02", created: "2026-10-02" }),
  );
  expect(keys(matchIssues(issues, "login"))).toEqual(["A-1", "A-2", "A-3"]); // exact title first
  expect(keys(matchIssues(issues, "login", "updatedAt"))).toEqual(["A-2", "A-3", "A-1"]);
  expect(keys(matchIssues(issues, "login", "createdAt"))).toEqual(["A-1", "A-3", "A-2"]);
});

test("BJ-62: @name refines search to that person's issues", () => {
  const alex = { id: "alex", name: "Alex Kim" }, sam = { id: "s1", name: "Sam" };
  const issues = map(issue("A-1", "login bug", { assignee: alex }), issue("A-2", "login page", { assignee: sam }), issue("A-3", "login"));
  expect(keys(matchIssues(issues, "login @alex"))).toEqual(["A-1"]);
  expect(keys(matchIssues(issues, "@kim"))).toEqual(["A-1"]); // any word of the name
  expect(keys(matchIssues(issues, "@sam login")).sort()).toEqual(["A-2"]);
  expect(keys(matchIssues(issues, "login @"))).toHaveLength(3); // a lone @ while the name is typed
});

test("BJ-62: Search filters keep issues with any picked value of each property, all properties applying", () => {
  const issue = { key: "A-1", board: 2, status: "10", priority: "High", labels: ["ui", "perf"] } as Issue;
  const status = () => "In Progress";
  expect(matchesSearchFilters(issue, [], status)).toBe(true);
  expect(matchesSearchFilters(issue, [{ field: "labels", values: ["perf", "docs"] }], status)).toBe(true);
  expect(matchesSearchFilters(issue, [{ field: "status", values: ["In Progress"] }, { field: "board", values: ["2"] }], status)).toBe(true);
  expect(matchesSearchFilters(issue, [{ field: "priority", values: ["High"] }, { field: "board", values: ["1"] }], status)).toBe(false);
  expect(matchesSearchFilters({ ...issue, priority: undefined }, [{ field: "priority", values: ["High"] }], status)).toBe(false);
});
