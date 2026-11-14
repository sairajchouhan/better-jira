import { expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import type { InboxItem } from "@/shared/inbox-model";
import { set } from "@/client/state/store";
import { InboxNotification, Row } from "./inbox";

// Made-up notification only.
const row = {
  id: "n-out",
  key: "OUT-3",
  title: "A made-up issue outside the mirror",
  actor: { name: "Kim", avatar: "" },
  kind: "comment",
  message: "Kim commented on a task",
  preview: "A long made-up comment. ".repeat(40).trim(),
  time: "2026-11-01T10:00:00Z",
  status: "Doing",
  link: "https://cloudsairaj.atlassian.net/browse/OUT-3?focusedCommentId=1",
  commentId: "1",
  category: "direct",
  count: 1,
} as unknown as InboxItem;

test("R3 G21: the pane's head comment for an issue outside the mirror is clamped to three lines, as the grouped cards", () => {
  const html = renderToStaticMarkup(<InboxNotification row={row} />);
  expect(html).toMatch(/<blockquote data-comment-card[^>]*><div [^>]*data-lines="3"[^>]*>.*A long made-up comment/);
  expect(html).toContain("View comment");
});

test("R3 G22 #29: the pane's head comment card holds the comment's plain text, as Linear's card (bodyTextContent), so the clamp counts its lines", () => {
  const html = renderToStaticMarkup(
    <InboxNotification row={{ ...row, preview: "First made-up paragraph, with more. A made-up point" } as InboxItem} />,
  );
  // A rich doc's root is a flow-root box: Chrome's -webkit-line-clamp stops counting lines at it, and the card grew to 588 px.
  const clamp = html.match(/<div [^>]*data-lines="3"[^>]*>(.*?)<\/div>/)?.[1];
  expect(clamp).toBe("First made-up paragraph, with more. A made-up point");
});

test("R3 G22: a row's accessible name has the status its icon shows (the issue's current one), not the one at notification time", () => {
  set({
    boards: [{ id: 1, name: "Board", columns: [{ name: "QA", statuses: [{ id: "qa", name: "QA", category: "indeterminate" }] }] }],
    issues: new Map([["OUT-3", { key: "OUT-3", board: 1, summary: "A made-up issue", status: "qa" } as any]]),
  } as any);
  const html = renderToStaticMarkup(<Row item={{ ...row, issueType: "Bug", status: "To Do" } as InboxItem} selected={false} now={Date.parse("2026-11-02T10:00:00Z")} onMenu={() => {}} />);
  expect(html).toMatch(/aria-label="[^"]*· Bug, QA /);
  expect(html).toContain('title="QA"');
});
