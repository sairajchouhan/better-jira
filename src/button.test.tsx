import { expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { Button, ButtonLink, IconButton } from "./button";

test("an icon button's tooltip may differ from its accessible name", () => {
  const html = renderToStaticMarkup(
    <IconButton label="Add filter" tooltip="Filter" shortcut="F">
      <svg />
    </IconButton>,
  );
  expect(html).toContain('aria-label="Add filter"');
  expect(html).toContain('title="Filter (F)"');
});

test("the tooltip defaults to the label, and false leaves it to the owner", () => {
  expect(renderToStaticMarkup(<IconButton label="Close">x</IconButton>)).toContain('title="Close"');
  const bare = renderToStaticMarkup(
    <IconButton label="Play" tooltip={false}>
      x
    </IconButton>,
  );
  expect(bare).toContain('aria-label="Play"');
  expect(bare).not.toContain("title=");
});

test("a disabled reason replaces the tooltip and shortcut on a hoverable wrapper (Aze)", () => {
  const html = renderToStaticMarkup(
    <IconButton label="Send" shortcut="⌘↵" disabledReason="Write a comment first" disabled>
      x
    </IconButton>,
  );
  expect(html).toStartWith('<span class="ui-tooltip-trigger" title="Write a comment first"><button');
  expect(html).toContain('aria-description="Write a comment first"');
  expect(html).not.toContain("⌘↵");
});

test("an enabled button ignores its disabled reason", () => {
  const html = renderToStaticMarkup(
    <Button tooltip="Send" shortcut="⌘↵" disabledReason="Write a comment first">
      Send
    </Button>,
  );
  expect(html).toStartWith("<button");
  expect(html).toContain('title="Send (⌘↵)"');
  expect(html).not.toContain("Write a comment first");
});

test("a link button is an anchor with the button's looks", () => {
  const html = renderToStaticMarkup(
    <ButtonLink variant="secondary" size="small" href="/backup.zip" download>
      Download
    </ButtonLink>,
  );
  expect(html).toBe('<a data-variant="secondary" data-size="small" class="ui-button " href="/backup.zip" download="">Download</a>');
});
