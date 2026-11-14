import { useContext, useEffect, useEffectEvent, useLayoutEffect, useState, type RefObject } from "react";
import { Tooltip, TooltipContext, TooltipTrigger, TooltipTriggerStateContext } from "react-aria-components";
import { Keycap } from "./keycap";

/** A title's "(keys)" display text as Linear's caps: one per modifier glyph or "+"-joined part ("⌘⇧S" → ⌘ ⇧ S, "Ctrl+K" → Ctrl K),
 *  sequence words ("then", "/") dropped. */
export const tipCaps = (keys: string) =>
  keys
    .split(/\s+/)
    .filter((key) => key && key !== "/" && key !== "then")
    .flatMap((key) => key.split(/(?<=[⌃⌘⌥⇧])|\+(?=.)/).filter(Boolean));

/** One tooltip line: its text and caps. A title's lines are split on "\n"; "text (keys)" draws the caps after the text, "(keys) text"
 *  before it, as Linear's `N_` does with its default shortcutPosition "start" ("T to collapse group"). */
export type TipLine = { text: string; keys: string[]; keysFirst: boolean };
export function parseTip(raw: string): TipLine[] {
  return raw.split("\n").map((line) => {
    const first = /^\(([^()]+)\)\s+(.*)$/.exec(line);
    if (first) return { text: first[2]!, keys: tipCaps(first[1]!), keysFirst: true };
    const last = /^(.*?)\s*\(([^()]+)\)$/.exec(line);
    return last ? { text: last[1]!, keys: tipCaps(last[2]!), keysFirst: false } : { text: line, keys: [], keysFirst: false };
  });
}

/**
 * Linear's tooltip timing and geometry (startup-root `Rwe` and its constants), mapped onto React Aria's `delay`, `closeDelay`,
 * `offset` and `containerPadding`. React Aria's own rules supply the rest: one tooltip or hover card open at a time, the warm
 * window in which the next one opens at once, Escape, scroll, focus and touch.
 */
export const TOOLTIP = {
  /** `Rwe`: `w = transitionDelay ?? (interactive ? 550 : 450)`, a plain tooltip's rest before it opens. */
  delay: 450,
  /** A plain tooltip hides as the pointer leaves (`Rwe`'s mouse-out `be()` hides at once). */
  closeDelay: 0,
  /** `Nwe = i_.defaultOffset * 2`: 8px between the control and a plain tooltip. */
  offset: 8,
  /** `Fwe = 12`: the shift and size padding that keeps every tooltip and card inside the window. */
  containerPadding: 12,
} as const;

/** React Aria's state and trigger ref inside a `TooltipTrigger`, for a trigger this app renders itself (a hover card's span, a
 *  `title`d element): it calls `open`/`close` as React Aria's own trigger does, and React Aria's timers, warm-up and one-open rule
 *  decide what shows. React Aria's Escape listener and close-on-scroll read the same ref. */
export function useTooltipTrigger() {
  const state = useContext(TooltipTriggerStateContext);
  const context = useContext(TooltipContext) as { triggerRef: RefObject<HTMLElement | null>; id?: string } | null;
  if (!state || !context) throw new Error("useTooltipTrigger needs a TooltipTrigger");
  return { state, triggerRef: context.triggerRef, id: context.id };
}

type Target = { element: HTMLElement; title: string; above: boolean; focus: boolean; serial: number };

/** Where a parked `title` stays parked but shows no tooltip: inside a hover card or on its trigger, where the card is the one
 *  surface that opens (React Aria keeps one open at a time, so a title there would close the card). */
const QUIET = "[data-hover-card-trigger],[data-hover-card]";

/** Linear's tooltip for every `title`: after a 450ms rest a menu-surface label sits 8px under the control (above for
 *  `data-tip="above"`, like Linear's timestamps, or when there is no room), with a trailing "(keys)" shown as key caps. One listener
 *  finds the titled element under the pointer (or keyboard focus); React Aria's `TooltipTrigger` and `Tooltip` time, place and
 *  dismiss it. The native title is parked in data-title while it is the target, so the browser's own tip never doubles it. */
export function Tooltips() {
  const [target, setTarget] = useState<Target | null>(null);
  useEffect(() => followTitles(setTarget), []);
  return target ? <TitleTooltip key={target.serial} target={target} /> : null;
}

/** Follows the titled element under the pointer or keyboard focus, parking its title, and reports it (null when there is none). */
function followTitles(setTarget: (target: Target | null) => void) {
  let current: HTMLElement | null = null,
    // Linear's closeOnPointerDown: a pressed control shows no tooltip again until the pointer moves to another one.
    pressed: HTMLElement | null = null,
    serial = 0;
  const restore = () => {
    if (!current) return;
    if (current.dataset.title !== undefined) {
      current.title = current.dataset.title;
      delete current.dataset.title;
    }
    if (current.dataset.tipLabel !== undefined) {
      current.removeAttribute("aria-label");
      delete current.dataset.tipLabel;
    }
    current = null;
    setTarget(null);
  };
  const show = (next: HTMLElement, focus: boolean) => {
    restore();
    current = next;
    const title = next.title;
    next.dataset.title = title;
    // An icon-only control is named by its title; keep that name for screen readers while it is parked.
    if (!next.hasAttribute("aria-label") && !next.textContent?.trim()) {
      next.setAttribute("aria-label", title);
      next.dataset.tipLabel = "";
    }
    next.removeAttribute("title");
    if (!next.closest(QUIET))
      setTarget({ element: next, title, above: next.dataset.tip === "above", focus, serial: ++serial });
  };
  const over = (event: PointerEvent) => {
    // React Aria's useHover: a touch never hovers.
    if (event.pointerType === "touch") return;
    const next = (event.target as Element | null)?.closest?.<HTMLElement>("[title],[data-title]") ?? null;
    if (next === current || (pressed && next === pressed)) return;
    pressed = null;
    restore();
    if (next?.title) show(next, false);
  };
  const down = () => {
    pressed = current;
    restore();
  };
  // React Aria's trigger closes on any key but Escape, which its own listener handles (and keeps from the page).
  const key = (event: KeyboardEvent) => {
    if (event.key !== "Escape") down();
  };
  // React Aria's trigger opens on keyboard focus only (`isFocusVisible`), at once, and closes on blur.
  const focusIn = (event: FocusEvent) => {
    const next = event.target as HTMLElement;
    if (next !== current && next.title && next.matches?.(":focus-visible")) show(next, true);
  };
  const focusOut = (event: FocusEvent) => {
    if (event.target === current) restore();
  };
  addEventListener("pointerover", over);
  addEventListener("pointerdown", down, true);
  addEventListener("keydown", key, true);
  addEventListener("focusin", focusIn);
  addEventListener("focusout", focusOut);
  return () => {
    restore();
    removeEventListener("pointerover", over);
    removeEventListener("pointerdown", down, true);
    removeEventListener("keydown", key, true);
    removeEventListener("focusin", focusIn);
    removeEventListener("focusout", focusOut);
  };
}

/** One titled element's tooltip: a React Aria trigger mounted while the element is the target, so its timers start on mount
 *  and its unmount closes it (starting React Aria's cool-down, in which the next title opens at once). */
function TitleTooltip({ target }: { target: Target }) {
  const lines = parseTip(target.title);
  return (
    <TooltipTrigger delay={TOOLTIP.delay} closeDelay={TOOLTIP.closeDelay}>
      <TitleTrigger target={target} />
      <Tooltip
        placement={target.above ? "top" : "bottom"}
        offset={TOOLTIP.offset}
        containerPadding={TOOLTIP.containerPadding}
        className={`app-tooltip${lines.length > 1 ? " app-tooltip-lines" : ""}`}
      >
        {lines.length === 1 ? (
          <TipRow line={lines[0]!} />
        ) : (
          lines.map((line, index) => (
            <span key={index} className="app-tooltip-line">
              <TipRow line={line} />
            </span>
          ))
        )}
      </Tooltip>
    </TooltipTrigger>
  );
}

/** Points React Aria's trigger ref at the titled element and opens it as React Aria's trigger would: a hover waits out the delay
 *  (or opens at once while warm), keyboard focus opens at once. While open, the element is described by the tooltip. */
function TitleTrigger({ target: { element, focus } }: { target: Target }) {
  const { state, triggerRef, id } = useTooltipTrigger();
  const open = useEffectEvent(() => state.open(focus));
  const close = useEffectEvent(() => state.close(true));
  useLayoutEffect(() => {
    triggerRef.current = element;
    open();
    return () => close();
  }, [element, triggerRef]);
  useLayoutEffect(() => {
    if (!state.isOpen || !id) return;
    const before = element.getAttribute("aria-describedby");
    element.setAttribute("aria-describedby", before ? `${before} ${id}` : id);
    return () => {
      if (before) element.setAttribute("aria-describedby", before);
      else element.removeAttribute("aria-describedby");
    };
  }, [element, id, state.isOpen]);
  return null;
}

/** A line's text and caps. Linear's tooltip shortcut (Aze) is b4 at size small: its caps sit in D4's container, 3px apart. The title
 *  already spells the caps in display order, so they are drawn as given rather than re-derived from a chord. */
function TipRow({ line }: { line: TipLine }) {
  const caps = line.keys.length > 0 && (
    <span className="ui-shortcut">
      {line.keys.map((key, index) => (
        <Keycap key={index} size="small">
          {key}
        </Keycap>
      ))}
    </span>
  );
  return line.keysFirst ? (
    <>
      {caps}
      {line.text}
    </>
  ) : (
    <>
      {line.text}
      {caps}
    </>
  );
}
