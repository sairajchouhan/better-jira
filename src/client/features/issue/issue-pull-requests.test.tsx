import { expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { queryClient } from "@/client/state/server-data";
import type { Issue } from "@/shared/issue-model";
import type { PullRequest } from "@/shared/pull-requests";
import { PullRequestCard, PullRequestsCardContent } from "./card-badges";
import { IssueDiffs, IssuePullRequestRow, PullRequestList } from "./issue-pull-requests";

const issue: Issue = {
  key: "TEST-9",
  board: 1,
  summary: "Pull requests in the sidebar",
  status: "todo",
  assignee: null,
  labels: [],
  updated: "",
  resolved: null,
  comments: 0,
};
const pr = (n: number, status: PullRequest["status"], extra: Partial<PullRequest> = {}): PullRequest => ({
  url: `https://github.com/acme/app/pull/${n}`,
  title: `Change ${n}`,
  number: `#${n}`,
  status,
  repo: "app",
  updated: `2026-11-${String(n).padStart(2, "0")}T10:00:00Z`,
  ...extra,
});
const rowNumbers = (html: string) => [...html.matchAll(/data-pull-request-row="([^"]+)"/g)].map((m) => m[1]);

test("the issue sidebar opens with a Diffs section listing its pull requests, open before merged, each opening in a new tab", () => {
  const withPrs = { ...issue, prCount: 2, prStatus: "open" as const };
  queryClient.setQueryData(["pull-requests", withPrs.key, 2, "open"], [pr(5, "merged"), pr(3, "open")]);
  const html = renderToStaticMarkup(<IssueDiffs issue={withPrs} />);
  expect(html).toContain(">Diffs</h3>");
  expect(rowNumbers(html)).toEqual(["#3", "#5"]);
  expect(html).toContain('href="https://github.com/acme/app/pull/3" target="_blank"');
});

test("an issue without pull requests shows no Diffs section", () => {
  queryClient.setQueryData(["pull-requests", issue.key, 0, ""], []);
  expect(renderToStaticMarkup(<IssueDiffs issue={issue} />)).toBe("");
});

test("an open pull request's row carries its review: changes requested (red X) over approved (green check)", () => {
  const blocked = renderToStaticMarkup(<IssuePullRequestRow pr={pr(1, "approved", { changesRequested: true })} />);
  expect(blocked).toContain('aria-label="Change 1, Changes requested"');
  expect(blocked).toContain('data-review-status="blocked"');
  const approved = renderToStaticMarkup(<IssuePullRequestRow pr={pr(2, "approved")} />);
  expect(approved).toContain('aria-label="Change 2, Approved"');
  expect(approved).toContain('data-review-status="approved"');
  const merged = renderToStaticMarkup(<IssuePullRequestRow pr={pr(3, "merged", { changesRequested: true })} />);
  expect(merged).toContain('aria-label="Change 3"');
  expect(merged).not.toContain("data-review-status");
});

test("three rows show, the rest under Show N more; two closed ones fold under N closed", () => {
  const five = [1, 2, 3, 4, 5].map((n) => pr(n, "open"));
  const html = renderToStaticMarkup(<PullRequestList prs={five} collapseKey="test-five" />);
  expect(rowNumbers(html)).toEqual(["#1", "#2", "#3"]);
  expect(html).toContain("Show 2 more");
  const closed = renderToStaticMarkup(<PullRequestList prs={[pr(1, "open"), pr(2, "declined"), pr(3, "declined")]} collapseKey="test-closed" />);
  expect(rowNumbers(closed)).toEqual(["#1"]);
  expect(closed).toContain("2 closed");
});

test("the row's card is Linear's pull request card: title, repository and number, the status without reviews", () => {
  const html = renderToStaticMarkup(<PullRequestCard pr={pr(21, "inReview", { changesRequested: true, author: "ana-dev" })} />);
  expect(html).toContain("Change 21");
  expect(html).toContain(">app#21<");
  expect(html).toContain(">Open</span>");
  expect(html).toContain('aria-label="Changes requested"');
});

test("the card's status line says how long ago a merged pull request merged", () => {
  const closedAt = new Date(Date.now() - 3 * 24 * 3600_000).toISOString();
  const html = renderToStaticMarkup(<PullRequestCard pr={pr(22, "merged", { closedAt })} />);
  expect(html).toContain(">Merged 3d ago</span>");
});

const cards = (html: string) => [...html.matchAll(/data-pull-request-card="([^"]+)"/g)].map((m) => m[1]);
const rows = (html: string) => [...html.matchAll(/data-pull-request="([^"]+)"/g)].map((m) => m[1]);

test("the badge's hover for one pull request is Linear's pull request card (Vhn → PK), the same one the sidebar row shows", () => {
  const html = renderToStaticMarkup(<PullRequestsCardContent prs={[pr(7, "inReview", { changesRequested: true, author: "ana-dev" })]} />);
  expect(cards(html)).toEqual(["#7"]);
  expect(rows(html)).toEqual([]);
  expect(html).toContain(">Open</span>");
  expect(html).toContain('aria-label="Changes requested"');
});

test("the badge's hover for several is Linear's rows (Whn): identifier · status under the title, three, then Show N more", () => {
  const prs = [
    pr(1, "inReview", { owner: "acme", changesRequested: true, author: "ana-dev" }),
    pr(2, "merged", { closedAt: new Date(Date.now() - 2 * 3600_000).toISOString() }),
    pr(3, "open"),
    pr(4, "open"),
    pr(5, "open"),
  ];
  const html = renderToStaticMarkup(<PullRequestsCardContent prs={prs} />);
  expect(cards(html)).toEqual([]);
  expect(rows(html)).toEqual(["#1", "#2", "#3"]);
  expect(html).toContain("Show 2 more");
  // The author is the row's trailing avatar, not part of the line.
  expect(html).toContain(">acme/app#1 · Changes requested</span>");
  expect(html).toContain(">app#2 · Merged 2h ago</span>");
  // The icon's native tooltip is the status.
  expect(html).toContain('title="Changes requested"');
});
