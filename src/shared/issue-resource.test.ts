import { expect, test } from "bun:test";
import { issueResources, linkDescription, linkTitle, typedResourceURL, type IssueResource } from "./issue-resource";

test("R2-issue-fields-D10: a typed bare domain links over https; other schemes stay rejected", () => {
  expect(typedResourceURL("example.com/qa-if2")).toBe("https://example.com/qa-if2");
  expect(typedResourceURL(" example.com:8080/x ")).toBe("https://example.com:8080/x");
  expect(typedResourceURL("http://example.com/a")).toBe("http://example.com/a");
  expect(typedResourceURL("javascript:alert(1)")).toBeNull();
  expect(typedResourceURL("ftp://example.com")).toBeNull();
  expect(typedResourceURL("not a link")).toBeNull();
});

test("F3: mirrored URLs and titled Jira resources display once while pending local links survive", () => {
  const resource = (id: string, url: string, title: string): IssueResource => ({
    id,
    kind: "link",
    url,
    title,
    updated: "",
  });
  const app = resource("local-app", "https://example.com/app", "App-added link"),
    jira = resource("jira", "https://example.com/jira", "Jira-added link"),
    pending = resource("pending", "https://example.com/pending", "Pending local link"),
    doc: IssueResource = { id: "doc", kind: "document", title: "Document", updated: "" };
  const issue = {
    resources: [app, jira, pending, doc],
    links: [app.url!, jira.url!, "https://example.com/legacy"],
    updated: "2026-11-10",
  };
  const shown = issueResources(issue);
  expect(shown).toEqual([
    app,
    jira,
    pending,
    doc,
    {
      id: "legacy:https://example.com/legacy",
      kind: "link",
      title: "https://example.com/legacy",
      url: "https://example.com/legacy",
      updated: issue.updated,
    },
  ]);
  // The same merge after reload, and after Jira confirms removal of the app link.
  expect(issueResources(structuredClone(issue))).toEqual(shown);
  expect(issueResources({ ...issue, resources: [jira, pending, doc], links: [jira.url!] })).toEqual(
    [jira, pending, doc],
  );
});

test("#8: a GitHub link reads as Linear names it, without the page's text; other links show the unfurled page", () => {
  const link = (url: string, title = url): IssueResource => ({
    id: url,
    kind: "link",
    title,
    url,
    updated: "",
    preview: { title: "Fix ?? operator · Issue #1 · oven-sh/bun", description: "Page text" },
  });
  const shown = (r: IssueResource) => [linkTitle(r), linkDescription(r)];
  expect(shown(link("https://github.com/oven-sh/bun/pull/1"))).toEqual(["oven-sh/bun#1", undefined]);
  expect(shown(link("https://github.com/oven-sh/bun/issues/22"))).toEqual(["oven-sh/bun#22", undefined]);
  expect(shown(link("https://github.com/oven-sh/bun/releases/tag/bun-v1.2"))).toEqual(["oven-sh/bun bun-v1.2", undefined]);
  expect(shown(link("https://github.com/oven-sh/bun"))).toEqual(["oven-sh/bun", undefined]);
  // A title someone gave the link stays, and a page elsewhere keeps its unfurl.
  expect(shown(link("https://github.com/oven-sh/bun/pull/1", "Mine"))).toEqual(["Mine", "Page text"]);
  expect(shown(link("https://example.com/a"))).toEqual(["Fix ?? operator · Issue #1 · oven-sh/bun", "Page text"]);
});
