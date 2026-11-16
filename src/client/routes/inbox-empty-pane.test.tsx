import { expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { InboxEmptyPane } from "./inbox";

/** The column's own classes, read from the rendered markup. */
function column(html: string) {
  return html.match(/<div data-inbox-empty="true" class="([^"]*)"/)?.[1]?.split(" ") ?? [];
}

test("the empty inbox pane centres the tray and its line on one axis, as Linear's Bt (center column, gap 24)", () => {
  const html = renderToStaticMarkup(<InboxEmptyPane unread={0} />);
  expect(column(html)).toEqual(expect.arrayContaining(["flex", "flex-col", "items-center", "justify-center", "gap-6"]));
  // The tray and the line are the column's only children, so both take its centre.
  expect(html).toMatch(/<div data-inbox-empty="true" [^>]*><svg [^>]*width="105" height="100"[\s\S]*<\/svg><h2 [^>]*>No notification selected<\/h2><\/div>/);
  // Not the shared EmptyState, whose column stretches its children and leaves the tray at its left edge.
  expect(html).not.toContain("ui-empty-state");
});

test("the empty inbox pane's unread count sits in the same centred column", () => {
  const html = renderToStaticMarkup(<InboxEmptyPane unread={3} />);
  expect(column(html)).toContain("items-center");
  expect(html).toMatch(/<\/svg><h2 [^>]*>3 unread notifications<\/h2><\/div>/);
  expect(renderToStaticMarkup(<InboxEmptyPane unread={1} />)).toContain(">1 unread notification<");
});
