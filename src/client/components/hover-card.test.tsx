import { expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { HoverCard, ownsEvent } from "./hover-card";

test("a closed hover card is only its trigger: the card, React Aria's preview dialog, mounts when it opens", () => {
  const html = renderToStaticMarkup(
    <HoverCard label="Pull request" content={<p>Card body</p>}>
      <a href="https://example.com/pull/1">PR</a>
    </HoverCard>,
  );
  expect(html).toMatch(/^<span class="inline-flex min-w-0 max-w-full" data-hover-card-trigger="">/);
  expect(html).toContain('<a href="https://example.com/pull/1">PR</a>');
  expect(html).not.toContain("Card body");
  expect(html).not.toContain('role="dialog"');
});

test("a disabled card's trigger owns no event, so nothing opens it (a favorite row while a favorite is dragged, Linear's `d5n`)", () => {
  const was = (globalThis as { Node?: unknown }).Node;
  class FakeNode {}
  (globalThis as { Node?: unknown }).Node = FakeNode;
  try {
    const event = { currentTarget: { contains: () => true }, target: new FakeNode() as EventTarget };
    expect(ownsEvent(false, event)).toBe(true);
    expect(ownsEvent(true, event)).toBe(false);
    // An event from a portal'd child the trigger doesn't contain isn't the trigger's either.
    expect(ownsEvent(false, { ...event, currentTarget: { contains: () => false } })).toBe(false);
  } finally {
    (globalThis as { Node?: unknown }).Node = was;
  }
});

test("a block trigger keeps its row's full width (the sidebar's `_$.tooltipBlock`)", () => {
  const html = renderToStaticMarkup(
    <HoverCard display="block" placement="right" content={<p>Card body</p>}>
      <a href="/row">Row</a>
    </HoverCard>,
  );
  expect(html).toMatch(/^<span class="flex w-full min-w-0" data-hover-card-trigger="">/);
});
