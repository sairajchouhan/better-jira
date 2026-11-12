import { expect, test } from "bun:test";
import { issueResources, typedResourceURL, type IssueResource } from "./issue-resource";

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
