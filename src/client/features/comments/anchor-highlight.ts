import { useEffect, useLayoutEffect, useState } from "react";
import { useRouterState } from "@tanstack/react-router";

/**
 * Linear's highlight of a linked comment (startup-root `NL`, used by the comment as `variant: "outline"`): the comment
 * holds an accent ring for 7 s (`nMt = 7 * SECOND`), then fades it out over 600 ms (`rMt`), or over 150 ms (`iMt`) once a
 * mouse press anywhere ends it early (`tMt`). The ring's own fade-in (0.3 s after 0.4 s) is CSS (`.anchor-highlight`).
 */
export const HIGHLIGHT_MS = 7000;
export const FADE_MS = 600;
export const FAST_FADE_MS = 150;
/** Linear's `aMt`: the second look after the first centring, for content that moved the target meanwhile. */
export const RECHECK_MS = 100;

export type HighlightPhase = "in" | "out" | "fast-out";

type Timers = {
  setTimeout: (run: () => void, ms: number) => unknown;
  clearTimeout: (id: never) => void;
};
const realTimers: Timers = {
  setTimeout: (run, ms) => setTimeout(run, ms),
  clearTimeout: (id) => clearTimeout(id),
};

/** NL's timeline without React: `start` rings, `press` fades fast, and `show` hears each phase, `undefined` once gone. */
export function highlightTimeline(show: (phase: HighlightPhase | undefined) => void, timers: Timers = realTimers) {
  let timer: unknown;
  let phase: HighlightPhase | undefined;
  const go = (next: HighlightPhase | undefined, after?: number) => {
    if (timer !== undefined) timers.clearTimeout(timer as never);
    timer = undefined;
    phase = next;
    show(next);
    if (next === "in") timer = timers.setTimeout(() => go("out", FADE_MS), HIGHLIGHT_MS);
    else if (next) timer = timers.setTimeout(() => go(undefined), after ?? FADE_MS);
  };
  return {
    start: () => go("in"),
    press: () => {
      if (phase === "in") go("fast-out", FAST_FADE_MS);
    },
    stop: () => {
      if (timer !== undefined) timers.clearTimeout(timer as never);
      timer = undefined;
    },
    get phase() {
      return phase;
    },
  };
}

type Align = "start" | "end" | "center" | "nearest";
/** Linear's `t6e`: how far a scroller moves so the span [top, bottom] sits at `align` within [viewTop, viewBottom]. */
export function alignDelta(top: number, bottom: number, viewTop: number, viewBottom: number, align: Align) {
  if (align === "start") return top - viewTop;
  if (align === "end") return bottom - viewBottom;
  if (align === "nearest") {
    const above = top < viewTop;
    if (above === bottom > viewBottom) return 0;
    return above === bottom - top > viewBottom - viewTop ? bottom - viewBottom : top - viewTop;
  }
  return (top + bottom) / 2 - (viewTop + viewBottom) / 2;
}

const px = (value: string) => Number.parseFloat(value) || 0;
const scrollsY = (overflow: string) => /auto|scroll|overlay/.test(overflow);
function scrollParent(el: Element): Element | null {
  const doc = el.ownerDocument;
  for (let p = el.parentElement; p; p = p.parentElement) {
    if (p === doc.scrollingElement) return p;
    if (scrollsY(doc.defaultView!.getComputedStyle(p).overflowY)) return p;
  }
  return doc.scrollingElement;
}

/**
 * Linear's `oT(element, align)`: every scroller from the target outwards moves just enough to put it at `align`,
 * honouring each scroller's scroll-padding and the target's scroll-margin. A target taller than 70% of the window aligns
 * to its start instead, so its beginning shows. Vertical only: our panes never scroll comments sideways.
 */
export function scrollToAlign(el: Element, align: Align = "center") {
  const doc = el.ownerDocument,
    view = doc.defaultView;
  if (!view || !el.isConnected) return;
  const rect = el.getBoundingClientRect(),
    style = view.getComputedStyle(el);
  const top = rect.top - px(style.scrollMarginTop),
    bottom = rect.bottom + px(style.scrollMarginBottom);
  const to = bottom - top > view.innerHeight * 0.7 ? "start" : align;
  let moved = 0;
  for (let s = scrollParent(el); s; s = s === doc.scrollingElement ? null : scrollParent(s)) {
    const root = s === doc.scrollingElement,
      css = view.getComputedStyle(s);
    if (!root && !scrollsY(css.overflowY)) continue;
    const viewTop = root ? 0 : s.getBoundingClientRect().top + s.clientTop;
    const height = root ? view.innerHeight : s.clientHeight;
    const delta = alignDelta(
      top - moved,
      bottom - moved,
      viewTop + px(css.scrollPaddingTop),
      viewTop + height - px(css.scrollPaddingBottom),
      to,
    );
    if (delta !== 0) s.scrollBy({ top: delta, behavior: "instant" });
    moved += Math.max(-s.scrollTop, Math.min(delta, s.scrollHeight - s.clientHeight - s.scrollTop));
  }
}

/** Linear's `$jt`: the whole target is inside the window. */
function inWindow(el: Element) {
  const r = el.getBoundingClientRect(),
    view = el.ownerDocument.defaultView!;
  return r.top >= 0 && r.left >= 0 && r.bottom <= view.innerHeight && r.right <= view.innerWidth;
}

/** Linear's `aMt`, the comment highlight's `onHighlight`: centre at once, and again 100 ms later if it isn't all in view. */
export function revealCentred(el: Element, timers: Pick<Timers, "setTimeout"> = realTimers, frame = requestAnimationFrame) {
  frame(() => scrollToAlign(el));
  timers.setTimeout(() => {
    if (!inWindow(el)) frame(() => scrollToAlign(el));
  }, RECHECK_MS);
}

/** Anchors already highlighted, per history entry: Linear's `highlightedIds`, which its activity clears on a new location
 *  key. A remount (switching rows and back) doesn't ring again; a new visit to the link does. */
const shown = new Set<string>();

/** Whether `anchor` rings now: the address points at it, and this history entry hasn't rung it yet (it then counts as rung). */
export function ringsNow(anchor: string, hash: string, entry: string, rung: Set<string> = shown) {
  if (!anchor || hash !== anchor) return false;
  const mark = `${anchor}@${entry}`;
  if (rung.has(mark)) return false;
  rung.add(mark);
  return true;
}

/** The router's hash (without "#") and history entry. A hash set in place (`showAnchor`) keeps the entry. */
export function useLocationAnchor() {
  const hash = useRouterState({ select: (s) => s.location.hash });
  const entry = useRouterState({
    select: (s) => s.location.state.__TSR_key ?? s.location.href,
  });
  return { hash, entry };
}

/**
 * Rings `anchor` (an element id, "comment-<id>") while the address points at it, and centres it once on arrival: Linear's
 * `NL` with `shouldHighlight: isCommentIdInHash` and `onHighlight: aMt`. It follows the router's location rather than
 * `hashchange`, which fired before a newly opened issue's comments listened (R4-inbox-D2).
 */
export function useAnchorHighlight(anchor: string) {
  const { hash, entry } = useLocationAnchor();
  const [phase, setPhase] = useState<HighlightPhase>();
  const [timeline] = useState(() => highlightTimeline(setPhase));
  const target = !!anchor && hash === anchor;
  useLayoutEffect(() => {
    if (!target || !ringsNow(anchor, hash, entry)) return;
    timeline.start();
    const el = document.getElementById(anchor);
    if (el) revealCentred(el);
  }, [target, anchor, hash, entry, timeline]);
  useEffect(() => () => timeline.stop(), [timeline]);
  useEffect(() => {
    if (phase !== "in") return;
    const press = () => timeline.press();
    document.addEventListener("mousedown", press);
    return () => document.removeEventListener("mousedown", press);
  }, [phase, timeline]);
  return phase;
}
