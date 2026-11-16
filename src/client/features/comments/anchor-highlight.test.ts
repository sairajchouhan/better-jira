import { expect, test } from "bun:test";
import {
  FADE_MS,
  FAST_FADE_MS,
  HIGHLIGHT_MS,
  RECHECK_MS,
  alignDelta,
  highlightTimeline,
  revealCentred,
  ringsNow,
  scrollToAlign,
  type HighlightPhase,
} from "./anchor-highlight";

/** Timers that run only when the test moves the clock. */
function clock() {
  let now = 0,
    next = 0;
  const due = new Map<number, { at: number; run: () => void }>();
  return {
    timers: {
      setTimeout: (run: () => void, ms: number) => {
        due.set(++next, { at: now + ms, run });
        return next;
      },
      clearTimeout: (id: never) => void due.delete(id as unknown as number),
    },
    advance(ms: number) {
      const end = now + ms;
      for (;;) {
        const [id, t] = [...due].filter(([, t]) => t.at <= end).sort((a, b) => a[1].at - b[1].at)[0] ?? [];
        if (!t) break;
        due.delete(id!);
        now = t.at;
        t.run();
      }
      now = end;
    },
  };
}

test("R4-inbox-D2: a linked comment rings for Linear's 7 s (NL nMt), then fades out over 600 ms (rMt)", () => {
  const c = clock(),
    seen: (HighlightPhase | undefined)[] = [];
  const t = highlightTimeline((p) => seen.push(p), c.timers);
  t.start();
  expect(seen).toEqual(["in"]);
  c.advance(HIGHLIGHT_MS - 1);
  expect(t.phase).toBe("in");
  c.advance(1);
  expect(t.phase).toBe("out");
  c.advance(FADE_MS);
  expect(seen).toEqual(["in", "out", undefined]);
  expect([HIGHLIGHT_MS, FADE_MS, FAST_FADE_MS]).toEqual([7000, 600, 150]);
});

test("R4-inbox-D2: a press while it rings fades it in 150 ms (NL tMt, iMt); a press after does nothing", () => {
  const c = clock(),
    seen: (HighlightPhase | undefined)[] = [];
  const t = highlightTimeline((p) => seen.push(p), c.timers);
  t.start();
  c.advance(1000);
  t.press();
  expect(t.phase).toBe("fast-out");
  c.advance(FAST_FADE_MS);
  expect(seen).toEqual(["in", "fast-out", undefined]);
  t.press();
  c.advance(HIGHLIGHT_MS);
  expect(seen).toEqual(["in", "fast-out", undefined]);
});

test("alignDelta is Linear's t6e: centre, start, end and nearest", () => {
  // A 80px comment at 1000–1080 in a scroller showing 50–850.
  expect(alignDelta(1000, 1080, 50, 850, "center")).toBe(1040 - 450);
  expect(alignDelta(1000, 1080, 50, 850, "start")).toBe(950);
  expect(alignDelta(1000, 1080, 50, 850, "end")).toBe(230);
  expect(alignDelta(100, 180, 50, 850, "nearest")).toBe(0);
  expect(alignDelta(900, 980, 50, 850, "nearest")).toBe(130);
});

type Box = { top: number; height: number };
/** A comment inside one scroller (the pane's body) inside the page. */
function layout(comment: Box, pane: Box & { scrollTop: number; scrollHeight: number; paddingTop?: number }, windowHeight = 900) {
  const calls: number[] = [];
  const style = (over: Record<string, string> = {}) =>
    ({ overflowY: "visible", scrollMarginTop: "0px", scrollMarginBottom: "0px", scrollPaddingTop: "0px", scrollPaddingBottom: "0px", ...over }) as CSSStyleDeclaration;
  const root = { clientHeight: windowHeight, scrollTop: 0, scrollHeight: windowHeight, scrollBy() {} } as unknown as Element;
  const doc = {
    scrollingElement: root,
    defaultView: {
      innerHeight: windowHeight,
      innerWidth: 1440,
      getComputedStyle: (el: unknown) =>
        el === scroller ? style({ overflowY: "auto", scrollPaddingTop: `${pane.paddingTop ?? 0}px` }) : style(),
    },
  };
  const scroller = {
    ownerDocument: doc,
    parentElement: root,
    clientTop: 0,
    clientHeight: pane.height,
    get scrollTop() {
      return pane.scrollTop;
    },
    scrollHeight: pane.scrollHeight,
    getBoundingClientRect: () => ({ top: pane.top }),
    scrollBy({ top }: { top: number }) {
      calls.push(top);
      pane.scrollTop += top;
      comment.top -= top;
    },
  };
  const el = {
    ownerDocument: doc,
    parentElement: scroller,
    isConnected: true,
    getBoundingClientRect: () => ({ top: comment.top, bottom: comment.top + comment.height, left: 0, right: 600 }),
  } as unknown as Element;
  return { el, calls, comment };
}

test("R4-inbox-D2: scrollToAlign centres the comment in the pane, as Linear's oT(e, 'center'), not at its top", () => {
  const { el, comment } = layout({ top: 1500, height: 80 }, { top: 53, height: 811, scrollTop: 0, scrollHeight: 3500 });
  scrollToAlign(el);
  // The comment's middle sits on the pane's middle (53 + 811 / 2).
  expect(comment.top + 40).toBeCloseTo(53 + 811 / 2);
});

test("scrollToAlign honours the scroller's scroll-padding, and aligns a comment taller than 70% of the window to its start", () => {
  const padded = layout({ top: 1500, height: 80 }, { top: 53, height: 811, scrollTop: 0, scrollHeight: 3500, paddingTop: 40 });
  scrollToAlign(padded.el);
  expect(padded.comment.top + 40).toBeCloseTo((53 + 40 + 53 + 811) / 2);
  const tall = layout({ top: 1500, height: 700 }, { top: 53, height: 811, scrollTop: 0, scrollHeight: 3500 });
  scrollToAlign(tall.el);
  expect(tall.comment.top).toBe(53);
});

test("revealCentred is Linear's aMt: centre now, and again after 100 ms only when the comment isn't all in view", () => {
  const c = clock(),
    frames: (() => void)[] = [];
  const frame = (run: FrameRequestCallback) => frames.push(() => run(0));
  const shown = layout({ top: 1500, height: 80 }, { top: 53, height: 811, scrollTop: 0, scrollHeight: 3500 });
  revealCentred(shown.el, c.timers, frame);
  frames.splice(0).forEach((run) => run());
  expect(shown.calls).toHaveLength(1);
  c.advance(RECHECK_MS);
  expect(frames).toHaveLength(0);
  // Late content pushed it below the window: the second look centres it again.
  const pushed = layout({ top: 1500, height: 80 }, { top: 53, height: 811, scrollTop: 0, scrollHeight: 3500 });
  revealCentred(pushed.el, c.timers, frame);
  frames.splice(0).forEach((run) => run());
  pushed.comment.top += 900;
  c.advance(RECHECK_MS);
  frames.splice(0).forEach((run) => run());
  expect(pushed.calls).toHaveLength(2);
  expect(pushed.comment.top + 40).toBeCloseTo(53 + 811 / 2);
});

test("R4-inbox-D2: a linked comment rings once per visit: not again on a remount, again on a new visit to the link", () => {
  const rung = new Set<string>();
  expect(ringsNow("comment-7", "comment-8", "k1", rung)).toBe(false);
  expect(ringsNow("", "", "k1", rung)).toBe(false);
  expect(ringsNow("comment-7", "comment-7", "k1", rung)).toBe(true);
  // Switching rows and back remounts the comment on the same history entry.
  expect(ringsNow("comment-7", "comment-7", "k1", rung)).toBe(false);
  expect(ringsNow("comment-7", "comment-7", "k2", rung)).toBe(true);
});
