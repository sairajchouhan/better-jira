import { expect, test } from "bun:test";
import { PULL_REQUEST_ROW_CARD_DELAY } from "@/client/features/issue/issue-pull-requests";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { parseTip, tipCaps, tipPlacement, Tooltip } from "./tooltip";
import { TOOLTIP, TOOLTIP_TIMING } from "./tooltip-rules";

test("tipCaps splits a title's keys into one cap per key, one array per chord of a sequence", () => {
  expect(tipCaps("⌘⇧S")).toEqual([["⌘", "⇧", "S"]]);
  expect(tipCaps("Ctrl+K")).toEqual([["Ctrl", "K"]]);
  expect(tipCaps("G then I")).toEqual([["G"], ["I"]]);
  expect(tipCaps("⌘+")).toEqual([["⌘", "+"]]);
  expect(tipCaps("A / B")).toEqual([["A", "B"]]);
  // The / key itself is a cap, not the alternate separator (the sidebar's "Search (/)", "⌘ /").
  expect(tipCaps("/")).toEqual([["/"]]);
  expect(tipCaps("⌘ /")).toEqual([["⌘", "/"]]);
});

test("parseTip: a trailing (keys) draws caps after the text, a leading one before it, one line per \\n (Linear's `N_`)", () => {
  expect(parseTip("Undo (⌘ Z)")).toEqual([{ text: "Undo", keys: [["⌘", "Z"]], keysFirst: false }]);
  expect(parseTip("Plain")).toEqual([{ text: "Plain", keys: [], keysFirst: false }]);
  expect(parseTip("(T) to collapse group\n(⌥ click) to collapse all")).toEqual([
    { text: "to collapse group", keys: [["T"]], keysFirst: true },
    { text: "to collapse all", keys: [["⌥", "click"]], keysFirst: true },
  ]);
});

test("a sequence's tooltip draws \"then\" between its caps and reads \"G, then I\" (Linear's `rVn` → `qr`)", () => {
  const html = renderToStaticMarkup(createElement(Tooltip.Lines, { lines: parseTip("Go to inbox (G then I)") }));
  expect(html).toContain('<span class="sr-only">G, then I</span>');
  expect(html).toMatch(/>G<\/kbd><span aria-hidden="true" data-size="small" class="ui-shortcut-label">then<\/span><kbd[^>]*>I<\/kbd>/);
});

test("data-tip picks the title tooltip's side: bottom by default, above, or right for sidebar rows (`h$` → `wZ` position right)", () => {
  expect(tipPlacement(undefined)).toBe("bottom");
  expect(tipPlacement("above")).toBe("top");
  expect(tipPlacement("right")).toBe("right");
});

test("tooltips, hover cards and the edge tooltip take Linear's `Rwe` and `B_` timing and geometry", () => {
  // `w = transitionDelay ?? (interactive ? 550 : 450)`, rescheduled on every move; `B_`'s one 450ms timer from mouseenter.
  expect(TOOLTIP_TIMING).toEqual({
    plain: { delay: 450, restartOnMove: true },
    card: { delay: 550, restartOnMove: true },
    edge: { delay: 450, restartOnMove: false },
  });
  // `Lwe.schedule(…, 100)`, `Nwe`, `Fwe`, `Pwe`, `Vwe`'s 500ms, `rTe delay: 10`, `j_ = Pwe * 2.5`, `qwe`.
  expect(TOOLTIP).toEqual({
    warmMs: 100,
    offset: 8,
    containerPadding: 12,
    cardPad: 4,
    cardPressGraceMs: 500,
    safeAreaDelayMs: 10,
    safeAreaDepth: 10,
    safeAreaReach: 24,
  });
  // The issue sidebar's pull request row: `transitionDelay: 150`.
  expect(PULL_REQUEST_ROW_CARD_DELAY).toBe(150);
});

test("parseTip: a plain title (data-tip-plain) is text as it stands, so a name ending in (…) is not drawn as caps", () => {
  expect(parseTip("Ops (EU)", true)).toEqual([{ text: "Ops (EU)", keys: [], keysFirst: false }]);
  expect(parseTip("Ops (EU)")[0]!.keys).toEqual([["EU"]]);
});
