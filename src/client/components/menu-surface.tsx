import { autoUpdate } from "@floating-ui/react";
import {
  createContext,
  use,
  useEffectEvent,
  useLayoutEffect,
  useRef,
  useState,
  type CSSProperties,
  type KeyboardEvent,
  type MouseEvent,
  type ReactNode,
  type RefObject,
} from "react";
import { createPortal, flushSync } from "react-dom";

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
 *  of its own (each dialog's slots pad themselves; dialog.css). */
const DIALOG_SURFACE = `${ELEVATED_BOX} flex flex-col shadow-[var(--shadow-high)]`;

/**
 * Linear's keyboard-shortcuts panel (HelpCenter.RUjT1v_p.js `vn.animatingContainer`), inside the same elevated theme (`se`
 * is `w_`): radius 12, bgBase, a 1px solid bgBorderFaint border and shadowMedium, not the dialog's thinPixel bgBorderThin
 * and shadowHigh. A column that clips; the content scrolls.
 */
const SIDE_PANEL_SURFACE =
  "view-popup side-panel flex flex-col overflow-clip rounded-xl border border-solid border-[var(--border-faint)] bg-[var(--panel)] text-fg-2 shadow-[var(--menu-shadow)] [--sel:var(--menu-sel)]";

/**
 * The one placement engine every popup uses. `place` turns the anchor's box (null without one) and the popup node into the popup's
 * fixed style; floating-ui's autoUpdate runs it again on resize, on scrolls of the anchor's or popup's scroll parents, and when the
 * popup resizes. It deliberately ignores the anchor's own resizes and layout shifts, so a menu stays put while the issue it edits
 * changes. A popup at a point or the caret computes that box inside `place`. A new anchor or `key` re-places; `false` leaves the node
 * alone. `place` is read fresh each time.
 */
export function usePlacement<T extends HTMLElement>(
  ref: RefObject<T | null>,
  anchor: Element | null | undefined,
  place: (anchor: DOMRect | null, popup: T) => CSSProperties,
  key: string | false,
) {
  const [style, setStyle] = useState<CSSProperties>();
  const update = useEffectEvent((sync: boolean) => {
    const node = ref.current;
    if (!node) return;
    const next = place(anchor?.getBoundingClientRect() ?? null, node);
    // autoUpdate's later calls come from a ResizeObserver or a scroll, which run before the browser paints; a plain setState would
    // commit after that paint, so one frame shows the popup where its old size put it (the Help menu jumping as it opened).
    if (sync) flushSync(() => setStyle(next));
    else setStyle(next);
  });
  useLayoutEffect(() => {
    const node = ref.current;
    if (key === false || !node) return;
    // A virtual reference, so the anchor's scroll parents are watched but not its size.
    const reference = {
      getBoundingClientRect: () => anchor?.getBoundingClientRect() ?? new DOMRect(),
      contextElement: anchor ?? undefined,
    };
    // The first call runs inside this layout effect, where React already commits before paint (and flushSync may not run).
    let mounted = false;
    const cleanup = autoUpdate(reference, node, () => update(mounted), { layoutShift: false });
    mounted = true;
    return cleanup;
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
 * The focus policy every modal popup shares. A frame after opening, focus moves to the first match of `initialFocus` (selectors in
 * priority order) unless a child already took it. Tab wraps inside and Escape closes (the returned onKeyDown). Closing hands focus to
 * `returnTo`, else to what had focus when it opened; when that was inside a popup that has since closed (a menu item opening a
 * dialog), to what opened that popup.
 */
function usePopupFocus(
  ref: RefObject<HTMLElement | null>,
  close: () => void,
  initialFocus: readonly string[],
  returnTo?: RefObject<HTMLElement | null>,
) {
  const [opener] = useState(() => document.activeElement as HTMLElement | null);
  const [fallback] = useState(() => {
    const parent = opener?.closest('[role="dialog"]');
    return parent ? (returnTargets.get(parent) ?? null) : null;
  });
  useLayoutEffect(() => {
    const node = ref.current,
      target = returnTo?.current ?? opener;
    if (node) returnTargets.set(node, opener?.closest('[role="dialog"]') ? fallback : opener);
    const frame = requestAnimationFrame(() => {
      if (!node || node.contains(document.activeElement)) return;
      for (const selector of initialFocus) {
        const first = node.matches(selector) ? node : node.querySelector<HTMLElement>(selector);
        if (first) {
          first.focus();
          return;
        }
      }
    });
    return () => {
      cancelAnimationFrame(frame);
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
  }, [ref, opener, fallback, returnTo, initialFocus]);
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
    else if (e.shiftKey && (document.activeElement === nodes[0] || document.activeElement === ref.current)) {
      e.preventDefault();
      nodes.at(-1)?.focus();
    } else if (!e.shiftKey && document.activeElement === nodes.at(-1)) {
      e.preventDefault();
      nodes[0]?.focus();
    }
  };
  return { keys, opener };
}

/** A press on a backdrop closes its popup and nothing else: no focus moves to <body> (the opener gets it back), no click lands below. */
function outside(e: MouseEvent, close: () => void) {
  e.preventDefault();
  close();
}

// Keep focus a child already took (autoFocus); else prefer a text field over the first button in DOM order.
const MENU_FOCUS = [
  "[data-autofocus]",
  'input:not([type="file"]):not([type="checkbox"]),textarea,[contenteditable="true"]',
  'button,[tabindex="0"]',
];
// A search when there is one; else the popup itself, so no control shows a focus ring until Tab (Linear's focus-trap start).
const POPOVER_FOCUS = ['input:not([type="checkbox"])', "[data-popover]"];

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
  return createPortal(
    <MenuSurfaceContext value={{ close }}>
      <div className="fixed inset-0" style={{ zIndex: 40 }} onMouseDown={(e) => outside(e, close)} />
      <div
        ref={popup}
        data-popover
        tabIndex={-1}
        {...elevation.props}
        className="fixed z-40 max-w-[calc(100vw-24px)] outline-none"
        style={style}
        onKeyDown={(e) => {
          e.stopPropagation();
          keys(e);
        }}
      >
        <ElevationScope level={elevation.level}>{children}</ElevationScope>
      </div>
    </MenuSurfaceContext>,
    document.body,
  );
}

/** A modal menu or dialog over a backdrop that closes it, with measured placement and a centered small-screen fallback. */
/** `fit` sizes the surface to its content, like Linear's action menus. */
/** `command` places Linear's command menu (RAJ-52 "Mark as"): centred, 110px from the top, no backdrop or padding. */
/** `point` is a right-click's raw clientX/clientY: the menu opens 4px right of and 1px above it (Linear's list-row context menu, CORE-18),
 *  moved up or left to stay 10px inside the window (Linear, RAJ-52). */
/** Unanchored, it sits 12vh from the top; `placement="third"` is Linear's DialogPresenter instead (`uo.show`, styles `jY`): spacers
 *  growing 1 and 2 above and below put the dialog a third of the free height down, 16px inside the window at the least. */
/** `placement="side"` is Linear's keyboard-shortcuts panel (HelpCenter): 360px wide, 12px inside the window's top, right and
 *  bottom, sliding in from 20px right over the dimmed page. */
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
  placement = "top",
  variant = "menu",
}: {
  label: string;
  children: ReactNode;
  close: () => void;
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
  placement?: "top" | "third" | "side";
  /** `select`: a Select's list (`gy` popup), ringed with bgBorderSolidThin instead of the menu border; select.css.
   *  `dialog`: Linear's DialogPresenter box, in the elevated theme over bgModalOverlay (Dialog renders it). */
  variant?: "menu" | "select" | "dialog";
}) {
  const ref = useRef<HTMLDivElement>(null);
  const elevation = useElevation(variant === "select" ? "raised" : variant === "dialog" ? "dialog" : "surface");
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
      if (point)
        return {
          position: "fixed",
          width: fit ? undefined : w,
          left: Math.max(10, Math.min(innerWidth - w - 10, point.x + 4)),
          // Clamped to its own max-height, so a menu taller than the window keeps 10px off both edges.
          top: Math.max(10, Math.min(innerHeight - Math.min(natural, innerHeight - 20) - 10, point.y - 1)),
          maxHeight: innerHeight - 20,
        };
      if (placement === "side")
        return { position: "fixed", top: 12, right: 12, bottom: 12, width: Math.min(360, innerWidth - 24) };
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
        const below = innerHeight - r.bottom - 12,
          above = r.top - 12;
        const maxHeight = Math.max(100, Math.min(h, Math.max(below, above)));
        if (side === "left" && r.left - w - gap >= 12)
          return {
            position: "fixed",
            width: fit ? undefined : w,
            left: r.left - w - gap,
            top: Math.max(12, Math.min(innerHeight - h - 12, r.top - 5.5)),
            maxHeight: innerHeight - 24,
          };
        return {
          position: "fixed",
          width: fit ? undefined : w,
          left: Math.max(12, Math.min(align === "end" ? r.right - w : r.left, innerWidth - w - 12)),
          top: Math.max(
            12,
            Math.min(
              innerHeight - maxHeight - 12,
              below >= h || below >= above
                ? (rounding === "pixel" ? Math.round(r.bottom) : r.bottom) + gap
                : r.top - h - gap,
            ),
          ),
          maxHeight,
        };
      }
      if (placement === "third") {
        const dw = Math.min(fit ? node.getBoundingClientRect().width : width, innerWidth - 32),
          dh = Math.min(h, innerHeight - 32);
        return {
          position: "fixed",
          width: fit ? undefined : dw,
          left: (innerWidth - dw) / 2,
          top: Math.max(16, (innerHeight - dh) / 3),
          maxHeight: innerHeight - 32,
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
    [anchorId, anchored, width, label, gap, rounding, side, align, command, placement, point?.x, point?.y].join(),
  );
  const panel = placement === "side";
  return (
    <div
      // Linear's side panel dims with its `g_` backdrop: bgModalOverlay at opacity .95.
      className={`fixed inset-0 z-50 ${anchored || command ? "" : panel ? "bg-[color-mix(in_srgb,var(--modal-overlay)_95%,transparent)]" : "bg-[var(--modal-overlay)]"}`}
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) outside(e, close);
      }}
    >
      <div
        ref={ref}
        style={style}
        role="dialog"
        aria-modal="true"
        aria-label={label}
        {...elevation.props}
        data-surface={variant}
        className={
          panel
            ? SIDE_PANEL_SURFACE
            : `${variant === "dialog" ? DIALOG_SURFACE : MENU_POPUP} overflow-y-auto ${fit ? "w-max min-w-[175px] scroll-py-6 max-w-[min(500px,calc(100vw-24px))]" : command ? "flex flex-col overflow-hidden" : variant === "dialog" ? "" : "p-3"}`
        }
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
    </div>
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
