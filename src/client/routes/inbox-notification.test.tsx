import { expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import type { InboxItem } from "@/shared/inbox-model";
import { InboxNotification } from "./inbox";

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
