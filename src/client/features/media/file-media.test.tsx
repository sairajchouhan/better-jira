import { expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { FileMedia } from "./file-media";

const file = { id: "103", url: "/api/issues/TEST-1/attachments/103", name: "notes.txt", type: "text/plain", size: 35 };
const html = renderToStaticMarkup(<FileMedia file={file} issueKey="TEST-1" />);

test("BJ-228: a file in rich text is Linear's file block in the elevated theme, never the old inline chip", () => {
  expect(html).toMatch(/^<span class="file-media" data-elevation="dialog" data-attachment-id="103" data-node-toolbar-host="true">/);
  expect(html).toContain('title="notes.txt"');
  expect(html).toContain(">notes.txt</span>");
  expect(html).toContain(">35 B</span>");
  // Spans only: a Jira inline attachment renders the same block inside a paragraph.
  expect(html).not.toMatch(/<(div|p)\b/);
});

test("BJ-228: its File actions are Linear's plain file toolbar, Copy link then Download, revealed on hover", () => {
  // React Aria's Toolbar, drawn as a span: attribute order is React Aria's, so each is checked on the tag.
  const toolbar = /<span [^>]*role="toolbar"[^>]*>/.exec(html)?.[0] ?? "";
  for (const attribute of ['aria-label="File actions"', 'aria-orientation="horizontal"', 'data-reveal="hover"', 'class="ui-node-toolbar"'])
    expect(toolbar).toContain(attribute);
  const labels = [...html.matchAll(/aria-label="([^"]+)"/g)].map((m) => m[1]);
  expect(labels).toEqual(["File actions", "Copy link", "Download"]);
  expect(html).toMatch(/<a [^>]*data-appearance="node-toolbar"[^>]*aria-label="Download"[^>]*href="\/api\/issues\/TEST-1\/attachments\/103\?download=1" download="notes.txt"/);
  expect(html).toMatch(/<button [^>]*title="Copy link"[^>]*data-appearance="node-toolbar"/);
});

test("BJ-228: a local file before its issue exists can't copy a link, and says why", () => {
  const local = renderToStaticMarkup(<FileMedia file={{ ...file, url: "blob:http://x/1" }} />);
  expect(local).toContain('title="Create the issue before copying its file link"');
  expect(local).toMatch(/aria-label="Copy link"[^>]*disabled=""/);
});

test("a dimensionless media node waits as a file block of the same frame, so the file lands without moving the text below", async () => {
  const { FileBlockLoading } = await import("./file-block");
  const loading = renderToStaticMarkup(<FileBlockLoading />);
  const frame = (markup: string) => [...markup.matchAll(/class="([^"]*)"/g)].map((m) => m[1]).filter((c) => c!.includes("file-media"));
  expect(frame(loading)).toEqual(frame(html));
  expect(loading).toMatch(/^<span class="file-media" data-elevation="dialog" role="status" aria-busy="true">/);
  expect(loading).toContain(">Loading attachment…</span>");
  // Its detail line holds a line's height, as the file's size does.
  expect(loading).toContain("> </span>");
});
