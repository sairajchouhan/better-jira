import { expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { Adf } from "./adf";

const doc = (...content: any[]) => ({ type: "doc", version: 1, content });
const heading = (level: number, text: string) => ({
  type: "heading",
  attrs: { level },
  content: [{ type: "text", text }],
});

test("I10: headings render as h1–h6 with sizes that step down by level", () => {
  const html = renderToStaticMarkup(
    <Adf node={doc(heading(1, "One"), heading(2, "Two"), heading(3, "Three"))} />,
  );
  const tags = [...html.matchAll(/<(h\d) class="([^"]*)">/g)].map((m) => [m[1], m[2]]);
  expect(tags.map((t) => t[0])).toEqual(["h1", "h2", "h3"]);
  const size = (cls: string) => Number(/text-\[(\d+)px\]/.exec(cls)![1]);
  expect(size(tags[0]![1]!)).toBeGreaterThan(size(tags[1]![1]!));
  expect(size(tags[1]![1]!)).toBeGreaterThan(size(tags[2]![1]!));
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
    '<a class="text-accent underline" href="https://example.test/a" target="_blank" rel="noreferrer">https://example.test/a</a>. Thanks',
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
