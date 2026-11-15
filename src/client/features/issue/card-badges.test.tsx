import { expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import type { Issue } from "@/shared/issue-model";
import { LinkBadges } from "./card-badges";

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
