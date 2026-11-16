import { expect, test } from "bun:test";
import { issueProjection, propertyEntries, watcherList } from "./issue-projection";

/** Jira's `/rest/api/3/field`, trimmed to what discovery reads. */
const siteFields = [
  { id: "summary", name: "Summary" },
  { id: "customfield_10019", name: "Rank", schema: { custom: "com.pyxis.greenhopper.jira:gh-lexo-rank" } },
  { id: "customfield_10020", name: "Sprint", schema: { custom: "com.pyxis.greenhopper.jira:gh-sprint" } },
  { id: "customfield_10016", name: "Story point estimate" },
  { id: "customfield_10028", name: "Story Points" },
  { id: "customfield_10099", name: "Story pointsy" },
];
const avatars = (id: string) => ({
  "16x16": `https://avatar-management--avatars.us-west-2.prod.public.atl-paas.net/${id}/16`,
  "24x24": `https://avatar-management--avatars.us-west-2.prod.public.atl-paas.net/${id}/24`,
  "48x48": `https://avatar-management--avatars.us-west-2.prod.public.atl-paas.net/${id}/48`,
});
const person = (accountId: string, displayName: string) => ({
  self: `https://example.atlassian.net/rest/api/3/user?accountId=${accountId}`,
  accountId,
  displayName,
  avatarUrls: avatars(accountId),
  active: true,
  accountType: "atlassian",
});

/** An agile `/board/{id}/issue` record as Jira sends it: custom fields, sprint, epic parent, ADF with links and media. */
const story = {
  id: "10482",
  key: "CS-142",
  fields: {
    summary: "Ship the importer",
    status: { id: "10001", name: "Done", statusCategory: { key: "done" } },
    issuetype: { name: "Story", iconUrl: "https://example.atlassian.net/story.svg", hierarchyLevel: 0 },
    priority: { name: "High" },
    assignee: person("acc-1", "Ada Lovelace"),
    reporter: person("acc-2", "Grace Hopper"),
    creator: person("acc-3", "Alan Turing"),
    created: "2026-10-01T09:00:00.000+0000",
    updated: "2026-11-02T12:30:00.000+0000",
    resolutiondate: null,
    statuscategorychangedate: "2026-11-02T12:00:00.000+0000",
    duedate: "2026-11-30",
    project: { key: "CS", name: "Content Stack" },
    labels: ["backend", "q4"],
    parent: { key: "CS-100", fields: { summary: "Importer epic", issuetype: { name: "Epic", hierarchyLevel: 1 } } },
    issuelinks: [
      { type: { name: "Blocks" }, outwardIssue: { key: "CS-150" } },
      { type: { name: "Blocks" }, inwardIssue: { key: "CS-90" } },
      { type: { name: "Duplicate" }, outwardIssue: { key: "CS-151" } },
      { type: { name: "Duplicate" }, inwardIssue: { key: "CS-152" } },
      { type: { name: "Relates" }, inwardIssue: { key: "CS-153" } },
      { type: { name: "Relates" } }, // a link to an issue this account can't see
      // An issue outside the board, with the fields Jira sends inside the link; and a link type Linear has no kind for.
      {
        type: { name: "Problem/Incident", inward: "is caused by", outward: "causes" },
        inwardIssue: {
          key: "OPS-12",
          fields: {
            summary: "Importer outage on staging",
            status: { id: "3", name: "In Progress", statusCategory: { key: "indeterminate" } },
            priority: { name: "Normal" },
            issuetype: { name: "Bug" },
          },
        },
      },
    ],
    fixVersions: [{ id: "20001", name: "v2.4", released: false }],
    watches: { watchCount: 3, isWatching: true },
    comment: { total: 4, comments: [] },
    attachment: [
      { id: "30001", filename: "diagram.png", mimeType: "image/png", size: 2048 },
      { id: "30002", filename: "notes.txt", mimeType: "text/plain", size: "512" },
      { id: "not-numeric", filename: "skip.bin" },
    ],
    customfield_10000:
      '{pullrequest={dataType=pullrequest, state=OPEN, stateCount=2}, json={"cachedValue":{"summary":{"pullrequest":{"overall":{"count":2,"state":"OPEN"}}}}}}',
    customfield_10019: "0|i0028f:",
    customfield_10020: [{ id: 37, name: "Sprint 12", state: "active" }],
    customfield_10016: 5,
    customfield_10028: null,
    description: {
      type: "doc",
      version: 1,
      content: [
        {
          type: "paragraph",
          content: [
            { type: "text", text: "See " },
            { type: "text", text: "the spec", marks: [{ type: "link", attrs: { href: "https://docs.test/spec" } }] },
            { type: "text", text: " and https://ci.test/run/9)." },
          ],
        },
        { type: "paragraph", content: [{ type: "inlineCard", attrs: { url: "https://github.com/o/r/pull/7" } }] },
        {
          type: "mediaSingle",
          attrs: { layout: "center" },
          content: [{ type: "media", attrs: { id: "6e1c0a52-2f3c-4b5e-9d7a-1a2b3c4d5e6f", type: "file", collection: "" } }],
        },
      ],
    },
  },
};

test("projects a full Jira record into the board's slim issue", () => {
  expect(issueProjection(siteFields).slim(story)).toStrictEqual({
    key: "CS-142",
    summary: "Ship the importer",
    status: "10001",
    type: "Story",
    typeIcon: "https://example.atlassian.net/story.svg",
    priority: "High",
    assignee: {
      id: "acc-1",
      name: "Ada Lovelace",
      avatar: "https://avatar-management--avatars.us-west-2.prod.public.atl-paas.net/acc-1/48",
    },
    labels: ["backend", "q4"],
    attachments: [
      { id: "30001", name: "diagram.png", type: "image/png", size: 2048, url: "/api/issues/CS-142/attachments/30001" },
      { id: "30002", name: "notes.txt", type: "text/plain", size: 512, url: "/api/issues/CS-142/attachments/30002" },
    ],
    parent: "CS-100",
    // Jira's hierarchy levels, so the epic parent is known as the issue's project (shared/epics.ts).
    level: 0,
    parentLevel: 1,
    rank: "0|i0028f:",
    comments: 4,
    updated: "2026-11-02T12:30:00.000+0000",
    // No resolution set, but the issue is in Done: entering Done is when it resolved.
    resolved: "2026-11-02T12:00:00.000+0000",
    created: "2026-10-01T09:00:00.000+0000",
    creator: {
      id: "acc-3",
      name: "Alan Turing",
      avatar: "https://avatar-management--avatars.us-west-2.prod.public.atl-paas.net/acc-3/48",
    },
    due: "2026-11-30",
    watching: true,
    project: { key: "CS", name: "Content Stack" },
    description: "  See  the spec  and https://ci.test/run/9).    ",
    commentText: undefined,
    milestones: [{ id: "20001", name: "v2.4" }],
    prCount: 2,
    prStatus: "open",
    // "Story Points" (shorter name) is preferred but empty, so the estimate falls back to "Story point estimate".
    estimate: 5,
    links: ["https://docs.test/spec", "https://github.com/o/r/pull/7", "https://ci.test/run/9"],
    relations: [
      { key: "CS-150", kind: "blocking" },
      { key: "CS-90", kind: "blocked" },
      { key: "CS-151", kind: "duplicate" },
      { key: "CS-152", kind: "duplicated" },
      { key: "CS-153", kind: "related" },
      {
        key: "OPS-12",
        kind: "inward:Problem/Incident",
        label: "is caused by",
        issue: { summary: "Importer outage on staging", status: { name: "In Progress", category: "indeterminate" } },
      },
    ],
  });
});

test("a sparse record: missing optional fields project to the app's empty values", () => {
  const sparse = {
    key: "OPS-7",
    fields: { summary: "Bare", status: { id: "1" }, updated: "2026-11-01T00:00:00.000+0000" },
  };
  const issue = issueProjection(siteFields).slim(sparse);
  expect(issue).toStrictEqual({
    key: "OPS-7",
    summary: "Bare",
    status: "1",
    type: undefined,
    typeIcon: undefined,
    priority: undefined,
    assignee: undefined,
    labels: undefined,
    attachments: [],
    parent: undefined,
    level: undefined,
    parentLevel: undefined,
    rank: undefined,
    comments: 0,
    updated: "2026-11-01T00:00:00.000+0000",
    resolved: null,
    created: undefined,
    creator: null,
    due: null,
    watching: false,
    project: { key: "OPS", name: "OPS" },
    description: "",
    commentText: undefined,
    milestones: undefined,
    prCount: undefined,
    prStatus: undefined,
    estimate: undefined,
    links: [],
    relations: [],
  });
  // Stored and served as JSON: the undefined fields drop out.
  expect(Object.keys(JSON.parse(JSON.stringify(issue)))).toEqual([
    "key", "summary", "status", "attachments", "comments", "updated", "resolved",
    "creator", "due", "watching", "project", "description", "links", "relations",
  ]);
});

test("creator falls back to the reporter; an unassigned issue keeps Jira's null; resolutiondate wins over Done", () => {
  const issue = issueProjection(siteFields).slim(
    {
      key: "CS-1",
      fields: {
        ...story.fields,
        creator: undefined,
        assignee: null,
        resolutiondate: "2026-11-01T08:00:00.000+0000",
        description: "Legacy string body with https://plain.test/x and https://site.atlassian.net/browse/CS-2",
      },
    },
  );
  expect(issue.creator?.name).toBe("Grace Hopper");
  expect(issue.assignee).toBeNull();
  expect(issue.resolved).toBe("2026-11-01T08:00:00.000+0000");
  expect(issue.description).toBe("Legacy string body with https://plain.test/x and https://site.atlassian.net/browse/CS-2");
  expect(issueProjection(siteFields).slim({ ...story, fields: { ...story.fields, comment: { total: 2, comments: [
    { body: { type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text: "Repro on staging" }] }] } },
    { body: "Legacy plain comment" },
  ] } } }).commentText).toBe("Repro on staging\nLegacy plain comment");
  // #18: an issue link in the text is a mention, not a resource.
  expect(issue.links).toEqual(["https://plain.test/x"]);
  const mention = issueProjection(siteFields).slim(
    { ...story, fields: { ...story.fields, description: { type: "doc", version: 1, content: [{ type: "paragraph", content: [
      { type: "inlineCard", attrs: { url: "https://site.atlassian.net/browse/CS-2" } },
      { type: "text", text: "CS-3", marks: [{ type: "link", attrs: { href: "https://site.atlassian.net/browse/CS-3" } }] },
      { type: "inlineCard", attrs: { url: "https://github.com/o/r/pull/8" } },
    ] }] } } },
  );
  expect(mention.links).toEqual(["https://github.com/o/r/pull/8"]);
});

test("field discovery: the site's rank and story point IDs, or Jira Cloud's usual ones without a field list", () => {
  const discovered = issueProjection(siteFields);
  expect(discovered.estimates).toEqual(["customfield_10028", "customfield_10016"]);
  expect(discovered.fields.split(",").slice(-3)).toEqual(["customfield_10019", "customfield_10028", "customfield_10016"]);
  const fallback = issueProjection(null);
  expect(fallback.estimates).toEqual(["customfield_10023", "customfield_10016"]);
  expect(fallback.fields.split(",").slice(-3)).toEqual(["customfield_10022", "customfield_10023", "customfield_10016"]);
  // Every request asks for what the projection reads, the description and comments the detail needs, and the PR summary.
  for (const field of ["summary", "description", "comment", "attachment", "issuelinks", "customfield_10000"])
    expect(fallback.fields.split(",")).toContain(field);
  // A site whose rank lives elsewhere: the projection reads that field, not the fallback.
  expect(fallback.slim(story).rank).toBeUndefined();
  expect(discovered.slim(story).rank).toBe("0|i0028f:");
});

test("watchers: complete only when Jira listed everyone it counted", () => {
  expect(watcherList({ watchCount: 2, watchers: [person("a", "A"), person("b", "B")] })).toEqual({
    watchers: [
      { id: "a", name: "A", avatar: "https://avatar-management--avatars.us-west-2.prod.public.atl-paas.net/a/48" },
      { id: "b", name: "B", avatar: "https://avatar-management--avatars.us-west-2.prod.public.atl-paas.net/b/48" },
    ],
    watchersComplete: true,
  });
  expect(watcherList({ watchCount: 3, watchers: [person("a", "A")] }).watchersComplete).toBe(false);
});

test("properties: slim row, project lead and the enrichment for the current revision; stale enrichment counts as pending", () => {
  const p = issueProjection(siteFields);
  const fresh = p.slim(story);
  const stale = p.slim({ ...story, key: "CS-143" });
  const result = propertyEntries(
    [
      {
        key: "CS-142",
        slim: JSON.stringify(fresh),
        source_updated: fresh.updated,
        data: JSON.stringify({
          status: "10001",
          startedAt: "2026-10-02T00:00:00.000+0000",
          watchers: [],
          watchersComplete: false,
          remoteLinks: ["https://docs.test/spec", "https://confluence.test/page"],
          errors: ["Watcher list restricted by Jira permissions"],
        }),
      },
      {
        key: "CS-143",
        slim: JSON.stringify(stale),
        source_updated: "2026-01-01T00:00:00.000+0000",
        data: JSON.stringify({ watchers: [{ id: "old" }] }),
      },
      { key: "OPS-1", slim: JSON.stringify({ key: "OPS-1", updated: "u", project: { key: "OPS" } }), source_updated: null, data: null },
    ],
    0,
  );
  expect(result.progress).toEqual({ total: 3, pending: 2, completed: 1, errors: 1 });
  expect(result.entries["CS-142"]).toEqual({
    ...JSON.parse(JSON.stringify(fresh)),
    status: "10001",
    startedAt: "2026-10-02T00:00:00.000+0000",
    watchers: [],
    watchersComplete: false,
    errors: ["Watcher list restricted by Jira permissions"],
    // Web links join the description's links, once each.
    links: ["https://docs.test/spec", "https://github.com/o/r/pull/7", "https://ci.test/run/9", "https://confluence.test/page"],
  });
  // Enrichment for an older revision is withheld until it is redone.
  expect(result.entries["CS-143"]!.watchers).toBeUndefined();
  expect(result.entries["OPS-1"]).toEqual({ key: "OPS-1", updated: "u", project: { key: "OPS" }, links: [] });
  // The enrichment queue's own count wins while it is larger.
  expect(propertyEntries([], 40).progress).toEqual({ total: 0, pending: 40, completed: 0, errors: 0 });
});

test("BJ-394: slim names every mirrored field and no other, so a tab can clear one a row leaves out", async () => {
  const { MIRRORED_ISSUE_FIELDS } = await import("@/shared/issue-model");
  const expected = MIRRORED_ISSUE_FIELDS.filter((field) => field !== "prNumber").toSorted();
  // Every key, even one whose value is undefined (JSON drops it on the way to the tab).
  expect(Object.keys(issueProjection(siteFields).slim(story)).toSorted()).toEqual(expected);
  expect(Object.keys(issueProjection(siteFields).slim({ key: "TEAM-9", fields: { summary: "S", status: { id: "1" } } })).toSorted()).toEqual(expected);
});
