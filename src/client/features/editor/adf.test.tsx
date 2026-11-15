import { expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { Adf } from "./adf";
import { toEditorDocument } from "./rich-document";

const doc = (...content: any[]) => ({ type: "doc", version: 1, content });
const heading = (level: number, text: string) => ({
  type: "heading",
  attrs: { level },
  content: [{ type: "text", text }],
});

test("I10: headings render as bare h1–h6 that .rich-doc sizes like Linear's editor (BJ-176)", () => {
  const html = renderToStaticMarkup(
    <Adf node={doc(heading(1, "One"), heading(2, "Two"), heading(3, "Three"))} />,
  );
  expect(html).toBe('<div class="rich-doc flow-root"><h1>One</h1><h2>Two</h2><h3>Three</h3></div>');
});

test("I7: bare URLs in comments and descriptions render as links", () => {
  const html = renderToStaticMarkup(
    <Adf
      node={doc({
        type: "paragraph",
        content: [{ type: "text", text: "See https://example.test/a. Thanks" }],
      })}
    />,
  );
  expect(html).toContain(
    '<a href="https://example.test/a" target="_blank" rel="noreferrer">https://example.test/a</a>. Thanks',
  );
  expect(
    renderToStaticMarkup(
      <Adf
        node={doc({
          type: "paragraph",
          content: [{ type: "text", text: "https://x.test", marks: [{ type: "code" }] }],
        })}
      />,
    ),
  ).not.toContain("<a");
});

test("Jira mentions render as mention chips", () => {
  const html = renderToStaticMarkup(
    <Adf
      node={doc({
        type: "paragraph",
        content: [{ type: "mention", attrs: { id: "acc-1", text: "@Priya", accessLevel: "" } }],
      })}
    />,
  );
  expect(html).toContain('<span class="mention-chip" data-mention-id="acc-1">@Priya</span>');
});

test("BJ-176: the read-only view renders the editor's DOM, so one stylesheet styles both", () => {
  const panel = {
    type: "panel",
    attrs: { panelType: "warning" },
    content: [{ type: "paragraph", content: [{ type: "text", text: "Careful" }] }],
  };
  const expand = {
    type: "expand",
    attrs: { title: "" },
    content: [{ type: "paragraph", content: [{ type: "text", text: "Inside" }] }],
  };
  const emoji = { type: "emoji", attrs: { shortName: ":smile:", text: "😄" } };
  const html = renderToStaticMarkup(
    <Adf node={doc(panel, expand, { type: "paragraph", content: [emoji] })} />,
  );
  // The editor's toDOM for the same nodes (rich-document.ts) uses these classes and attributes.
  const view = toEditorDocument(doc(panel, { type: "paragraph", content: [emoji] }));
  const dom = (index: number, path: number[] = []) => {
    let node = view.child(index);
    for (const i of path) node = node.child(i);
    return node.type.spec.toDOM!(node) as [string, Record<string, string>];
  };
  expect(dom(0)[1]).toMatchObject({ class: "rich-panel", "data-panel-type": "warning" });
  expect(dom(1, [0])[1]).toMatchObject({ class: "rich-emoji" });
  expect(html).toContain('<div class="rich-panel" data-panel-type="warning"><p>Careful</p></div>');
  expect(html).toContain('<span class="rich-emoji">😄</span>');
  expect(html).toContain('<details class="rich-expand"><summary class="rich-expand-header"><span class="rich-expand-toggle">');
  expect(html).toContain('<span class="rich-expand-title" data-empty="true">Section</span>');
  expect(html).toContain('<div class="rich-expand-body"><p>Inside</p></div>');
});

test("BJ-178: a read-only code block renders like the editor's: numbered, labelled, collapsed past 30 lines", () => {
  const block = (text: string, language?: string) =>
    renderToStaticMarkup(
      <Adf node={doc({ type: "codeBlock", ...(language ? { attrs: { language } } : {}), content: [{ type: "text", text }] })} />,
    );
  const short = block("a\nb", "go");
  expect(short).toContain('<pre class="code-block">');
  expect(short).toContain('<div class="cb-gutter" aria-hidden="true"><div>1</div><div>2</div></div>');
  expect(short).toContain("Golang");
  expect(short).not.toContain('aria-label="Delete code block"');
  const long = block(Array.from({ length: 30 }, (_, i) => `line ${i}`).join("\n"));
  expect(long).toContain('data-collapsed="true"');
  expect(long).toContain("Expand (30 lines)");
});

test("BJ-16: smart links render as Linear's mention chip: issue status, key and title; a page's title; a site's icon and name", async () => {
  const { set } = await import("@/client/state/store");
  const { smartLinksFixture } = await import("./smart-links.fixture");
  set({
    site: "https://example.atlassian.net",
    boards: [{ id: 1, name: "Board", columns: [{ name: "Doing", statuses: [{ id: "doing", name: "Doing", category: "indeterminate" }] }] }],
    issues: new Map([["TEST-2", { key: "TEST-2", boards: [1], summary: "Second fixture", status: "doing" } as any]]),
  } as any);
  const html = renderToStaticMarkup(<Adf node={smartLinksFixture} />);
  const chips = [...html.matchAll(/<a class="mention-chip smart-link" data-smart-link="(\w+)" href="([^"]+)"[^>]*>(.*?)<\/a>/g)].map(
    ([, kind, href, inner]) => [kind, href, inner!.replace(/<[^>]+>/g, "").replace(/[⁠ ]/g, "")],
  );
  expect(chips).toEqual([
    ["issue", "https://example.atlassian.net/browse/TEST-2", "TEST-2 Second fixture"],
    ["external", "https://github.com/acme/widgets/pull/42", "Fix the widget"],
    ["confluence", "https://example.atlassian.net/wiki/spaces/ENG/pages/123456/Release+checklist", "Release checklist"],
    ["external", "https://docs.google.com/document/d/abc/edit", "Google Doc"],
    ["external", "https://example.com/handbook", "example.com/handbook"],
  ]);
  // The issue's status icon (Doing's in-progress colour) and the sites' icons through this server, never the sites.
  expect(html).toContain("var(--st-progress)");
  expect(html).toContain('src="/api/favicon?origin=https%3A%2F%2Fgithub.com"');
  expect(html).not.toMatch(/<img[^>]+src="https?:/);
  // Block cards keep their own line: the editor's wrapper.
  expect(html).toContain('<p class="smart-link-block"><a class="mention-chip smart-link" data-smart-link="external" href="https://docs.google.com');
  expect(html.match(/<span class="smart-link-node">/g)).toHaveLength(3);
});

test("BJ-199: plain text uses chip titles from metadata, mirror and cached page reads", async () => {
  const { adfToText } = await import("./document-text");
  const { set } = await import("@/client/state/store");
  const { queryClient } = await import("@/client/state/server-data");
  set({ site: "https://example.atlassian.net", issues: new Map([["TEST-2", { summary: "Second fixture" } as any]]) });
  const url = "https://example.atlassian.net/wiki/x/abc";
  queryClient.setQueryData(["smart-link", url], { title: "Page from cache" });
  expect(adfToText(doc({ type: "paragraph", content: [
    { type: "inlineCard", attrs: { url: "https://example.atlassian.net/browse/TEST-2" } },
    { type: "text", text: " / " },
    { type: "inlineCard", attrs: { url } },
  ] }))).toBe("TEST-2 Second fixture / Page from cache");
  const rich = toEditorDocument(doc({ type: "paragraph", content: [{ type: "inlineCard", attrs: { url: "https://example.atlassian.net/browse/TEST-2" } }] }));
  expect(rich.textBetween(0, rich.content.size)).toBe("TEST-2 Second fixture");
  expect(adfToText({ type: "inlineCard", attrs: { url: "https://github.com/acme/widgets/pull/42", data: { name: "Fix widget" } } })).toBe("Fix widget");
});
