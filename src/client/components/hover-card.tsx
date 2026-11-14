import { useId, useState, type ReactNode } from "react";
import {
  autoUpdate,
  flip,
  FloatingPortal,
  offset,
  safePolygon,
  shift,
  useDismiss,
  useFloating,
  useFocus,
  useHover,
  useInteractions,
  type Placement,
} from "@floating-ui/react";

/** Where a card opens and where it flips to. Linear's interactive tooltip (`Rwe`) opens `top-start`; an issue card (`Hft`) `top`;
 *  relation pills `left`. */
const PLACEMENTS = {
  top: ["top", ["bottom"]],
  "top-start": ["top-start", ["bottom-start", "top-end", "bottom-end"]],
  left: ["left", ["left-start", "left-end"]],
} as const satisfies Record<string, readonly [Placement, readonly Placement[]]>;

/**
 * Linear's interactive tooltip (`$` with `interactive`, startup-root `Rwe`): opens 550ms after the pointer settles on the trigger,
 * stays open while the pointer crosses to it, closes when a press on the trigger opens that trigger's own menu. One surface for the
 * issue, user, link and pull request cards. `label` names it for tests and screen readers. `display="inline"` is Linear's
 * `style: { display: "inline" }` on a trigger inside a run of text (an Activity row's issue, `Ao`), so it wraps with the words.
 */
export function HoverCard({
  content,
  placement = "top-start",
  label,
  display = "inline-flex",
  delay = 550,
  children,
}: {
  /** The card body, mounted only while the card is open. */
  content: ReactNode;
  placement?: keyof typeof PLACEMENTS;
  label?: string;
  display?: "inline-flex" | "inline";
  /** Linear's `transitionDelay`: how long the pointer rests before the card opens (550ms unless the trigger says otherwise; an issue
   *  sidebar's pull request row says 150). */
  delay?: number;
  children: ReactNode;
}) {
  const [side, fallbacks] = PLACEMENTS[placement];
  const [open, setOpen] = useState(false);
  // Linear's closeOnPointerDown: a press on the trigger hides the card, so the trigger's menu or link takes over, and it stays
  // hidden until the pointer leaves the trigger.
  const [pressed, setPressed] = useState(false);
  const id = useId();
  const {
    refs: { setReference, setFloating },
    floatingStyles,
    context,
  } = useFloating({
    open,
    onOpenChange: setOpen,
    placement: side,
    strategy: "fixed",
    whileElementsMounted: autoUpdate,
    middleware: [offset(8), flip({ fallbackPlacements: [...fallbacks] }), shift({ padding: 10 })],
  });
  const hover = useHover(context, {
    enabled: !pressed,
    mouseOnly: true,
    delay: { open: delay, close: 400 },
    handleClose: safePolygon(),
  });
  const focus = useFocus(context, { enabled: !pressed });
  const dismiss = useDismiss(context);
  const { getReferenceProps, getFloatingProps } = useInteractions([hover, focus, dismiss]);
  return (
    <>
      <span
        ref={setReference}
        className={display === "inline" ? "inline" : "inline-flex min-w-0 max-w-full"}
        {...getReferenceProps({
          onPointerDown: () => {
            setPressed(true);
            setOpen(false);
          },
          onPointerLeave: () => setPressed(false),
        })}
        aria-describedby={open ? id : undefined}
      >
        {children}
      </span>
      {open ? (
        <FloatingPortal>
          <div
            ref={setFloating}
            style={floatingStyles}
            {...getFloatingProps()}
            id={id}
            role="tooltip"
            aria-label={label}
            data-hover-card={label}
            className="z-50 w-max min-w-[220px] max-w-[380px] rounded-lg border border-[var(--menu-line)] bg-[var(--menu)] px-2 py-[5px] text-xs text-[var(--menu-fg)] shadow-[var(--menu-shadow)]"
          >
            {content}
          </div>
        </FloatingPortal>
      ) : null}
    </>
  );
}

/** Linear's `Ak` list in a card: the first `max`, then "Show N more" for the rest; never "Show 1 more" (`canHide`: two or more). */
export function MoreList<T>({ items, max, children }: { items: T[]; max: number; children: (shown: T[]) => ReactNode }) {
  const [all, setAll] = useState(false);
  const hidden = all ? 0 : items.length - max;
  return (
    <div className="flex flex-col gap-2.5">
      {children(hidden >= 2 ? items.slice(0, max) : items)}
      {hidden >= 2 && (
        <button type="button" className="self-center text-[13px] font-medium text-fg-3 hover:text-fg" onClick={() => setAll(true)}>
          Show {hidden} more
        </button>
      )}
    </div>
  );
}
