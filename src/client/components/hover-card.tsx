import {
  useEffect,
  useEffectEvent,
  useLayoutEffect,
  useRef,
  useState,
  type CSSProperties,
  type ReactNode,
  type RefObject,
} from "react";
import { Popover, PopoverContext } from "react-aria-components";
import { Tooltip, useTooltip } from "./tooltip";
import { OverlayBoundary } from "./overlay-boundary";
import {
  CARD_FALLBACKS,
  choosePlacement,
  keepsCardOpen,
  safeArea,
  sideOf,
  TOOLTIP,
  TOOLTIP_TIMING,
  type Placement,
} from "./tooltip-rules";

/**
 * The tooltip's interactive form (Linear's `$` with `interactive`, startup-root `Rwe`): the same core as every tooltip (one open
 * at a time, Escape, close on scroll and press) with the card's own parts. It opens 550ms after the pointer comes to rest on the
 * trigger, sits flush against it, tries `top-start`, `top`, `bottom-start`, `bottom` when its placement does not fit (`Bwe`), and
 * closes the moment the pointer leaves unless it went into the card (`keepsCardOpen`). One surface for the issue, user, link and
 * pull request cards. `label` names it for tests and screen readers. `display="inline"` is Linear's `style: { display: "inline" }`
 * on a trigger inside a run of text (an Activity row's issue, `Ao`), so it wraps with the words.
 *
 * The card is React Aria's preview popover (`Popover trigger="PreviewTrigger"`, non-modal): a `dialog` a keyboard user can Tab into
 * from its trigger, which hands focus back to the trigger as it closes. Its trigger is ours, not React Aria's `PreviewTrigger`:
 * that one forces its child into the tab order, takes Enter from a button inside, keeps a page-wide warm-up instead of Linear's
 * delay that restarts on every move, and closes by a pointer hull wider than Linear's `Jwe` strip; and our triggers wrap any
 * control in a span (a menu button with its own `aria-haspopup`, a link, plain text). So the tooltip core's store opens and closes
 * it, as it does every tooltip.
 */
export function HoverCard({
  content,
  placement = "top-start",
  label,
  display = "inline-flex",
  delay = TOOLTIP_TIMING.card.delay,
  children,
}: {
  /** The card body, mounted only while the card is open. */
  content: ReactNode;
  placement?: Extract<Placement, "top" | "top-start" | "left">;
  label?: string;
  display?: "inline-flex" | "inline";
  /** Linear's `transitionDelay`: how long the pointer rests before the card opens (550ms unless the trigger says otherwise; an issue
   *  sidebar's pull request row says 150). */
  delay?: number;
  children: ReactNode;
}) {
  return (
    <Tooltip.Root timing={{ ...TOOLTIP_TIMING.card, delay }}>
      <HoverCardTrigger display={display}>{children}</HoverCardTrigger>
      <HoverCardSurface placement={placement} label={label}>
        <HoverCardZone label={label}>{content}</HoverCardZone>
      </HoverCardSurface>
    </Tooltip.Root>
  );
}

/**
 * The card's surface: React Aria's non-modal `Popover` against the trigger, flush with it (`offset` 0) and `Fwe` (12px) inside the
 * window, opened and closed by the store. Where it opens is Linear's `Bwe` (`placement` when it fits, else the first of
 * `CARD_FALLBACKS` that does), measured as it opens, as the tooltip surface does. Escape stays with the store (one press hides it
 * and goes on to the page), so React Aria's own Escape is off; its close on scroll or on focus leaving the card closes it in the
 * store. While open, the trigger is described by it.
 */
function HoverCardSurface({ placement, label, children }: { placement: Placement; label?: string; children: ReactNode }) {
  const { id, isOpen, triggerRef, surfaceRef, actions } = useTooltip();
  const [chosen, setChosen] = useState(placement);
  const choose = useEffectEvent(() => {
    const trigger = triggerRef.current,
      box = surfaceRef.current?.getBoundingClientRect();
    if (!trigger || !box) return;
    setChosen(
      choosePlacement({
        placements: [placement, ...CARD_FALLBACKS],
        reference: trigger.getBoundingClientRect(),
        floating: { width: box.width, height: box.height },
        viewport: { width: innerWidth, height: innerHeight },
        offset: 0,
      }),
    );
  });
  useLayoutEffect(() => {
    if (isOpen) choose();
  }, [isOpen]);
  useLayoutEffect(() => {
    const trigger = triggerRef.current;
    if (!isOpen || !trigger) return;
    const before = trigger.getAttribute("aria-describedby");
    trigger.setAttribute("aria-describedby", before ? `${before} ${id}` : id);
    return () => {
      if (before) trigger.setAttribute("aria-describedby", before);
      else trigger.removeAttribute("aria-describedby");
    };
  }, [isOpen, id, triggerRef]);
  return (
    // A card inside a React Aria menu or dialog trigger must not take that trigger's popover settings.
    <PopoverContext value={null}>
      <Popover
        ref={surfaceRef}
        // React Aria passes `id` through to the dialog; its props type leaves it out.
        {...({ id } as object)}
        trigger="PreviewTrigger"
        isNonModal
        isKeyboardDismissDisabled
        isOpen={isOpen}
        onOpenChange={(open) => !open && actions.close()}
        triggerRef={triggerRef}
        placement={chosen.replace("-", " ") as never}
        shouldFlip={false}
        offset={0}
        containerPadding={TOOLTIP.containerPadding}
        aria-label={label}
        className="hover-card"
      >
        <OverlayBoundary label={label ?? "Card"} close={actions.close}>
          {children}
        </OverlayBoundary>
      </Popover>
    </PopoverContext>
  );
}

/** Whether `node` is inside the open card. */
const inCard = (card: RefObject<HTMLElement | null>, node: EventTarget | null) => node instanceof Node && !!card.current?.contains(node);

/** What Tab from the trigger moves to in the open card: its first control. */
const CARD_TABBABLE = 'a[href], button:not(:disabled), input:not(:disabled), [tabindex]:not([tabindex="-1"])';

/** The card's trigger: a span around the caller's control. A mouse or pen rest opens the card (each move restarts the delay),
 *  keyboard focus inside opens it at once, a press closes it until the pointer comes back, and leaving closes it unless the pointer
 *  went into the card. Tab while the card is open moves into it (React Aria's `usePreviewTrigger`, whose card sits at the end of the
 *  page); focus handed back as the card closes doesn't open it again. */
function HoverCardTrigger({ display, children }: { display: "inline-flex" | "inline"; children: ReactNode }) {
  const { isOpen, surfaceRef, triggerRef, actions } = useTooltip();
  const restoring = useRef(false);
  useEffect(() => {
    const trigger = triggerRef.current;
    if (!trigger) return;
    // React Aria's FocusScope announces the focus it gives back as the card closes; taking it here keeps it from reopening the card.
    const restore = (event: Event) => {
      if (!(event.target instanceof HTMLElement)) return;
      event.preventDefault();
      restoring.current = true;
      event.target.focus();
      restoring.current = false;
    };
    trigger.addEventListener("react-aria-focus-scope-restore", restore);
    return () => trigger.removeEventListener("react-aria-focus-scope-restore", restore);
  }, [triggerRef]);
  return (
    <span
      ref={triggerRef as RefObject<HTMLSpanElement | null>}
      className={display === "inline" ? "inline" : "inline-flex min-w-0 max-w-full"}
      data-hover-card-trigger=""
      onPointerEnter={(event) => event.pointerType !== "touch" && actions.enter()}
      onPointerMove={(event) => event.pointerType !== "touch" && actions.move()}
      onPointerLeave={(event) => {
        if (event.pointerType !== "touch" && !keepsCardOpen(inCard(surfaceRef, event.relatedTarget) ? "card" : "elsewhere")) actions.leave();
      }}
      onPointerDown={() => actions.close()}
      onFocus={(event) => !restoring.current && event.target.matches(":focus-visible") && actions.focus()}
      onKeyDown={(event) => {
        if (event.key !== "Tab" || event.shiftKey || !isOpen) return;
        const first = [...(surfaceRef.current?.querySelectorAll<HTMLElement>(CARD_TABBABLE) ?? [])].find((node) => node.getClientRects().length);
        if (!first) return;
        event.preventDefault();
        first.focus();
      }}
      onBlur={(event) => !inCard(surfaceRef, event.relatedTarget) && actions.close()}
    >
      {children}
    </span>
  );
}

/** Linear's `Vwe` wrapper: the card's whole box with a transparent `Pwe` (4px) pad on its main axis (`Gwe`, index.css), so it meets
 *  its trigger. Leaving it closes the card unless the pointer went back to the trigger, or went nowhere just after a press inside. */
function HoverCardZone({ label, children }: { label?: string; children: ReactNode }) {
  const { surfaceRef, triggerRef, actions } = useTooltip();
  const pressedAt = useRef(-Infinity);
  return (
    <div
      className="hover-card-zone"
      onPointerDown={() => (pressedAt.current = Date.now())}
      onPointerLeave={(event) => {
        const to = event.relatedTarget;
        const where =
          to === null
            ? "nothing"
            : inCard(surfaceRef, to)
              ? "card"
              : to instanceof Node && triggerRef.current?.contains(to)
                ? "trigger"
                : "elsewhere";
        if (!keepsCardOpen(where, Date.now() - pressedAt.current)) actions.leave();
      }}
    >
      <div
        data-hover-card={label}
        className="w-max min-w-[220px] max-w-[380px] rounded-lg border border-[var(--menu-line)] bg-[var(--menu)] px-2 py-[5px] text-xs text-[var(--menu-fg)] shadow-[var(--menu-shadow)]"
      >
        {children}
      </div>
      <SafeArea />
    </div>
  );
}

/** Linear's `Jwe`: 10ms after the card opens, a strip past its edge toward the trigger (`safeArea`) that counts as the card, so a
 *  pointer heading diagonally from the trigger into the card never leaves both. It goes once the pointer leaves it. */
function SafeArea() {
  const { surfaceRef, triggerRef } = useTooltip();
  const [style, setStyle] = useState<CSSProperties | null>(null);
  useEffect(() => {
    const timer = setTimeout(() => {
      const card = surfaceRef.current,
        trigger = triggerRef.current;
      if (!card || !trigger) return;
      const side = sideOf((card.dataset.placement ?? "top") as Placement);
      setStyle({ position: "absolute", ...safeArea(card.getBoundingClientRect(), trigger.getBoundingClientRect(), side) });
    }, TOOLTIP.safeAreaDelayMs);
    return () => clearTimeout(timer);
  }, [surfaceRef, triggerRef]);
  return style && <div aria-hidden className="hover-card-safe-area" style={style} onPointerLeave={() => setStyle(null)} />;
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
