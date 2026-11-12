import { expect, test } from "bun:test";
import { smartLink, smartLinkText, tinyCode, tinyPageId } from "./smart-link";

// Made-up URLs in the shapes the BJ-16 survey of work Jira found in smart-link nodes.
const title = (url: string, data?: unknown) => {
  const link = smartLink(url, data);
  return link?.kind === "issue" ? link.key : link?.title;
};

test("BJ-16: a Jira /browse/ link on any Atlassian site is an issue, with its comment anchors and board views", () => {
  expect(smartLink("https://acme.atlassian.net/browse/OPS-12")).toEqual({
    kind: "issue",
    url: "https://acme.atlassian.net/browse/OPS-12",
    site: "https://acme.atlassian.net",
    key: "OPS-12",
  });
  expect(smartLink("https://acme.atlassian.net/browse/OPS-12?focusedCommentId=1")).toMatchObject({ kind: "issue", key: "OPS-12" });
  expect(smartLink("https://partner.atlassian.net/browse/PX-3#comment")).toMatchObject({ kind: "issue", site: "https://partner.atlassian.net" });
  expect(smartLink("https://acme.atlassian.net/jira/software/projects/OPS/boards/1?selectedIssue=OPS-9")).toMatchObject({ kind: "issue", key: "OPS-9" });
  // Not an issue key: the Jira page is an ordinary link.
  expect(smartLink("https://acme.atlassian.net/browse/not-a-key")).toMatchObject({ kind: "external" });
});

test("BJ-16: Confluence pages carry their ID and the URL's slug as a title until the page's own is read", () => {
  expect(smartLink("https://acme.atlassian.net/wiki/spaces/ENG/pages/4680876044/Release+checklist+%26+FAQ")).toEqual({
    kind: "confluence",
    url: "https://acme.atlassian.net/wiki/spaces/ENG/pages/4680876044/Release+checklist+%26+FAQ",
    site: "https://acme.atlassian.net",
    pageId: "4680876044",
    title: "Release checklist & FAQ",
  });
  expect(smartLink("https://acme.atlassian.net/wiki/spaces/ENG/pages/123")).toMatchObject({ pageId: "123", title: "Confluence page" });
  expect(smartLink("https://acme.atlassian.net/wiki/spaces/ENG/overview")).toMatchObject({ title: "ENG space" });
  expect(smartLink(`https://acme.atlassian.net/wiki/x/${tinyCode("4680876044")}`)).toMatchObject({ pageId: "4680876044" });
  // Jira's resolver data names the page.
  expect(title("https://acme.atlassian.net/wiki/spaces/ENG/pages/1/x", { name: "Runbook" })).toBe("Runbook");
});

test("BJ-16: Confluence's short link is the page ID's little-endian bytes in base64", () => {
  expect(tinyPageId("AQ")).toBe("1");
  expect(tinyPageId("AAE")).toBe("256");
  for (const id of ["1", "98765", "4294967296", "4680876044"]) expect(tinyPageId(tinyCode(id))).toBe(id);
  expect(tinyPageId("not valid!")).toBeUndefined();
});

test("BJ-16: other sites get a readable title from the URL, never a fetch", () => {
  expect(title("https://github.com/acme/widgets/pull/42")).toBe("acme/widgets#42");
  expect(title("https://github.com/acme/widgets/pull/42/files#diff")).toBe("acme/widgets#42");
  expect(title("https://github.com/acme/widgets/issues/7")).toBe("acme/widgets#7");
  expect(title("https://github.com/acme/widgets/commit/0123456789abcdef")).toBe("acme/widgets@0123456");
  expect(title("https://github.com/acme/widgets")).toBe("acme/widgets");
  expect(title("https://docs.google.com/document/d/abc/edit?tab=t.0#heading=h.1")).toBe("Google Doc");
  expect(title("https://docs.google.com/spreadsheets/d/abc/edit")).toBe("Google Sheet");
  expect(title("https://docs.google.com/presentation/d/abc/edit")).toBe("Google Slides");
  expect(title("https://drive.google.com/file/d/abc/view?usp=sharing")).toBe("Google Drive file");
  expect(title("https://acme.slack.com/archives/C0123/p1700000000000")).toBe("Slack message");
  expect(title("https://acme.slack.com/archives/C0123")).toBe("Slack channel");
  expect(title("https://www.figma.com/design/AbC123/Checkout-flow-v2?node-id=1-2")).toBe("Checkout flow v2");
  expect(title("https://www.loom.com/share/0123abcd")).toBe("Loom video");
  expect(title("https://docs.example.com/guides/getting-started/")).toBe("docs.example.com/guides/getting-started");
  expect(title("https://www.example.com/")).toBe("example.com");
  expect(title("https://www.example.com/", { name: "Example home" })).toBe("Example home");
  expect(smartLink("https://github.com/acme/widgets/pull/42")).toMatchObject({ kind: "external", origin: "https://github.com" });
});

test("BJ-16: no smart link for a URL that is not a web address", () => {
  expect(smartLink("javascript:alert(1)")).toBeNull();
  expect(smartLink("not a url")).toBeNull();
  expect(smartLink(undefined)).toBeNull();
  expect(smartLinkText("https://acme.atlassian.net/browse/OPS-12")).toBe("OPS-12");
  expect(smartLinkText("nope")).toBe("nope");
});
