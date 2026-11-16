import { expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import type { Issue } from "@/shared/issue-model";
import { LinkBadges, PullRequestBadge, pullRequestBadgeReads } from "./card-badges";

const issue: Issue = {
  key: "TEST-7",
  boards: [1],
  summary: "Badges",
  status: "todo",
  assignee: null,
  labels: [],
  updated: "",
  resolved: null,
  comments: 1,
};

test("R3-board-D3: a Jira web link is named by its Jira title; the badge keeps the short URL name (Linear's `vt`)", () => {
  const url = "https://example.com/qa-board";
  const html = renderToStaticMarkup(<LinkBadges issue={{ ...issue, links: [url], linkTitles: { [url]: "Board spec" } }} />);
  expect(html).toContain('aria-label="Open link Board spec on TEST-7"');
  expect(renderToStaticMarkup(<LinkBadges issue={{ ...issue, links: [url] }} />)).not.toContain("Board spec");
});

test("a single pull request's badge draws its number from the issue on first paint, without reading the list", () => {
  const one = { ...issue, key: "TEST-8", prCount: 1, prStatus: "open", prNumber: "#2965" } as const;
  const html = renderToStaticMarkup(<PullRequestBadge issue={one} layout="board" />);
  expect(html).toContain(">#2965<");
  expect(html).not.toContain("data-placeholder");
  expect(pullRequestBadgeReads(one)).toBe(false);
  // Several: no number to read.
  expect(pullRequestBadgeReads({ prCount: 2, prStatus: "open" })).toBe(false);
});

test("a single pull request's badge without its number yet reads the list and holds the number's room meanwhile", () => {
  const unread = { ...issue, key: "TEST-9", prCount: 1, prStatus: "open" } as const;
  expect(pullRequestBadgeReads(unread)).toBe(true);
  // Linked by Jira's development index only: the state comes from the list.
  expect(pullRequestBadgeReads({ prCount: 1, prNumber: "#4" })).toBe(true);
  const html = renderToStaticMarkup(<PullRequestBadge issue={unread} layout="board" />);
  expect(html).toContain('aria-hidden="true" data-placeholder=""');
  expect(html).toContain("#0000");
  // Several pull requests say "N PRs" at once: no room held.
  expect(renderToStaticMarkup(<PullRequestBadge issue={{ ...unread, prCount: 2 }} layout="board" />)).not.toContain("data-placeholder");
});

test("a pull request menu opened while the list loads takes the rows when it lands, instead of keeping 'Loading…'", async () => {
  // The menu keeps the rows it opened with (action-menu.tsx `Level`); the badge's `version` remounts it once when the list lands.
  const badge = await Bun.file(new URL("./card-badges.tsx", import.meta.url)).text();
  const menu = await Bun.file(new URL("../../components/action-menu.tsx", import.meta.url)).text();
  expect(badge).toContain('version={data ? "loaded" : "loading"}');
  expect(menu).toMatch(/<ActionMenu key=\{version\}/);
});
