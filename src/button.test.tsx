import { expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { Button, ButtonLink, IconButton, SendButton } from "./button";

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
    <IconButton label="Send" shortcut="Mod+Enter" disabledReason="Write a comment first" disabled>
      x
    </IconButton>,
  );
  expect(html).toStartWith('<span class="ui-tooltip-trigger" title="Write a comment first"><button');
  expect(html).toContain('aria-description="Write a comment first"');
  expect(html).not.toContain("↵");
});

test("an enabled button keeps its reason's wrapper, untitled, so toggling disabled never remounts it (F16b)", () => {
  const html = renderToStaticMarkup(
    <Button tooltip="Send" shortcut="Mod+Enter" disabledReason="Write a comment first">
      Send
    </Button>,
  );
  expect(html).toStartWith('<span class="ui-tooltip-trigger"><button');
  expect(html).toContain('title="Send (⌘ ↵)"');
  expect(html).not.toContain("Write a comment first");
});

test("shortcut props take registry chords, spelled as caps in one place (F3)", () => {
  // "Shift+V" used to reach the tooltip as display text and showed the caps "Shift" "V".
  expect(renderToStaticMarkup(<IconButton label="Display options" shortcut="Shift+V">x</IconButton>)).toContain(
    'title="Display options (⇧ V)"',
  );
  expect(
    renderToStaticMarkup(
      <IconButton label="Next" shortcut="J" alternate="ArrowDown">
        x
      </IconButton>,
    ),
  ).toContain('title="Next (J / ↓)"');
});

test("SendButton is the one send control: the --send look, ⌘↵ and a stable reason wrapper (F5)", () => {
  const html = renderToStaticMarkup(<SendButton label="Submit reply" disabled />);
  // Disabled, it can't be hovered, so its own tooltip moves to the wrapper (C1).
  expect(html).toStartWith('<span class="ui-tooltip-trigger" title="Submit comment (⌘ ↵)"><button');
  expect(html).not.toMatch(/<button[^>]*title=/);
  expect(html).toContain('data-variant="send"');
  expect(html).toContain('data-size="small"');
  const enabled = renderToStaticMarkup(<SendButton label="Submit reply" />);
  expect(enabled).toStartWith('<span class="ui-tooltip-trigger"><button');
  expect(enabled).toMatch(/<button[^>]*title="Submit comment \(⌘ ↵\)"/);
});

test("a link button is an anchor with the button's looks", () => {
  const html = renderToStaticMarkup(
    <ButtonLink variant="secondary" size="small" href="/backup.zip" download>
      Download
    </ButtonLink>,
  );
  expect(html).toBe('<a data-variant="secondary" data-size="small" class="ui-button " href="/backup.zip" download="">Download</a>');
});

test("an icon-only ButtonLink is IconButton's square, named and titled by its label", () => {
  const html = renderToStaticMarkup(
    <ButtonLink variant="borderless" size="medium" label="Download image" icon={<svg />} href="/a.png" download />,
  );
  expect(html).toContain('data-shape="icon"');
  expect(html).toContain('aria-label="Download image"');
  expect(html).toContain('title="Download image"');
});
