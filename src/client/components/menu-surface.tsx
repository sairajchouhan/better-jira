import {
  createContext,
  use,
  useEffectEvent,
  useLayoutEffect,
  useRef,
  useState,
  type CSSProperties,
  type KeyboardEvent,
  type ReactNode,
  type RefObject,
} from "react";
import { createPortal, flushSync } from "react-dom";
import { Popover as AriaPopover } from "react-aria-components";
import { anchoredPlacement, menuRoom } from "./menu-geometry";

/** What a popup offers the menus inside it: closing it (every level at once), as a menu's Enter or a submenu's Escape does. */
export const MenuSurfaceContext = createContext<{ close: () => void } | null>(null);

/**
 * The elevation level of the surface around us (0 on the page). control-tokens.css paints `[data-elevation]` with
 * Linear's menu theme and `[data-elevation="2"]` with that theme elevated again. Context, not CSS nesting, because
 * nested surfaces are often portalled out of their parent's DOM.
 */
const Elevation = createContext(0);

/**
 * The one elevation mechanism every popup surface goes through: spread `props` on the surface element and, when it
 * renders surfaces of its own, wrap them in `<ElevationScope level={level}>`.
 *
 * Linear paints menus and popovers with `theme.menuTheme()`, which returns itself on a menu theme, so a surface opened
 * from inside another (a submenu, a menu in a dialog) stays at its level: `surface`. Only a Select's list (`eAe`,
 * startup-root.CnUSfl4j.js) climbs: `elevation: menuTheme() === theme ? 2 : 1`, so `raised` is one above what is
 * around it. Live dark: a submenu of a menu in Create issue paints 12.72 (level 1), the Grouping list in Display
 * options 16.432 (level 2).
 *
 * `dialog` is a DialogPresenter box: it paints Linear's elevated theme (`data-elevation="dialog"`, control-tokens.css),
 * not the menu theme, while what opens inside it keeps the levels above; Linear shows menus from its root presenter, so
 * a menu in a dialog is the page's menu theme (live: Create issue's More actions paints 12.72).
 */
export function useElevation(variant: "surface" | "raised" | "dialog" = "surface") {
  const outer = use(Elevation);
  const level = variant === "raised" ? outer + 1 : Math.max(outer, 1);
  return { level, props: { "data-elevation": variant === "dialog" ? "dialog" : level } };
}

/** Hands a surface's level to the surfaces opened from inside it. */
export function ElevationScope({ level, children }: { level: number; children: ReactNode }) {
  return <Elevation value={level}>{children}</Elevation>;
}

/** The shell every hand-built popup shares (Linear's menu surface). Spread `useElevation().props` beside it. */
export const MENU_POPUP =
  "view-popup rounded-xl border border-[var(--menu-line)] bg-[var(--menu)] text-fg-2 shadow-[var(--menu-shadow)] [--sel:var(--menu-sel)]";

/** An elevated box: radius 12, a thinPixel bgBorderThin border and bgBase, read inside its own theme scope. */
const ELEVATED_BOX =
  "view-popup rounded-xl border-[length:var(--thin-pixel)] border-solid border-[var(--border-thin)] bg-[var(--panel)] text-fg-2 [--sel:var(--menu-sel)]";

/**
 * Linear's popover `Y` (ViewOptions.2m5-Tfth.js `Z.popover`): the elevated box with shadowMedium. The toolbar popovers
 * (Display options, Advanced filter) use it.
 */
export const POPOVER_SURFACE = `${ELEVATED_BOX} shadow-[var(--menu-shadow)]`;

/** Linear's DialogPresenter box (`jY.content` with `Tu.bgBorder`): the elevated box with shadowHigh, a column with no padding
 *  of its own (each dialog's slots pad themselves; dialog.css). Dialog renders it. */
export const DIALOG_SURFACE = `${ELEVATED_BOX} flex flex-col shadow-[var(--shadow-high)]`;

/**
 * Linear's keyboard-shortcuts panel (HelpCenter.RUjT1v_p.js `vn.animatingContainer`), inside the same elevated theme (`se`
 * is `w_`): radius 12, bgBase, a 1px solid bgBorderFaint border and shadowMedium, not the dialog's thinPixel bgBorderThin
 * and shadowHigh. A column that clips; the content scrolls. Dialog's `side` placement renders it.
 */
export const SIDE_PANEL_SURFACE =
  "view-popup side-panel flex flex-col overflow-clip rounded-xl border border-solid border-[var(--border-faint)] bg-[var(--panel)] text-fg-2 shadow-[var(--menu-shadow)] [--sel:var(--menu-sel)]";

/**
 * Keeps a fixed popup placed: runs `compute` now and again as the window resizes, as anything outside the popup scrolls (the
 * anchor's scroll parents among them) and as the popup itself resizes, and hands each result to `apply`. The first result is applied
 * as it comes (the caller is a layout effect, which React commits before paint); later ones are flushed at once, as a ResizeObserver
 * or a scroll runs before the browser paints and a plain update would land a frame late (the Help menu jumping as it opened). The
 * anchor's own resizes and layout shifts are deliberately not watched, so a menu stays put while the issue it edits changes.
 * Returns the stop.
 */
export function watchPlacement<T>(floating: HTMLElement, compute: () => T, apply: (value: T) => void) {
  let mounted = false;
  const run = () => {
    const next = compute();
    if (mounted) flushSync(() => apply(next));
    else apply(next);
  };
  run();
  mounted = true;
  const resized = new ResizeObserver(run);
  resized.observe(floating);
  const scrolled = (event: Event) => {
    if (event.target instanceof Node && floating.contains(event.target)) return;
    run();
  };
  addEventListener("scroll", scrolled, { capture: true, passive: true });
  addEventListener("resize", run);
  return () => {
    resized.disconnect();
    removeEventListener("scroll", scrolled, { capture: true });
    removeEventListener("resize", run);
  };
}

/**
 * The one placement engine every popup uses. `place` turns the anchor's box (null without one) and the popup node into the popup's
 * fixed style, again whenever watchPlacement says it may have moved. A popup at a point or the caret computes that box inside
 * `place`. A new anchor or `key` re-places; `false` leaves the node alone. `place` is read fresh each time.
 */
export function usePlacement<T extends HTMLElement>(
  ref: RefObject<T | null>,
  anchor: Element | null | undefined,
  place: (anchor: DOMRect | null, popup: T) => CSSProperties,
  key: string | false,
) {
  const [style, setStyle] = useState<CSSProperties>();
  const compute = useEffectEvent((node: T) => place(anchor?.getBoundingClientRect() ?? null, node));
  useLayoutEffect(() => {
    const node = ref.current;
    if (key === false || !node) return;
    return watchPlacement(node, () => compute(node), setStyle);
    // oxlint-disable-next-line react/exhaustive-effect-dependencies -- A new anchor re-places, though `compute` reads it fresh.
  }, [ref, anchor, key]);
  return key === false ? undefined : style;
}

// Tab stops only: a roving tablist's other tabs (tabindex -1) are reached with arrows, so they are not the trap's ends.
const FOCUSABLE = [
  "button:not(:disabled)",
  'input:not([type="file"])',
  "textarea",
  "select",
  '[contenteditable="true"]',
  '[tabindex="0"]',
]
  .map((selector) => `${selector}:not([tabindex="-1"])`)
  .join();
const returnTargets = new WeakMap<Element, HTMLElement | null>();

/**
 * Where focus goes when a popup closes: `returnTo`, else what had focus when it opened; when that was inside a popup that has
 * since closed (a menu item opening a dialog), what opened that popup. While focus is lost to the body after that (the opener
 * re-rendered away), the opener's new node is found by its `data-key`. Every popup and Dialog share it. Returns the opener.
 */
export function useReturnFocus(ref: RefObject<HTMLElement | null>, returnTo?: RefObject<HTMLElement | null>) {
  const [opener] = useState(() => document.activeElement as HTMLElement | null);
  const [fallback] = useState(() => {
    const parent = opener?.closest('[role="dialog"]');
    return parent ? (returnTargets.get(parent) ?? null) : null;
  });
  useLayoutEffect(() => {
    const node = ref.current,
      target = returnTo?.current ?? opener;
    if (node) returnTargets.set(node, opener?.closest('[role="dialog"]') ? fallback : opener);
    return () => {
      const back = target?.isConnected ? target : fallback?.isConnected ? fallback : null;
      back?.focus();
      // The opener may re-render away as the menu's action lands (a card moved to another column), now or a few frames on:
      // while focus is lost to the body, give it to the opener's new node, found by its key.
      const key = (target ?? fallback)?.closest<HTMLElement>("[data-key]")?.dataset.key;
      if (!key) return;
      const until = performance.now() + 500;
      const refocus = () => {
        const active = document.activeElement;
        if (active === document.body) {
          const node = [...document.querySelectorAll<HTMLElement>(`[data-key="${CSS.escape(key)}"]`)].find(
            (node) => node.getClientRects().length,
          );
          if (node) return node.focus();
        } else if (active !== back) return;
        if (performance.now() < until) requestAnimationFrame(refocus);
      };
      requestAnimationFrame(refocus);
    };
  }, [ref, opener, fallback, returnTo]);
  return opener;
}

/** What `initialFocusTarget` reads of a node: the DOM's own, so a test can hand it plain objects. */
export type FocusCandidate = {
  matches(selector: string): boolean;
  querySelectorAll(selector: string): Iterable<FocusCandidate>;
  getAttribute(name: string): string | null;
};

/**
 * Where a popup's first focus goes: the popup itself when it matches a selector, else its first descendant that does, by
 * `initialFocus`'s priority. A descendant taken out of the tab order (`tabindex="-1"`) is passed over: React Aria's hidden
 * Dismiss buttons open and close every Popover, and a menu with no search (the filter row's Save menu) otherwise started on
 * one, so ↓ Enter dismissed it instead of picking.
 */
export function initialFocusTarget<T extends FocusCandidate>(node: T, initialFocus: readonly string[]): T | null {
  for (const selector of initialFocus) {
    if (node.matches(selector)) return node;
    for (const child of node.querySelectorAll(selector) as Iterable<T>)
      if (child.getAttribute("tabindex") !== "-1") return child;
  }
  return null;
}

/** A frame after opening, focus moves to `initialFocusTarget` unless a child already took it. The popup node itself holding
 *  focus counts as not taken (React Aria's Dialog focuses itself first). A target that can't take focus (a plain `role=dialog`
 *  box) is made focusable from script only, so keys typed next reach the popup's own handlers instead of the page. */
export function useInitialFocus(ref: RefObject<HTMLElement | null>, initialFocus: readonly string[]) {
  useLayoutEffect(() => {
    const node = ref.current;
    const frame = requestAnimationFrame(() => {
      if (!node || (node.contains(document.activeElement) && document.activeElement !== node)) return;
      const target = initialFocusTarget(node, initialFocus);
      if (!target) return;
      target.focus();
      if (document.activeElement === target) return;
      target.tabIndex = -1;
      target.focus();
    });
    return () => cancelAnimationFrame(frame);
  }, [ref, initialFocus]);
}

/**
 * The focus policy every hand-built modal popup shares: initial focus (useInitialFocus), Tab wrapping inside and Escape closing (the
 * returned onKeyDown), and focus handed back on close (useReturnFocus).
 */
function usePopupFocus(
  ref: RefObject<HTMLElement | null>,
  close: () => void,
  initialFocus: readonly string[],
  returnTo?: RefObject<HTMLElement | null>,
) {
  const opener = useReturnFocus(ref, returnTo);
  useInitialFocus(ref, initialFocus);
  const keys = (e: KeyboardEvent) => {
    if (e.key === "Escape") {
      e.preventDefault();
      close();
    }
    // A menu's Tab moves its highlight instead.
    if (e.key !== "Tab" || e.defaultPrevented || !ref.current) return;
    const nodes = [...ref.current.querySelectorAll<HTMLElement>(FOCUSABLE)].filter(
      (n) => n.getClientRects().length,
    );
    if (!nodes.length) e.preventDefault();
    // Shift+Tab from the first stop, or from a box that holds focus but is no stop (the popup, Display options' dialog), wraps.
    else if (e.shiftKey && (document.activeElement === nodes[0] || !nodes.includes(document.activeElement as HTMLElement))) {
      e.preventDefault();
      nodes.at(-1)?.focus();
    } else if (!e.shiftKey && document.activeElement === nodes.at(-1)) {
      e.preventDefault();
      nodes[0]?.focus();
    }
  };
  return { keys, opener };
}

// A field you type into: not a checkbox, a colour well or any other input that is really a button (the view icon picker's custom
// colour sits above its search).
export const TEXT_INPUT = `input${["file", "checkbox", "radio", "color", "range", "button", "submit", "reset", "image", "hidden"]
  .map((type) => `:not([type="${type}"])`)
  .join("")}`;
// Keep focus a child already took (autoFocus); else prefer a text field over the first button in DOM order. Dialog uses it too.
export const MENU_FOCUS = ["[data-autofocus]", `${TEXT_INPUT},textarea,[contenteditable="true"]`, 'button,[tabindex="0"]'];
// A search when there is one; else the popup's own box, so no control shows a focus ring until Tab (Linear's focus-trap start).
// A box that names itself a dialog (Display options) holds the keys handler, so it comes before the React Aria node around it.
export const POPOVER_FOCUS = [TEXT_INPUT, '[role="dialog"]', "[data-popover]"];

/**
 * A toolbar menu (Linear's menuPosition) in a fixed popup under its trigger: "bottom-left" 4px under it, flush and rounded;
 * "bottom-right" 6px under it, right edges flush. Esc and a press outside it close it; the press lands on a clear backdrop, so it
 * does nothing else (not even toggle the trigger). Focus moves in, Tab stays inside, and closing returns focus to the trigger. Escape
 * from a nested surface (a dropdown inside) closes only that one. `popup` is the popup node, for submenus portalled into it.
 */
export function Popover({
  trigger,
  placement,
  popup,
  close,
  children,
}: {
  trigger: RefObject<HTMLElement | null>;
  placement: "bottom-left" | "bottom-right";
  popup: RefObject<HTMLDivElement | null>;
  close: () => void;
  children: ReactNode;
}) {
  const { keys } = usePopupFocus(popup, close, POPOVER_FOCUS, trigger);
  const [anchor] = useState(() => trigger.current);
  const style = usePlacement(
    popup,
    anchor,
    (r) =>
      !r
        ? { visibility: "hidden" }
        : placement === "bottom-left"
          ? { top: Math.round(r.bottom + 4), left: Math.round(r.left) }
          : { top: r.bottom + 6, right: innerWidth - r.right },
    placement,
  );
  const elevation = useElevation();
  return (
    <MenuSurfaceContext value={{ close }}>
      <AriaPopover
        isOpen
        onOpenChange={(open) => {
          if (!open) close();
        }}
        triggerRef={trigger}
        shouldCloseOnInteractOutside={outsideOf}
        ref={popup}
        data-popover
        {...elevation.props}
        // The box focus starts on (POPOVER_FOCUS) shows no ring: Tab moves to the first control, which does.
        className="max-w-[calc(100vw-24px)] outline-none [&_[role=dialog]]:outline-none"
        style={{ ...placed(style), zIndex: 40 }}
      >
        {/* React Aria's Popover takes no key handlers; its own Escape covers the popover itself while it holds focus. */}
        <div
          className="contents"
          onKeyDown={(e) => {
            e.stopPropagation();
            keys(e);
          }}
        >
          <ElevationScope level={elevation.level}>{children}</ElevationScope>
        </div>
      </AriaPopover>
    </MenuSurfaceContext>
  );
}

/** A press in another popup (a Select's list or a submenu opened from inside, portalled elsewhere) is not outside this one. */
const outsideOf = (element: Element) => !element.closest("[data-surface], [data-popover], .menu-submenu");

/** Our fixed placement over React Aria's own (absolute, with top/left or bottom/right of its choosing). */
function placed(style: CSSProperties | undefined): CSSProperties {
  if (!style) return { position: "fixed", top: 0, left: 0, visibility: "hidden" };
  return {
    position: "fixed",
    top: "auto",
    left: "auto",
    right: "auto",
    bottom: "auto",
    maxHeight: "none",
    ...style,
  };
}

/** A modal menu, React Aria's Popover, with measured placement and a centered small-screen fallback (Dialog is the modal box). */
/** `fit` sizes the surface to its content, like Linear's action menus. */
/** `command` places Linear's command menu (RAJ-52 "Mark as"): centred, 110px from the top, no backdrop or padding. */
/** `point` is a right-click's raw clientX/clientY: the menu opens 4px right of and 1px above it (Linear's list-row context menu, CORE-18),
 *  moved up or left to stay 10px inside the window (Linear, RAJ-52). */
/** Unanchored, it sits 12vh from the top. */
/** `gap` is the space under the anchor; `side="left"` opens beside it instead, top 5.5px above its top (Linear's label menu, RAJ-52); `align="end"` lines up the right edges (its reaction picker). */
export function MenuSurface({
  label,
  children,
  close,
  anchorId,
  anchor,
  width = 640,
  fit = false,
  gap = 5,
  rounding = "none",
  side,
  align,
  command = false,
  point,
  dismiss = close,
}: {
  label: string;
  children: ReactNode;
  close: () => void;
  /** What a press on the backdrop does; `close` (as Escape) unless the owner says otherwise. Linear's fast-create modal
   *  minimizes there instead (`handleMinimize`, LinearLayout `Qr`), keeping its draft without asking. */
  dismiss?: () => void;
  anchorId?: string;
  anchor?: HTMLElement | null;
  width?: number;
  fit?: boolean;
  gap?: number;
  /** Linear action menus round their anchor edge; property pickers retain fractional geometry. */
  rounding?: "pixel" | "none";
  side?: "left";
  point?: { x: number; y: number };
  align?: "end";
  command?: boolean;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const elevation = useElevation("surface");
  const { keys, opener } = usePopupFocus(ref, close, MENU_FOCUS);
  // The previously focused element is only a useful anchor when it is a real control, not <body> after keyboard navigation.
  const [fallback] = useState(
    () =>
      (anchorId ? document.getElementById(anchorId) : null) ??
      (opener && opener !== document.body ? opener : null),
  );
  const anchored = !!anchorId || !!anchor || !!point;
  const style = usePlacement(
    ref,
    anchor ?? fallback,
    (r, node) => {
      const w = Math.min(fit ? node.getBoundingClientRect().width : width, innerWidth - 24),
        natural = node.scrollHeight + node.offsetHeight - node.clientHeight, // scrollHeight leaves out the border, which max-height (border-box) includes
        h = Math.min(natural, innerHeight - 24);
      // no transform: it would re-anchor nested fixed menus
      if (point) {
        // Linear's _3e room for a menu at a point (no row: `y`, the window less VIEWPORT_PADDING each end), and S3e's clamp to 10px
        // inside the window (`nT`), so a menu as tall as its room sits 10px from the top.
        const room = menuRoom(innerHeight);
        return {
          position: "fixed",
          width: fit ? undefined : w,
          left: Math.max(10, Math.min(innerWidth - w - 10, point.x + 4)),
          top: Math.max(10, Math.min(innerHeight - Math.min(natural, room) - 10, point.y - 1)),
          maxHeight: room,
        };
      }
      if (command) {
        const cw = Math.min(width, innerWidth - 32);
        return {
          position: "fixed",
          width: cw,
          left: (innerWidth - cw) / 2,
          top: 110,
          maxHeight: innerHeight - 126,
        };
      }
      if (anchored && r?.width && innerWidth >= 600) {
        if (side === "left" && r.left - w - gap >= 12)
          return {
            position: "fixed",
            width: fit ? undefined : w,
            left: r.left - w - gap,
            top: Math.max(12, Math.min(innerHeight - h - 12, r.top - 5.5)),
            maxHeight: innerHeight - 24,
          };
        // Linear's _3e room on the preferred side (below), the whole window only when that side has under 30% of it; the menu
        // cuts its list to the room (useListHeight), and sits below, else above, else as low as fits.
        const below = rounding === "pixel" ? Math.round(r.bottom) : r.bottom;
        const { top, maxHeight } = anchoredPlacement({
          trigger: { top: r.top, bottom: below, width: r.width },
          height: h,
          windowHeight: innerHeight,
          gap,
        });
        return {
          position: "fixed",
          width: fit ? undefined : w,
          left: Math.max(12, Math.min(align === "end" ? r.right - w : r.left, innerWidth - w - 12)),
          top,
          maxHeight,
        };
      }
      return {
        position: "fixed",
        width: fit ? undefined : w,
        left: (innerWidth - w) / 2,
        top: "12vh",
        maxHeight: "80vh",
      };
    },
    [anchorId, anchored, width, label, gap, rounding, side, align, command, point?.x, point?.y].join(),
  );
  const [trigger] = useState(() => ({ current: anchor ?? fallback ?? null }));
  // A menu is React Aria's Popover: modal, over a clear underlay that takes the press outside it, with everything else inert while it
  // is open. Escape and Tab inside it stay ours (usePopupFocus). An unanchored menu (12vh from the top) dims the page behind it.
  return (
    <>
      {!anchored &&
        !command &&
        createPortal(<div aria-hidden className="fixed inset-0 z-50 bg-[var(--modal-overlay)]" />, document.body)}
      <AriaPopover
        isOpen
        onOpenChange={(open) => {
          if (!open) dismiss();
        }}
        triggerRef={trigger}
        shouldCloseOnInteractOutside={outsideOf}
        ref={ref}
        aria-label={label}
        {...elevation.props}
        data-surface="menu"
        className={`${MENU_POPUP} overflow-y-auto ${fit ? "w-max min-w-[175px] scroll-py-6 max-w-[min(500px,calc(100vw-24px))]" : command ? "flex flex-col overflow-hidden" : "p-3"}`}
        style={{ ...placed(style), zIndex: 50 }}
      >
        {/* React Aria's Popover takes no key handlers; its own Escape covers the popover itself while it holds focus. */}
        <div
          className="contents"
          onKeyDown={(e) => {
            if (!((e.metaKey || e.ctrlKey) && ["k", "/"].includes(e.key.toLowerCase())))
              e.stopPropagation(); // ⌘K reaches the app so it can toggle the command menu
            keys(e);
          }}
        >
          <MenuSurfaceContext value={{ close }}>
            <ElevationScope level={elevation.level}>{children}</ElevationScope>
          </MenuSurfaceContext>
        </div>
      </AriaPopover>
    </>
  );
}

/** The issue's sub-issue row (a shortcut over a row), else a property row in the open issue, else the issue's visible card, so pickers open beside what they change. */
export function issueAnchor(id: string, key: string): HTMLElement | null {
  return (
    document.querySelector<HTMLElement>(`[data-sub-issue="${CSS.escape(key)}"]`) ??
    document.getElementById(id) ??
    [...document.querySelectorAll<HTMLElement>(`[data-key="${CSS.escape(key)}"]`)].find(
      (n) => n.getClientRects().length,
    ) ??
    null
  );
}
