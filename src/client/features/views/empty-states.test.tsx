import { expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { PersonEmptyState, ScopeEmptyState } from "./empty-states";
import { ResultsFeedback } from "./views-navigation";
import { resultFeedback } from "./views-navigation-model";

// BJ-336: My issues with nothing assigned drew blank columns. The empty answer now renders the page's own empty state
// (MyIssuesEmptyPage), and no filter message.
test("an empty My issues tab draws Linear's MyIssuesEmptyPage, line per tab, with Create new issue", () => {
  const html = renderToStaticMarkup(
    <ResultsFeedback feedback={resultFeedback(0, 0, "person", false)} empty={<PersonEmptyState tab="assigned" person={null} />} clear={() => {}} />,
  );
  expect(html).toContain("No issues assigned to you");
  expect(html).toContain("Create new issue");
  expect(html).not.toContain("matching");
  expect(renderToStaticMarkup(<PersonEmptyState tab="subscribed" person={null} />)).toContain("No issues you are subscribed to");
});

test("an empty board tab draws its ViewEmptyState in Jira's words: a space, no Cycles", () => {
  const html = renderToStaticMarkup(
    <ResultsFeedback feedback={resultFeedback(0, 0, "tab", false)} empty={<ScopeEmptyState scope="backlog" />} clear={() => {}} />,
  );
  expect(html).toContain("Backlog issues");
  expect(html).toContain("When your space is ready");
  expect(html).not.toMatch(/Cycle|team/);
  expect(renderToStaticMarkup(<ScopeEmptyState scope="active" />)).toContain("no active issues in this space");
});
