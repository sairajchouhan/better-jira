import { expect, test } from "bun:test";
import {
  mentionDraft,
  replyParent,
  visibleComments,
  visibleCommentTotal,
  validCommentStates,
  type IssueComment,
} from "./comment-thread";
const body = { type: "doc" as const, version: 1 as const, content: [] };
const comments: IssueComment[] = [
  { id: "jira-1", body, created: "now" },
  { id: "local-1", parentId: "jira-1", body, created: "now" },
  { id: "jira-2", body, created: "now" },
];
test("local comment metadata overlays a fresh Jira response and preserves server totals", () => {
  const changed = {
    ...body,
    content: [{ type: "paragraph", content: [{ type: "text", text: "Edited locally" }] }],
  };
  expect(visibleComments(comments, { "jira-1": { body: changed } })[0]?.body).toEqual(changed);
  // Deleting a root here moves its replies to the orphan thread at once, as Jira's answer will (R1-D52).
  expect(
    visibleComments(comments, { "jira-1": { deleted: true } }).map((c) => [c.id, c.orphanedFrom]),
  ).toEqual([
    ["local-1", "jira-1"],
    ["jira-2", undefined],
  ]);
  expect(visibleCommentTotal(15, comments, { "jira-1": { deleted: true } })).toBe(14);
  expect(
    validCommentStates({ "jira-1": { resolved: true, reactions: ["💙"], body: changed } }),
  ).toBe(true);
  expect(validCommentStates({ "jira-1": { resolved: "yes" } })).toBe(false);
});
test("a recovered thread remains connected when its remote ancestor returns", () => {
  const orphan: IssueComment = { id: "local-1", parentId: "jira-1", body, created: "now" },
    reply: IssueComment = { id: "local-2", parentId: "local-1", body, created: "now" };
  // A reply to a reply joins the thread: Jira rejects a reply whose parent is itself a reply.
  expect(replyParent([orphan], orphan.id)).toBe("jira-1");
  expect(replyParent([comments[0]!, orphan], orphan.id)).toBe("jira-1");
  expect(replyParent([comments[0]!, orphan, reply], reply.id)).toBe("jira-1");
  expect(replyParent([comments[0]!, orphan], "missing")).toBeUndefined();
  expect(replyParent([comments[0]!, orphan], orphan.id, { "jira-1": { deleted: true } })).toBe(
    "jira-1",
  );
  expect(visibleComments([orphan, reply]).map((c) => [c.id, c.parentId])).toEqual([
    ["local-1", undefined],
    ["local-2", "local-1"],
  ]);
  expect(visibleComments([comments[0]!, orphan, reply]).map((c) => [c.id, c.parentId])).toEqual([
    ["jira-1", undefined],
    ["local-1", "jira-1"],
    ["local-2", "jira-1"],
  ]);
  expect(
    visibleComments([comments[0]!, orphan, reply], { "jira-1": { deleted: true } }).map((c) => [
      c.id,
      c.parentId,
    ]),
  ).toEqual([
    ["local-1", undefined],
    ["local-2", "local-1"],
  ]);
});
test("replies of a comment deleted in Jira stay one thread filed under its id", () => {
  const thread: IssueComment[] = [
    { id: "11", parentId: "10", body, created: "1" },
    { id: "12", body, created: "2" },
    { id: "13", parentId: "10", body, created: "3" },
  ];
  expect(visibleComments(thread).map((c) => [c.id, c.parentId, c.orphanedFrom])).toEqual([
    ["11", undefined, "10"],
    ["12", undefined, undefined],
    ["13", "11", undefined],
  ]);
  expect(replyParent(thread, "13")).toBe("10");
  expect(replyParent(thread, "12")).toBe("12");
});
test("a reply to a reply starts with one @mention of its author", () => {
  const author = { accountId: "acc-1", displayName: "Alex" },
    mention = { type: "mention", attrs: { id: "acc-1", text: "@Alex", accessLevel: "" } },
    started = mentionDraft(body, author);
  expect(started.content).toEqual([
    { type: "paragraph", content: [mention, { type: "text", text: " " }] },
  ]);
  expect(mentionDraft(started, author)).toBe(started);
  const typed = {
    ...body,
    content: [{ type: "paragraph", content: [{ type: "text", text: "draft" }] }],
  };
  // A saved draft keeps its text first: the caret opens at the end, after the mention (R3-comments-D5).
  expect(mentionDraft(typed, author).content?.[0]?.content).toEqual([
    { type: "text", text: "draft" },
    { type: "text", text: " " },
    mention,
    { type: "text", text: " " },
  ]);
  expect(mentionDraft(body, undefined)).toBe(body);
});
