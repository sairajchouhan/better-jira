import { expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { Adf } from "./adf";

const doc = (...content: any[]) => ({ type: "doc", version: 1, content });
const heading = (level: number, text: string) => ({ type: "heading", attrs: { level }, content: [{ type: "text", text }] });

test("I10: headings render as h1–h6 with sizes that step down by level", () => {
  const html = renderToStaticMarkup(<Adf node={doc(heading(1, "One"), heading(2, "Two"), heading(3, "Three"))} />);
  const tags = [...html.matchAll(/<(h\d) class="([^"]*)">/g)].map(m => [m[1], m[2]]);
  expect(tags.map(t => t[0])).toEqual(["h1", "h2", "h3"]);
  const size = (cls: string) => Number(/text-\[(\d+)px\]/.exec(cls)![1]);
  expect(size(tags[0]![1]!)).toBeGreaterThan(size(tags[1]![1]!));
  expect(size(tags[1]![1]!)).toBeGreaterThan(size(tags[2]![1]!));
});

test("I7: bare URLs in comments and descriptions render as links", () => {
  const html = renderToStaticMarkup(<Adf node={doc({ type: "paragraph", content: [{ type: "text", text: "See https://example.test/a. Thanks" }] })} />);
  expect(html).toContain('<a class="text-accent underline" href="https://example.test/a" target="_blank" rel="noreferrer">https://example.test/a</a>. Thanks');
  expect(renderToStaticMarkup(<Adf node={doc({ type: "paragraph", content: [{ type: "text", text: "https://x.test", marks: [{ type: "code" }] }] })} />)).not.toContain("<a");
});
