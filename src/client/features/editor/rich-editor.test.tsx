import { expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { RichEditor } from "./rich-editor";

test("editor presentations retain their frame, toolbar and submit contracts", () => {
  const framed = renderToStaticMarkup(<RichEditor initial="" presentation="framed" onSave={() => {}} />);
  expect(framed).toContain("mb-3 rounded-lg border border-line-2 bg-card");
  expect(framed).toContain('aria-label="Description formatting"');
  expect(framed).toContain("rich-editor-hint");
  expect(framed).toMatch(/rich-editor-hint[^>]*><span class="ui-shortcut[^"]*"/);
  expect(framed).toContain('aria-label="Save description"');

  const inline = renderToStaticMarkup(<RichEditor initial="" presentation="inline" />);
  expect(inline).toContain('data-inline="true"');
  expect(inline).toContain('aria-label="Description formatting"');
  expect(inline).not.toContain("rich-editor-actions");

  const document = renderToStaticMarkup(<RichEditor initial="" presentation="document" />);
  expect(document).toContain('data-inline="true"');
  expect(document).not.toContain('role="toolbar"');

  const comment = renderToStaticMarkup(
    <RichEditor initial="" presentation="comment" onSave={() => {}} saveLabel="Submit reply" />,
  );
  expect(comment).toContain('data-variant="comment"');
  expect(comment).toContain('aria-label="Comment formatting"');
  expect(comment.indexOf("rich-editor-actions")).toBeLessThan(comment.indexOf('role="toolbar"'));
  expect(comment).toMatch(/<button[^>]*aria-label="Submit reply"[^>]*disabled=""/);
  expect(comment).toContain("Submit comment (⌘ ↵)");
  expect(comment).toContain('data-variant="send"');
  expect(comment).not.toContain("rich-editor-hint");
});

test("each public editor wrapper loads the editor and passes its own presentation", async () => {
  const { FramedEditor, InlineEditor, DocumentBodyEditor, CommentComposer, loadEditor } = await import(
    "./rich-editor-loader"
  );
  // Keep the document visible while the editor chunk arrives.
  expect(renderToStaticMarkup(<FramedEditor initial="Existing description" />)).toContain("Existing description");
  await loadEditor();

  const framed = renderToStaticMarkup(<FramedEditor initial="" onSave={() => {}} />);
  expect(framed).toContain("mb-3 rounded-lg border border-line-2 bg-card");
  expect(framed).toContain('aria-label="Save description"');
  const inline = renderToStaticMarkup(<InlineEditor initial="" />);
  expect(inline).toContain('data-inline="true"');
  expect(inline).toContain('aria-label="Description formatting"');
  const document = renderToStaticMarkup(<DocumentBodyEditor initial="" />);
  expect(document).toContain('data-inline="true"');
  expect(document).not.toContain('role="toolbar"');
  const comment = renderToStaticMarkup(
    <CommentComposer initial="" onSave={() => {}} saveLabel="Submit reply" />,
  );
  expect(comment).toContain('data-variant="comment"');
  expect(comment).toMatch(/<button[^>]*aria-label="Submit reply"[^>]*disabled=""/);
});
