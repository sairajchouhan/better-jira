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
  class FakeNode {
    readonly node = true;
  }
  (globalThis as { Node?: unknown }).Node = FakeNode;
  try {
    const event = { currentTarget: { contains: () => true }, target: new FakeNode() as unknown as EventTarget };
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

test("the card's surface is painted in Linear's menu theme (`T_`), so what it holds reads the menu's tokens", async () => {
  const source = await Bun.file(new URL("./hover-card.tsx", import.meta.url)).text();
  expect(source).toMatch(/data-hover-card=\{label\}\s*\{\.\.\.elevation\.props\}/);
  expect(source).toContain("<ElevationScope level={elevation.level}>{children}</ElevationScope>");
});

test("a press on a card's trigger closes it only by its rules (`Rwe`'s closeOnPointerDown); a press inside never does", async () => {
  const source = await Bun.file(new URL("./hover-card.tsx", import.meta.url)).text();
  expect(source).toContain("onPointerDown={(event) => own(event) && rules.closeOnPress && actions.close()}");
  // The zone only notes a press (`Vwe`), and entering it keeps a card waiting out its leave grace (`Aa`'s `y`).
  expect(source).toContain("onPointerDown={() => (pressedAt.current = Date.now())}");
  expect(source).toContain("onPointerEnter={() => actions.stay()}");
  // Leaving the trigger hands the store the rules' grace; leaving a document's card closes it at once (`Aa`'s `v`).
  expect(source).toContain("actions.leave(rules.leaveGraceMs)");
  expect(source).toContain("if (rules.leaveGraceMs > 0) return actions.leave();");
});

test("an issue chip in a document opens Linear's document popover, as a mention does", async () => {
  const source = await Bun.file(new URL("../features/editor/smart-link.tsx", import.meta.url)).text();
  expect(source).toContain("rules={CARD_RULES.document}");
});

test("a card on a page element reports the pointer gone as its trigger unmounts, so a remount's first hover opens it", async () => {
  const source = await Bun.file(new URL("./hover-card.tsx", import.meta.url)).text();
  expect(source).toContain("const release = useEffectEvent(() => actions.leave());");
  expect(source).toMatch(/element\.removeEventListener\("pointerleave", onLeave\);\s*release\(\);/);
});
