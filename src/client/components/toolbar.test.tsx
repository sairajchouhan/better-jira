import { expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { InlineToolbar, nextToolbarIndex, Toolbar } from "./toolbar";

test("a toolbar's arrows wrap and Home/End jump to the ends, as Linear's `Mze` (React Aria's own stop at the ends)", () => {
  expect(nextToolbarIndex("ArrowRight", 0, 3)).toBe(1);
  expect(nextToolbarIndex("ArrowRight", 2, 3)).toBe(0);
  expect(nextToolbarIndex("ArrowLeft", 0, 3)).toBe(2);
  expect(nextToolbarIndex("ArrowLeft", 2, 3)).toBe(1);
  expect(nextToolbarIndex("Home", 2, 3)).toBe(0);
  expect(nextToolbarIndex("End", 0, 3)).toBe(2);
  expect(nextToolbarIndex("ArrowDown", 0, 3)).toBeUndefined();
  // Focus outside the items, or no items: nothing moves.
  expect(nextToolbarIndex("ArrowRight", -1, 3)).toBeUndefined();
  expect(nextToolbarIndex("Home", 0, 0)).toBeUndefined();
});

test("every toolbar is React Aria's: role, label and orientation; the inline one is a span so it may sit in a paragraph", () => {
  const block = renderToStaticMarkup(
    <Toolbar label="Copy issue" className="issue-copy-toolbar">
      <button type="button">Copy</button>
    </Toolbar>,
  );
  expect(block).toMatch(/^<div [^>]*role="toolbar"/);
  expect(block).toContain('aria-label="Copy issue"');
  expect(block).toContain('aria-orientation="horizontal"');
  expect(block).toContain("data-rac");
  const inline = renderToStaticMarkup(
    <InlineToolbar label="File actions">
      <button type="button">Copy</button>
    </InlineToolbar>,
  );
  expect(inline).toMatch(/^<span [^>]*role="toolbar"/);
  expect(inline).not.toMatch(/<div\b/);
});
