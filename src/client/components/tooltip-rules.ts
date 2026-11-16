/**
 * The rules every tooltip in the app follows, without React or the DOM: Linear's one tooltip (startup-root `Rwe`, with its
 * `interactive` form for hover cards) as plain data and a small store. src/client/components/tooltip.tsx renders them.
 */

/** A trigger's timing. `restartOnMove` is `Rwe`'s rest rule: every pointer move over the trigger starts the delay again. */
export type Timing = { delay: number; restartOnMove: boolean };

export const TOOLTIP_TIMING = {
  /** `Rwe`: `w = transitionDelay ?? (interactive ? 550 : 450)`, rescheduled on each `mousemove` (`Iwe.schedule(n, w)`). */
  plain: { delay: 450, restartOnMove: true },
  /** The interactive form (hover cards): the same rule at 550ms. */
  card: { delay: 550, restartOnMove: true },
  /** A resize handle's tooltip (`B_`): one 450ms timer from `mouseenter`, never restarted by a move. */
  edge: { delay: 450, restartOnMove: false },
} as const satisfies Record<string, Timing>;

export const TOOLTIP = {
  /** `Lwe.schedule(…, 100)`: after a tooltip hides, the next one opens at once for 100ms, then the delay applies again. */
  warmMs: 100,
  /** `Nwe = i_.defaultOffset * 2`: a plain tooltip sits 8px off its trigger. A card sits flush (`mainAxis: 0`). */
  offset: 8,
  /** `Fwe = 12`: the shift and size padding that keeps every tooltip inside the window. */
  containerPadding: 12,
  /** `Vwe`'s pad (`Gwe(placement, i?.current ?? Pwe)`, `i` the tooltip's offset ref, `zwe(offset)` = `Nwe` 8px when none is
   *  given): a card's transparent pad on its main axis, so it meets its trigger. Live, a sidebar favorite's card sits 8px right of
   *  its row and an issue row's project card 8px above it. */
  cardPad: 8,
  /** `Vwe`: a pointer that leaves the card for nothing (`relatedTarget` null) within 500ms of a press inside it keeps it open. */
  cardPressGraceMs: 500,
  /** `rTe delay: 10`: the card's safe area (`Jwe`) appears 10ms after the card. */
  safeAreaDelayMs: 10,
  /** `j_ = Pwe * 2.5`: how far the safe area reaches past the card toward the trigger. */
  safeAreaDepth: 10,
  /** `qwe = 24`: how far past the trigger's ends the safe area's far edge spans. */
  safeAreaReach: 24,
} as const;

export type Side = "top" | "bottom" | "left" | "right";
export type Placement = Side | `${Side}-start` | `${Side}-end`;
export const sideOf = (placement: Placement) => placement.split("-")[0] as Side;

const around = (side: Side): Placement[] => [side, `${side}-start`, `${side}-end`];
const ORDER: Record<Side, Side[]> = {
  top: ["top", "bottom", "left", "right"],
  left: ["left", "right", "bottom", "top"],
  right: ["right", "left", "bottom", "top"],
  bottom: ["bottom", "top", "right", "left"],
};

/** `Bwe(placement, false)`: where a plain tooltip tries next when its placement does not fit, its own side's alignments first. */
export const tooltipFallbacks = (placement: Placement): Placement[] =>
  ORDER[sideOf(placement)].flatMap(around).filter((other) => other !== placement);

/** `Bwe(placement, true)`: a card tries these, whatever its placement. */
export const CARD_FALLBACKS: readonly Placement[] = ["top-start", "top", "bottom-start", "bottom"];

type Rect = { left: number; top: number; right: number; bottom: number };
type Size = { width: number; height: number };

/** Where a `floating` box lands at `placement` beside `reference`, `offset` away on the main axis. */
function place(placement: Placement, reference: Rect, floating: Size, offset: number): Rect {
  const [side, align] = placement.split("-") as [Side, "start" | "end" | undefined];
  let left: number, top: number;
  if (side === "top" || side === "bottom") {
    top = side === "top" ? reference.top - offset - floating.height : reference.bottom + offset;
    left =
      align === "start"
        ? reference.left
        : align === "end"
          ? reference.right - floating.width
          : (reference.left + reference.right) / 2 - floating.width / 2;
  } else {
    left = side === "left" ? reference.left - offset - floating.width : reference.right + offset;
    top =
      align === "start"
        ? reference.top
        : align === "end"
          ? reference.bottom - floating.height
          : (reference.top + reference.bottom) / 2 - floating.height / 2;
  }
  return { left, top, right: left + floating.width, bottom: top + floating.height };
}

/**
 * Linear's flip (`$Ce` over Floating UI's `flip`, run before `shift`) as `Rwe` sets it up: `fallbackPlacements`, padded by the
 * shift padding (`Fwe`, 12px). The first of `placements` whose box stays inside the padded window on its own side and both cross
 * sides wins. Otherwise: of those that fit on their own side, the one that spills least across; when none fits even on its own
 * side, the one that spills least there (`$Ce`). React Aria then shifts the box inside the same 12px.
 */
export function choosePlacement(options: {
  placements: readonly Placement[];
  reference: Rect;
  floating: Size;
  viewport: Size;
  offset: number;
}): Placement {
  const { placements, reference, floating, viewport, offset } = options;
  const pad = TOOLTIP.containerPadding;
  const measured = placements.map((placement) => {
    const box = place(placement, reference, floating, offset);
    const overflow = {
      top: pad - box.top,
      left: pad - box.left,
      bottom: box.bottom - (viewport.height - pad),
      right: box.right - (viewport.width - pad),
    };
    const side = sideOf(placement);
    const cross: Side[] = side === "top" || side === "bottom" ? ["left", "right"] : ["top", "bottom"];
    const across = cross.reduce((sum, edge) => sum + Math.max(0, overflow[edge]), 0);
    return { placement, main: overflow[side], across };
  });
  const least = <T,>(items: T[], by: (item: T) => number) => items.reduce((best, item) => (by(item) < by(best) ? item : best));
  const onSide = measured.filter((entry) => entry.main <= 0);
  const fits = onSide.find((entry) => entry.across <= 0);
  if (fits) return fits.placement;
  if (onSide.length) return least(onSide, (entry) => entry.across).placement;
  return least(measured, (entry) => entry.main).placement;
}

/**
 * `Jwe`/`Ywe`: the card's safe area, a strip `safeAreaDepth` deep past the card's edge facing the trigger, clipped to a trapezoid
 * from the card's full width down to the trigger's span plus `safeAreaReach` either side. While the pointer crosses it on the way
 * from the trigger, it is already over the card, so the card stays open. Positioned inside the card's box.
 */
export function safeArea(card: Rect, trigger: Rect, side: Side) {
  const depth = TOOLTIP.safeAreaDepth,
    reach = TOOLTIP.safeAreaReach;
  const percent = (value: number, start: number, length: number) =>
    Math.min(100, Math.max(0, (100 * (value - start)) / (length || 1)));
  if (side === "left" || side === "right") {
    const height = card.bottom - card.top;
    const from = percent(trigger.top - reach, card.top, height),
      to = percent(trigger.bottom + reach, card.top, height);
    return side === "left"
      ? { top: 0, bottom: 0, width: depth, right: -depth, clipPath: `polygon(0 0, 100% ${from}%, 100% ${to}%, 0 100%)` }
      : { top: 0, bottom: 0, width: depth, left: -depth, clipPath: `polygon(0 ${from}%, 100% 0, 100% 100%, 0 ${to}%)` };
  }
  const width = card.right - card.left;
  const from = percent(trigger.left - reach, card.left, width),
    to = percent(trigger.right + reach, card.left, width);
  return side === "top"
    ? { left: 0, right: 0, height: depth, bottom: -depth, clipPath: `polygon(0 0, 100% 0, ${to}% 100%, ${from}% 100%)` }
    : { left: 0, right: 0, height: depth, top: -depth, clipPath: `polygon(${from}% 0, ${to}% 0, 100% 100%, 0 100%)` };
}

/**
 * `Rwe`'s pointer-out rules for a card. Leaving the trigger keeps the card open only when the pointer went into the card
 * (`relatedTarget` inside the popover). Leaving the card keeps it open when the pointer went back to the trigger or stays in the
 * card, or went nowhere (`relatedTarget` null, e.g. a text selection drag) within 500ms of a press inside the card.
 */
export const keepsCardOpen = (to: "card" | "trigger" | "elsewhere" | "nothing", msSinceCardPress = Infinity) =>
  to === "card" || to === "trigger" || (to === "nothing" && msSinceCardPress < TOOLTIP.cardPressGraceMs);

export type Schedule = (task: () => void, ms: number) => () => void;
const timeout: Schedule = (task, ms) => {
  const handle = setTimeout(task, ms);
  return () => clearTimeout(handle);
};

/**
 * The one-open store (Linear's global `__usePopoverState__`, `Uwe`). One tooltip or card is open at a time: opening one closes
 * any other. Each trigger reports the pointer and focus; the store times the rest.
 * - Pointer enter starts the trigger's delay, restarted on each move when its timing says so (`Iwe.schedule`).
 * - Within `warmMs` of the last tooltip hiding (its id still "warm"), the next opens at once (`shouldBeImmediate`).
 * - Leaving, a press (`closeOnPointerDown`), blur, scroll and Escape hide it. Hidden with the pointer still on it, it stays hidden
 *   until the pointer has left (`Rwe`): an enter that isn't one (the menu's underlay going from under a resting pointer) doesn't
 *   reopen it.
 * - Keyboard focus opens at once (React Aria's rule; Linear's trigger only marks itself hovered on focus).
 */
export function createTooltipStore(schedule: Schedule = timeout) {
  let openId: string | undefined, warmId: string | undefined, hoverId: string | undefined, shut: string | undefined;
  let pending: { id: string; timing: Timing; cancel: () => void } | undefined;
  const listeners = new Set<() => void>();
  const emit = () => listeners.forEach((listener) => listener());
  const cancelPending = () => {
    pending?.cancel();
    pending = undefined;
  };
  const show = (id: string) => {
    if (pending?.id === id) cancelPending();
    warmId = id;
    if (openId === id) return;
    openId = id;
    emit();
  };
  const wait = (id: string, timing: Timing) => {
    cancelPending();
    pending = { id, timing, cancel: schedule(() => ((pending = undefined), show(id)), timing.delay) };
  };
  // `Rwe`'s effect when hover ends: hide, then let this tooltip's warm window lapse after `warmMs` unless another took it.
  const settle = (id: string, under = false) => {
    if (hoverId === id) {
      hoverId = undefined;
      if (under) shut = id;
    }
    if (pending?.id === id) cancelPending();
    if (openId === id) {
      openId = undefined;
      emit();
    }
    schedule(() => {
      if (openId !== id && warmId === id) warmId = undefined;
    }, TOOLTIP.warmMs);
  };
  return {
    subscribe(listener: () => void) {
      listeners.add(listener);
      return () => void listeners.delete(listener);
    },
    isOpen: (id: string) => openId === id,
    get openId() {
      return openId;
    },
    enter(id: string, timing: Timing) {
      if (hoverId === id || shut === id) return;
      hoverId = id;
      if (warmId !== undefined && (warmId !== id || openId !== id)) show(id);
      else wait(id, timing);
    },
    move(id: string) {
      if (pending?.id === id && pending.timing.restartOnMove) wait(id, pending.timing);
    },
    leave(id: string) {
      if (shut === id) shut = undefined;
      if (hoverId === id || openId === id || pending?.id === id) settle(id);
    },
    focus(id: string) {
      hoverId = id;
      show(id);
    },
    /** A press, blur or scroll: hide until the pointer has left and come back. */
    close: (id: string) => settle(id, true),
    /** Escape: hide whatever is open, until the pointer has left it. Returns whether something was. */
    escape() {
      if (openId === undefined) return false;
      settle(openId, true);
      return true;
    },
  };
}
export type TooltipStore = ReturnType<typeof createTooltipStore>;

/**
 * Linear's tooltip Escape (`C_`'s `onRequestClose` on its global key listener): one press hides the open tooltip or card, and
 * the key goes on to the page, so the panel, peek or menu under it closes on the same press. It never stops or prevents it.
 */
export function closeOnEscape(event: { key: string }, store: Pick<TooltipStore, "escape">) {
  return event.key === "Escape" && store.escape();
}
