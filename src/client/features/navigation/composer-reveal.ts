import { FOCUS_AT_EVENT, type FocusAt } from "@/client/features/editor/title-flow";

/** Linear's delay before its composer answers `newComment` (`setTimeout(…, 100)`): the route has settled by then, so the
 *  router's scroll to the top of a newly opened issue (`scrollToTopSelectors`) doesn't undo the reveal. */
export const COMPOSER_REVEAL_DELAY = 100;
/** How long the reveal follows content that lands after it. Linear's activity is local and complete when the composer
 *  mounts; ours gets Jira's history a few hundred ms after the details (BJ-13), and those rows land among the last
 *  comments, in view, where the browser's scroll anchoring doesn't compensate. */
export const COMPOSER_REVEAL_HOLD = 3000;
/** The person's own scroll, press or key: the page is theirs again. */
export const REVEAL_STOPS = ["wheel", "touchstart", "pointerdown", "keydown"] as const;

/** The reveal's keep-or-stop rule, without the DOM: reveal now, and again each time the page grows while the composer
 *  still has focus; once stopped (the person's input, the hold running out, or focus gone) it never reveals again. */
export function revealHold(reveal: () => void, focused: () => boolean) {
  let live = true;
  reveal();
  return {
    grew() {
      if (!live) return;
      if (focused()) reveal();
      else live = false;
    },
    stop() {
      live = false;
    },
    get live() {
      return live;
    },
  };
}

/** Linear's editor `scrollIntoView` (`e => view.dom.scrollIntoView(e)`), called with nothing: block "start", which at the
 *  page's end is the scroller's end, so the whole composer and the space under it show. */
export const scrollComposer = (node: HTMLElement) => node.scrollIntoView();

function scrollParent(node: HTMLElement, view: Window) {
  for (let el = node.parentElement; el; el = el.parentElement)
    if (/auto|scroll/.test(view.getComputedStyle(el).overflowY)) return el;
}

/** Linear's composer reveal, `view.dom.scrollIntoView()` with no options (block "start": at the page's end, the scroller's
 *  end), held while late content grows the page. */
function reveal(node: HTMLElement) {
  const hold = revealHold(
    () => scrollComposer(node),
    () => node.isConnected && node.contains(node.ownerDocument.activeElement),
  );
  const view = node.ownerDocument.defaultView,
    scroller = view && scrollParent(node, view);
  if (!view || !scroller || typeof ResizeObserver === "undefined") return;
  const end = () => {
    hold.stop();
    observer.disconnect();
    clearTimeout(timer);
    for (const type of REVEAL_STOPS) view.removeEventListener(type, end, true);
  };
  const observer = new ResizeObserver(() => {
    hold.grew();
    if (!hold.live) end();
  });
  for (const child of scroller.children) observer.observe(child);
  const timer = setTimeout(end, COMPOSER_REVEAL_HOLD);
  for (const type of REVEAL_STOPS) view.addEventListener(type, end, { capture: true, passive: true });
}

/** Focuses the comment composer a command opens, as Linear's "Comment on issue" (⌃M, `newComment`) does: the composer's
 *  `focusAtEnd()`, then the editor's `scrollIntoView()`, so the whole composer and the space under it show. The browser's
 *  own focus scroll showed only the caret's line, which left the composer cut off at the bottom edge. Like `focusNode`, it
 *  takes the command only when focus lands; the reveal waits for `later`. */
export function focusComposer(
  node: HTMLElement | null | undefined,
  later: (run: () => void) => void = (run) => void setTimeout(run, COMPOSER_REVEAL_DELAY),
  show: (node: HTMLElement) => void = reveal,
) {
  if (!node) return;
  // The editor takes the caret to its end and focuses without scrolling (ProseMirror's focus); anything else just focuses.
  if (node.dispatchEvent(new CustomEvent<FocusAt>(FOCUS_AT_EVENT, { detail: "end", cancelable: true })))
    node.focus({ preventScroll: true });
  const active = node.ownerDocument.activeElement;
  if (!active || !node.contains(active)) return;
  later(() => {
    if (node.isConnected) show(node);
  });
  return true as const;
}
