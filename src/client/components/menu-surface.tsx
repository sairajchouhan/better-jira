import { autoUpdate } from "@floating-ui/react";
import {
  createContext,
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
import { createPortal } from "react-dom";

/** What a popup offers the menus inside it: closing it (every level at once), as a menu's Enter or a submenu's Escape does. */
export const MenuSurfaceContext = createContext<{ close: () => void } | null>(null);

export const MENU_POPUP =
  "view-popup rounded-xl border border-[var(--menu-line)] bg-[var(--menu)] text-fg-2 shadow-[var(--menu-shadow)] [--sel:var(--menu-sel)]";

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
  const update = useEffectEvent(() => {
    const node = ref.current;
    if (node) setStyle(place(anchor?.getBoundingClientRect() ?? null, node));
  });
  useLayoutEffect(() => {
    const node = ref.current;
    if (key === false || !node) return;
    // A virtual reference, so the anchor's scroll parents are watched but not its size.
    const reference = {
      getBoundingClientRect: () => anchor?.getBoundingClientRect() ?? new DOMRect(),
      contextElement: anchor ?? undefined,
    };
    return autoUpdate(reference, node, () => update(), { layoutShift: false });
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
    if (e.key !== "Tab" || !ref.current) return;
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
  return createPortal(
    <MenuSurfaceContext value={{ close }}>
      <div className="fixed inset-0" style={{ zIndex: 40 }} onMouseDown={(e) => outside(e, close)} />
      <div
        ref={popup}
        data-popover
        tabIndex={-1}
        className="fixed z-40 max-w-[calc(100vw-24px)] outline-none"
        style={style}
        onKeyDown={(e) => {
          e.stopPropagation();
          keys(e);
        }}
      >
        {children}
      </div>
    </MenuSurfaceContext>,
    document.body,
  );
}

/** A modal menu or dialog over a backdrop that closes it, with measured placement and a centered small-screen fallback. */
/** `fit` sizes the surface to its content, like Linear's action menus. */
/** `command` places Linear's command menu (RAJ-52 "Mark as"): centred, 110px from the top, no backdrop or padding. */
/** `point` opens a right-click menu there (already offset by the caller), moved up or left to stay 10px inside the window (Linear, RAJ-52). */
/** Unanchored, it sits 12vh from the top; `placement="third"` is Linear's DialogPresenter instead (`uo.show`, styles `jY`): spacers
 *  growing 1 and 2 above and below put the dialog a third of the free height down, 16px inside the window at the least. */
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
  placement?: "top" | "third";
}) {
  const ref = useRef<HTMLDivElement>(null);
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
        h = Math.min(node.scrollHeight + node.offsetHeight - node.clientHeight, innerHeight - 24); // scrollHeight leaves out the border, which max-height (border-box) includes
      // no transform: it would re-anchor nested fixed menus
      if (point)
        return {
          position: "fixed",
          width: fit ? undefined : w,
          left: Math.max(10, Math.min(innerWidth - w - 10, point.x)),
          top: Math.max(10, Math.min(innerHeight - h - 10, point.y)),
          maxHeight: innerHeight - 20,
        };
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
  return (
    <div
      className={`fixed inset-0 z-50 ${anchored || command ? "" : "bg-black/40"}`}
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
        className={`overflow-y-auto rounded-xl border border-[var(--menu-line)] bg-[var(--menu)] text-fg-2 shadow-[var(--menu-shadow)] [--sel:var(--menu-sel)] ${fit ? "w-max min-w-[175px] max-w-[min(500px,calc(100vw-24px))]" : command ? "flex flex-col overflow-hidden" : "p-3"}`}
        onKeyDown={(e) => {
          if (!((e.metaKey || e.ctrlKey) && ["k", "/"].includes(e.key.toLowerCase())))
            e.stopPropagation(); // ⌘K reaches the app so it can toggle the command menu
          keys(e);
        }}
      >
        <MenuSurfaceContext value={{ close }}>{children}</MenuSurfaceContext>
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
