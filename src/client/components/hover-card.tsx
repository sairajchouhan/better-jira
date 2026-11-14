import { useState, type ReactNode, type RefObject } from "react";
import { Tooltip, TooltipTrigger } from "react-aria-components";
import { TOOLTIP, useTooltipTrigger } from "./tooltip";

/** Linear's interactive tooltip (`Rwe` with `interactive`) as React Aria values. */
export const HOVER_CARD = {
  /** `Rwe`: `transitionDelay ?? (interactive ? 550 : 450)`. */
  delay: 550,
  /** Linear hides the card as the pointer leaves unless it moved straight into the card (`relatedTarget` inside the popover), so
   *  it has no close delay. React Aria decides that with a close delay instead, cancelled once the pointer is over the card. The
   *  card sits flush against its trigger (`mainAxis: 0` plus `Pwe` padding), so a short one is enough to cross; 100ms matches the
   *  pause `Lwe.schedule(…, 100)` gives Linear's popover state after a hide. Inferred, not read from Linear. */
  closeDelay: 100,
} as const;

/** Where a card opens; React Aria flips it to the other side when there is no room. Linear's interactive tooltip (`Rwe`) opens
 *  `top-start`; an issue card (`Hft`) `top`; relation pills and the sidebar's pull request rows `left`. */
const PLACEMENTS = { top: "top", "top-start": "top start", left: "left" } as const;

/**
 * Linear's interactive tooltip (`$` with `interactive`, startup-root `Rwe`) on React Aria's `TooltipTrigger` and `Tooltip`: opens
 * 550ms after the pointer rests on the trigger, stays open while the pointer crosses into it, closes when a press on the trigger
 * opens that trigger's own menu. React Aria keeps one tooltip or card open at a time: resting on the next trigger closes this one.
 * One surface for the issue, user, link and pull request cards. `label` names it for tests and screen readers. `display="inline"`
 * is Linear's `style: { display: "inline" }` on a trigger inside a run of text (an Activity row's issue, `Ao`), so it wraps with
 * the words.
 */
export function HoverCard({
  content,
  placement = "top-start",
  label,
  display = "inline-flex",
  delay = HOVER_CARD.delay,
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
  return (
    <TooltipTrigger delay={delay} closeDelay={HOVER_CARD.closeDelay}>
      <HoverCardTrigger display={display}>{children}</HoverCardTrigger>
      {/* Linear's `Vwe` wrapper: a transparent 4px (`Pwe`) pad on the card's main axis (`Gwe`), so it meets its trigger. */}
      <Tooltip
        placement={PLACEMENTS[placement]}
        offset={0}
        containerPadding={TOOLTIP.containerPadding}
        aria-label={label}
        className="hover-card"
      >
        <div
          data-hover-card={label}
          className="w-max min-w-[220px] max-w-[380px] rounded-lg border border-[var(--menu-line)] bg-[var(--menu)] px-2 py-[5px] text-xs text-[var(--menu-fg)] shadow-[var(--menu-shadow)]"
        >
          {content}
        </div>
      </Tooltip>
    </TooltipTrigger>
  );
}

/** The card's trigger: a span around the caller's control, handling the pointer and focus as React Aria's own trigger does
 *  (`useTooltipTrigger`): a mouse or pen rest opens it after the delay, keyboard focus anywhere inside opens it at once, leaving
 *  closes it after the close delay, and a press closes it until the pointer comes back. */
function HoverCardTrigger({ display, children }: { display: "inline-flex" | "inline"; children: ReactNode }) {
  const { state, triggerRef, id } = useTooltipTrigger();
  return (
    <span
      ref={triggerRef as RefObject<HTMLSpanElement | null>}
      className={display === "inline" ? "inline" : "inline-flex min-w-0 max-w-full"}
      data-hover-card-trigger=""
      aria-describedby={state.isOpen ? id : undefined}
      onPointerEnter={(event) => event.pointerType !== "touch" && state.open(false)}
      onPointerLeave={(event) => event.pointerType !== "touch" && state.close()}
      onPointerDown={() => state.close(true)}
      onFocus={(event) => event.target.matches(":focus-visible") && state.open(true)}
      onBlur={() => state.close(true)}
    >
      {children}
    </span>
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
