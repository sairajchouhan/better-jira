import { describe, expect, test } from "bun:test";
import { groupTrips, jiraMessagesIn, jiraPath, parseTrip, type Trip } from "./jira-trips";

const SITE = "https://acme.atlassian.net";

describe("jiraPath", () => {
  test.each([
    ["https://acme.atlassian.net/browse/OPS-7", "/browse/:key"],
    ["https://acme.atlassian.net/browse/OPS-7?focusedCommentId=10&page=x", "/browse/:key?focusedCommentId&page"],
    ["https://acme.atlassian.net/jira/software/projects/KAN/boards/12", "/jira/software/projects/:project/boards/:id"],
    ["https://acme.atlassian.net/jira/software/c/projects/KAN/boards/12/backlog", "/jira/software/c/projects/:project/boards/:id/backlog"],
    ["https://acme.atlassian.net/secure/RapidView.jspa?rapidView=12", "/secure/RapidView.jspa?rapidView"],
    ["https://acme.atlassian.net/issues/?jql=summary%20~%20%22secret%20launch%22", "/issues?jql"],
    ["https://acme.atlassian.net/jira/settings/personal/notifications", "/jira/settings/personal/notifications"],
    ["https://acme.atlassian.net/jira/people/5b10a2844c20165700ede21g", "/jira/people/:value"],
    ["https://acme.atlassian.net/wiki/spaces/ENG/pages/123456/Secret+launch+plan", "/wiki/spaces/:space/pages/:id/:value"],
  ])("%s → %s", (url, path) => {
    expect(jiraPath(url, SITE)?.path).toBe(path);
  });

  test("a Confluence page on the site is marked as one; a Jira page isn't", () => {
    expect(jiraPath("https://acme.atlassian.net/wiki/spaces/ENG/overview", SITE)?.confluence).toBe(true);
    expect(jiraPath("https://acme.atlassian.net/browse/OPS-7", SITE)?.confluence).toBe(false);
  });

  test("a page on another site, this app or a bad URL is no trip", () => {
    expect(jiraPath("https://partner.atlassian.net/browse/PX-3", SITE)).toBeNull();
    expect(jiraPath("https://github.com/acme/widgets/pull/42", SITE)).toBeNull();
    expect(jiraPath("http://127.0.0.1:3000/issue/OPS-7", SITE)).toBeNull();
    expect(jiraPath("not a url", SITE)).toBeNull();
  });
});

test("a message is found by its phrase inside longer text", () => {
  expect(jiraMessagesIn("Jira won't change OPS-7 to Bug: it's in another workflow. Use Move in Jira for this change.")).toEqual([
    "move-in-jira",
  ]);
  expect(jiraMessagesIn("Jira didn't answer.")).toEqual([]);
});

const trip = (over: Partial<Trip>): Trip => ({
  id: crypto.randomUUID(),
  time: "2026-11-01T10:00:00.000Z",
  kind: "issue-key",
  path: "/browse/:key",
  screen: "/issue/$key/{-$slug}",
  board: 1,
  issue: "OPS-7",
  ...over,
});
const lines = (trips: object[]) => trips.map((t) => JSON.stringify(t)).join("\n") + "\n";

describe("groupTrips", () => {
  test("groups by kind and path, most frequent first, with each group's count and last time", () => {
    const resent = trip({ kind: "board-settings", path: "/secure/RapidView.jspa?rapidView", time: "2026-11-03T09:00:00.000Z" });
    const text = lines([
      trip({ time: "2026-11-01T10:00:00.000Z" }),
      trip({ time: "2026-11-05T08:30:00.000Z" }),
      trip({ time: "2026-11-02T10:00:00.000Z" }),
      trip({ kind: "description-link", time: "2026-11-04T00:00:00.000Z" }),
      resent,
      resent,
      trip({ kind: "message:board-address", path: null, time: "2026-11-02T00:00:00.000Z" }),
      trip({ kind: "message:board-address", path: null, time: "2026-11-06T00:00:00.000Z" }),
    ]);
    expect(groupTrips(text)).toEqual([
      { kind: "issue-key", path: "/browse/:key", count: 3, last: "2026-11-05T08:30:00.000Z" },
      { kind: "message:board-address", path: null, count: 2, last: "2026-11-06T00:00:00.000Z" },
      { kind: "description-link", path: "/browse/:key", count: 1, last: "2026-11-04T00:00:00.000Z" },
      { kind: "board-settings", path: "/secure/RapidView.jspa?rapidView", count: 1, last: "2026-11-03T09:00:00.000Z" },
    ]);
  });

  test("a line that isn't a trip is skipped", () => {
    const text = `not json\n${JSON.stringify({ ...trip({}), kind: "bad kind!" })}\n${lines([trip({})])}`;
    expect(groupTrips(text)).toEqual([{ kind: "issue-key", path: "/browse/:key", count: 1, last: "2026-11-01T10:00:00.000Z" }]);
  });
});

test("parseTrip keeps only a trip's own fields", () => {
  expect(parseTrip({ ...trip({ id: "a" }), summary: "Secret launch" })).toEqual(trip({ id: "a" }));
  expect(parseTrip({ ...trip({}), issue: "Secret launch plan" })).toBeNull();
  expect(parseTrip({ ...trip({}), path: "browse" })).toBeNull();
});
