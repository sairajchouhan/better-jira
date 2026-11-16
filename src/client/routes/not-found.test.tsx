import { expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { NOT_FOUND_MESSAGE } from "@/client/components/not-found";
import { NotFound } from "./tree";
import { IssueDocument } from "./issue-document";
import type { Issue } from "@/shared/issue-model";

// BJ-403: Linear's 404 (`N9`): "<Model> not found" over "We could not find the page you were looking for", with its
// illustration and no button. Ours said "Issue SAM1-9999 not found / Jira has no such issue…" with a Go to your board button.
test("BJ-403: an unknown issue's page reads Linear's words: Issue not found, its message, no key and no button", () => {
  const html = renderToStaticMarkup(<NotFound data={{ entity: "Issue" }} />);
  expect(html).toContain(">Issue not found</h2>");
  expect(html).toContain(NOT_FOUND_MESSAGE);
  expect(NOT_FOUND_MESSAGE).toBe("We could not find the page you were looking for");
  expect(html).toContain('viewBox="0 0 130 155"');
  expect(html).not.toMatch(/Jira has no such issue|Go to your board|<a |<button/);
  const bare = renderToStaticMarkup(<NotFound data={undefined} />);
  expect(bare).toContain(">Not found</h2>");
  expect(bare).not.toContain("Page not found");
});

test("BJ-403: a document the issue doesn't hold reads Linear's Document not found, with the page illustration", () => {
  const issue = { key: "ZZ-1", resources: [] } as unknown as Issue;
  const html = renderToStaticMarkup(<IssueDocument issue={issue} id="gone" />);
  expect(html).toContain(">Document not found</h2>");
  expect(html).toContain(NOT_FOUND_MESSAGE);
  expect(html).toContain('viewBox="0 0 80 106"');
  expect(html).not.toContain("Back to issue");
});
