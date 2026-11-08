import { expect, test } from "bun:test";
import { mergeOps, opsFor, renameCommentIds, renameIds } from "./jira-ops";
import type { Issue } from "./store";

const base: Issue = {
  key: "A-1",
  board: 1,
  summary: "One",
  status: "1",
  assignee: null,
  labels: ["x"],
  comments: 0,
  updated: "",
  resolved: null,
  rank: "b",
  priority: "High",
};
const doc = (text: string) => ({
  type: "doc" as const,
  version: 1 as const,
  content: [{ type: "paragraph", content: [{ type: "text", text }] }],
});

test("an edit's before and after become the Jira ops that reproduce it", () => {
  const after: Issue = {
    ...base,
    summary: "Two",
    status: "2",
    assignee: { id: "u1", name: "U" },
    labels: ["y"],
    priority: undefined,
    due: "2026-11-20",
    parent: "A-0",
    milestones: [{ id: "7", name: "v1" }],
    estimate: 3,
    activity: [],
    reminder: { at: "x" },
  };
  expect(opsFor({ issue: base }, { issue: after }, new Map())).toEqual([
    {
      op: "fields",
      fields: {
        summary: "Two",
        priority: null,
        assignee: "u1",
        labelEdits: { add: ["y"], remove: ["x"] },
        due: "2026-11-20",
        parent: "A-0",
        milestones: ["7"],
        estimate: 3,
      },
    },
    { op: "status", status: "2" },
  ]);
  // Local-only fields and reordered labels are not Jira changes.
  expect(
    opsFor(
      { issue: { ...base, labels: ["a", "b"] } },
      { issue: { ...base, labels: ["b", "a"], reminder: { at: "x" }, activity: [] } },
      new Map(),
    ),
  ).toEqual([]);
});

test("descriptions come from the full record and ranks name a neighbour", () => {
  const full = (text: string) => ({ key: "A-1", fields: { description: doc(text) } });
  expect(
    opsFor({ issue: base, full: full("a") }, { issue: base, full: full("b") }, new Map()),
  ).toEqual([{ op: "fields", fields: { description: doc("b") } }]);
  const peers = new Map<string, Issue>([
    ["A-2", { ...base, key: "A-2", rank: "a" }],
    ["A-3", { ...base, key: "A-3", rank: "c" }],
    ["B-1", { ...base, key: "B-1", board: 2, rank: "bb" }],
  ]);
  expect(opsFor({ issue: base }, { issue: { ...base, rank: "d" } }, peers)).toEqual([
    { op: "rank", after: "A-3" },
  ]);
  expect(
    opsFor({ issue: { ...base, rank: "z" } }, { issue: { ...base, rank: "0" } }, peers),
  ).toEqual([{ op: "rank", before: "A-2" }]);
});

test("queued ops for one issue fold together with later values winning", () => {
  expect(
    mergeOps(
      [
        { op: "fields", fields: { summary: "a", labels: [] } },
        { op: "status", status: "1" },
      ],
      [
        { op: "fields", fields: { summary: "b" } },
        { op: "status", status: "2" },
        { op: "rank", after: "X" },
      ],
    ),
  ).toEqual([
    { op: "fields", fields: { summary: "b", labels: [] } },
    { op: "status", status: "2" },
    { op: "rank", after: "X" },
  ]);
});

test("creates, deletes, comments and links become Jira ops", () => {
  const created: Issue = {
    ...base,
    key: "A-NEW1",
    assignee: { id: "u1", name: "U" },
    parent: "A-0",
    project: { key: "A", name: "A" },
    relations: [{ key: "A-2", kind: "blocking" }],
  };
  expect(
    opsFor(
      {},
      { issue: created, full: { key: "A-NEW1", fields: { description: doc("d") } } },
      new Map(),
    ),
  ).toEqual([
    {
      op: "create",
      fields: {
        summary: "One",
        priority: "High",
        assignee: "u1",
        labels: ["x"],
        parent: "A-0",
        project: "A",
        status: "1",
        description: doc("d"),
      },
    },
    { op: "link", target: "A-2", kind: "blocking" },
  ]);
  expect(opsFor({ issue: base }, {}, new Map())).toEqual([{ op: "delete" }]);
  // relate() edits both issues: blocking sends, blocked (target loaded) doesn't; symmetric kinds send from the lower key.
  const both = new Map([
    ["A-1", base],
    ["A-2", { ...base, key: "A-2" }],
  ]);
  expect(
    opsFor(
      { issue: { ...base, key: "A-2" } },
      {
        issue: {
          ...base,
          key: "A-2",
          relations: [
            { key: "A-1", kind: "blocked" },
            { key: "A-1", kind: "related" },
          ],
        },
      },
      both,
    ),
  ).toEqual([]);
  expect(
    opsFor(
      { issue: { ...base, relations: [{ key: "A-2", kind: "related" }] } },
      { issue: base },
      both,
    ),
  ).toEqual([{ op: "link", target: "A-2", kind: "related", remove: true }]);
  // Duplicates are directional: the duplicate sends whatever the key order; the duplicated side only when the other isn't loaded.
  expect(
    opsFor(
      { issue: { ...base, key: "A-2" } },
      { issue: { ...base, key: "A-2", relations: [{ key: "A-1", kind: "duplicate" }] } },
      both,
    ),
  ).toEqual([{ op: "link", target: "A-1", kind: "duplicate" }]);
  expect(
    opsFor(
      { issue: base },
      { issue: { ...base, relations: [{ key: "A-2", kind: "duplicated" }] } },
      both,
    ),
  ).toEqual([]);
  const comment = (id: string, text: string, parentId?: string) => ({
    id,
    body: doc(text),
    created: "",
    ...(parentId ? { parentId } : {}),
  });
  const full = (...comments: any[]) => ({
    key: "A-1",
    fields: { comment: { comments, total: comments.length } },
  });
  expect(
    opsFor(
      { issue: base, full: full(comment("1", "a"), comment("2", "b")) },
      {
        issue: { ...base, commentStates: { "1": { body: doc("a2") }, "2": { deleted: true } } },
        full: full(comment("1", "a"), comment("2", "b"), comment("local-3", "c", "1")),
      },
      new Map(),
    ),
  ).toEqual([
    { op: "comment.edit", id: "1", body: doc("a2") },
    { op: "comment.delete", id: "2" },
    { op: "comment", ref: "local-3", body: doc("c"), parentId: "1" },
  ]);
  // Link resources are Jira web links keyed by URL; documents stay local.
  const link = (url: string, title: string) => ({
    id: url,
    kind: "link" as const,
    url,
    title,
    updated: "",
  });
  expect(
    opsFor(
      { issue: { ...base, resources: [link("https://a", "A"), link("https://b", "B")] } },
      {
        issue: {
          ...base,
          resources: [
            link("https://a", "A2"),
            { id: "d", kind: "document", title: "Doc", updated: "" },
          ],
        },
      },
      new Map(),
    ),
  ).toEqual([
    { op: "weblink", url: "https://a", title: "A2" },
    { op: "weblink", url: "https://b", title: "B", remove: true },
  ]);
  // Undo of an added comment removes it from Jira.
  expect(
    opsFor(
      { issue: base, full: full(comment("9", "x")) },
      { issue: base, full: full() },
      new Map(),
    ),
  ).toEqual([{ op: "comment.delete", id: "9" }]);
});

test("label edits merge as adds and removes; comment ids rename only where comments sit", () => {
  expect(
    mergeOps(
      [{ op: "fields", fields: { labelEdits: { add: ["a"], remove: ["b"] } } }],
      [{ op: "fields", fields: { labelEdits: { add: ["b"], remove: ["a", "c"] } } }],
    ),
  ).toEqual([{ op: "fields", fields: { labelEdits: { add: ["b"], remove: ["a", "c"] } } }]);
  const ids = new Map([["10002", "10005"]]);
  expect(
    renameCommentIds<any>(
      {
        issue: {
          status: "10002",
          commentStates: { "10002": { reactions: ["x"] } },
          attachments: [{ id: "10002" }],
        },
        full: {
          fields: {
            comment: { comments: [{ id: "10002", parentId: "10002", author: { id: "10002" } }] },
          },
        },
        ops: [
          { op: "status", status: "10002" },
          { op: "comment.edit", id: "10002" },
        ],
      },
      ids,
    ),
  ).toEqual({
    issue: {
      status: "10002",
      commentStates: { "10005": { reactions: ["x"] } },
      attachments: [{ id: "10002" }],
    },
    full: {
      fields: {
        comment: { comments: [{ id: "10005", parentId: "10005", author: { id: "10002" } }] },
      },
    },
    ops: [
      { op: "status", status: "10002" },
      { op: "comment.edit", id: "10005" },
    ],
  });
});

test("Jira's new ids replace app ids wherever they appear", () => {
  expect(
    renameIds(
      {
        key: "A-NEW1",
        ops: [{ op: "comment", ref: "local-1", parentId: "local-1" }],
        summary: "A-NEW1 x",
      },
      new Map([
        ["A-NEW1", "A-11"],
        ["local-1", "100"],
      ]),
    ),
  ).toEqual({
    key: "A-11",
    ops: [{ op: "comment", ref: "100", parentId: "100" }],
    summary: "A-NEW1 x",
  });
});

test("image thread comments become Jira comments, and their ids rename to Jira's", () => {
  const at = (comments: { id: string; text: string }[]): Issue => ({
    ...base,
    mediaEdits: {
      m1: {
        crop: { x: 0, y: 0, width: 0.5, height: 0.5 },
        comments: comments.map((c) => ({ ...c, author: "Me", at: "" })),
      },
    },
  });
  const body = (text: string) => ({
    type: "doc" as const,
    version: 1 as const,
    content: [{ type: "paragraph", content: [{ type: "text", text }] }],
  });
  expect(opsFor({ issue: base }, { issue: at([{ id: "u1", text: "Look" }]) }, new Map())).toEqual([
    { op: "comment", ref: "u1", body: body("Look") },
  ]);
  expect(
    opsFor(
      { issue: at([{ id: "10", text: "Look" }]) },
      { issue: at([{ id: "10", text: "Look here" }]) },
      new Map(),
    ),
  ).toEqual([{ op: "comment.edit", id: "10", body: body("Look here") }]);
  expect(opsFor({ issue: at([{ id: "10", text: "Look" }]) }, { issue: at([]) }, new Map())).toEqual(
    [{ op: "comment.delete", id: "10" }],
  );
  expect(
    opsFor(
      { issue: { ...base, mediaEdits: { m1: { crop: { x: 0, y: 0, width: 1, height: 1 } } } } },
      { issue: at([]) },
      new Map(),
    ),
  ).toEqual([]);
  expect(
    renameCommentIds(at([{ id: "u1", text: "Look" }]).mediaEdits, new Map([["u1", "10"]]))?.m1
      ?.comments?.[0]?.id,
  ).toBe("10");
});
