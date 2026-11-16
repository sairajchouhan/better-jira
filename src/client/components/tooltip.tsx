import {
  createContext,
  Fragment,
  use,
  useEffect,
  useEffectEvent,
  useId,
  useLayoutEffect,
  useRef,
  useState,
  useSyncExternalStore,
  type ReactNode,
  type RefObject,
} from "react";
import { Tooltip as AriaTooltip, TooltipTrigger } from "react-aria-components";
import { Joiner, Keycap, spokenShortcut } from "./keycap";
import {
  choosePlacement,
  closeOnEscape,
  createTooltipStore,
  TOOLTIP,
  TOOLTIP_TIMING,
  tooltipFallbacks,
  type Placement,
  type Timing,
  type TooltipStore,
} from "./tooltip-rules";

/** A title's "(keys)" display text as Linear's caps, one array per chord of a sequence ("G then I" → [G] [I]): one cap per modifier
 *  glyph or "+"-joined part ("⌘⇧S" → ⌘ ⇧ S, "Ctrl+K" → Ctrl K). A "/" between caps is `shortcutTitle`'s alternate separator and is
 *  dropped; a "/" that starts or ends the keys is the / key itself ("Search (/)", "⌘ /"). */
export const tipCaps = (keys: string): string[][] =>
  keys
    .split(/\s+then\s+/)
    .map((chord) =>
      chord
        .split(/\s+/)
        .filter((key, index, all) => key && !(key === "/" && index > 0 && index < all.length - 1))
        .flatMap((key) => key.split(/(?<=[⌃⌘⌥⇧])|\+(?=.)/).filter(Boolean)),
    )
    .filter((chord) => chord.length > 0);

/** One tooltip line: its text and its shortcut's chords. A title's lines are split on "\n"; "text (keys)" draws the caps after the
 *  text, "(keys) text" before it, as Linear's `N_` does with its default shortcutPosition "start" ("T to collapse group"). */
export type TipLine = { text: string; keys: string[][]; keysFirst: boolean };
export function parseTip(raw: string): TipLine[] {
  return raw.split("\n").map((line) => {
    const first = /^\(([^()]+)\)\s+(.*)$/.exec(line);
    if (first) return { text: first[2]!, keys: tipCaps(first[1]!), keysFirst: true };
    const last = /^(.*?)\s*\(([^()]+)\)$/.exec(line);
    return last ? { text: last[1]!, keys: tipCaps(last[2]!), keysFirst: false } : { text: line, keys: [], keysFirst: false };
  });
}

/** Where a title's tooltip opens, from its element's `data-tip`: Linear's default `bottom` (`Rwe`: `position = "bottom"`), `above`
 *  for timestamps, `right` for the sidebar's rows (`h$` passes `position: "right"` to its `wZ` tooltip). */
export const tipPlacement = (tip: string | undefined): Placement =>
  tip === "above" ? "top" : tip === "right" ? "right" : "bottom";

// ─── The core: one store for the page, one Root per tooltip, React Aria's Tooltip for the surface ───────────────────────────────

/** The page's one tooltip store. Outside a Provider (server rendering, tests) every tooltip shares this one. */
const StoreContext = createContext<TooltipStore>(createTooltipStore());

/**
 * The page's tooltip state, lifted above every trigger: the one-open store, and the Escape rule on the window (one press hides the
 * open tooltip and goes on to the page; `closeOnEscape`). Every tooltip, hover card and edge tooltip reads it.
 */
function TooltipProvider({ children }: { children: ReactNode }) {
  const [store] = useState(() => createTooltipStore());
  useEffect(() => {
    const key = (event: KeyboardEvent) => void closeOnEscape(event, store);
    addEventListener("keydown", key, true);
    return () => removeEventListener("keydown", key, true);
  }, [store]);
  return <StoreContext value={store}>{children}</StoreContext>;
}

type RootValue = {
  id: string;
  isOpen: boolean;
  /** The element the surface is placed against: the trigger, or an anchor inside it. */
  triggerRef: RefObject<HTMLElement | null>;
  /** The open surface (a card's whole box), for the pointer-out rule and the safe area. */
  surfaceRef: RefObject<HTMLDivElement | null>;
  /** The trigger's reports to the store. */
  actions: { enter: () => void; move: () => void; leave: () => void; focus: () => void; close: () => void };
};
const RootContext = createContext<RootValue | null>(null);

/** One tooltip's state and trigger, for its trigger and surface parts. */
export function useTooltip() {
  const root = use(RootContext);
  if (!root) throw new Error("useTooltip needs a Tooltip.Root");
  return root;
}

/** React Aria's wait before a surface the pointer left closes, set past any real wait (setTimeout's largest): cards close by
 *  Linear's pointer-out rule instead (`keepsCardOpen`). */
const NEVER = 2 ** 31 - 1;

/**
 * One tooltip: an id in the store, its timing, and its trigger ref, around React Aria's `TooltipTrigger` held open by the store.
 * React Aria places, portals and names the surface and ties it to the trigger; the store alone opens it, with Linear's delays and
 * one open at a time (React Aria's 1500ms delay and 500ms cooldown, never restarted by a move, can't say Linear's). So React Aria's
 * trigger handling is off (`isDisabled`, `shouldCloseOnPress={false}`), and its own closes map back: the close on scroll hides,
 * and the close after the pointer leaves a card never comes (`NEVER`).
 */
function TooltipRoot({ timing, children }: { timing: Timing; children: ReactNode }) {
  const store = use(StoreContext);
  const id = useId();
  const triggerRef = useRef<HTMLElement | null>(null);
  const surfaceRef = useRef<HTMLDivElement | null>(null);
  const isOpen = useSyncExternalStore(store.subscribe, () => store.isOpen(id), () => false);
  const actions: RootValue["actions"] = {
    enter: () => store.enter(id, timing),
    move: () => store.move(id),
    leave: () => store.leave(id),
    focus: () => store.focus(id),
    close: () => store.close(id),
  };
  useEffect(() => () => store.close(id), [store, id]);
  return (
    <RootContext value={{ id, isOpen, triggerRef, surfaceRef, actions }}>
      <TooltipTrigger
        isOpen={isOpen}
        onOpenChange={(open) => {
          if (!open) store.close(id);
        }}
        isDisabled
        shouldCloseOnPress={false}
        closeDelay={NEVER}
      >
        {children}
      </TooltipTrigger>
    </RootContext>
  );
}

/**
 * The surface: React Aria's `Tooltip` against the Root's trigger, `offset` off it on the main axis and `Fwe` (12px) inside the
 * window. Where it opens is Linear's: `placement` when it fits, else the first of `fallbacks` that does (`Bwe` through Floating
 * UI's flip; `choosePlacement`), measured as it opens. While open its trigger is described by it.
 */
function TooltipSurface({
  placement,
  fallbacks = tooltipFallbacks(placement),
  offset = TOOLTIP.offset,
  className,
  label,
  children,
}: {
  placement: Placement;
  fallbacks?: readonly Placement[];
  offset?: number;
  className: string;
  label?: string;
  children: ReactNode;
}) {
  const { isOpen, triggerRef, surfaceRef: surface } = useTooltip();
  const [chosen, setChosen] = useState(placement);
  const choose = useEffectEvent(() => {
    const trigger = triggerRef.current,
      box = surface.current?.getBoundingClientRect();
    if (!trigger || !box) return;
    setChosen(
      choosePlacement({
        placements: [placement, ...fallbacks],
        reference: trigger.getBoundingClientRect(),
        floating: { width: box.width, height: box.height },
        viewport: { width: innerWidth, height: innerHeight },
        offset,
      }),
    );
  });
  useLayoutEffect(() => {
    if (isOpen) choose();
  }, [isOpen]);
  // React Aria's TooltipTrigger gives the surface its id and describes a React Aria trigger by it; ours is a plain element.
  useLayoutEffect(() => {
    const trigger = triggerRef.current,
      id = surface.current?.id;
    if (!isOpen || !trigger || !id) return;
    const before = trigger.getAttribute("aria-describedby");
    trigger.setAttribute("aria-describedby", before ? `${before} ${id}` : id);
    return () => {
      if (before) trigger.setAttribute("aria-describedby", before);
      else trigger.removeAttribute("aria-describedby");
    };
  }, [isOpen, triggerRef, surface]);
  return (
    <AriaTooltip
      ref={surface}
      triggerRef={triggerRef}
      placement={chosen.replace("-", " ") as never}
      shouldFlip={false}
      offset={offset}
      containerPadding={TOOLTIP.containerPadding}
      aria-label={label}
      className={className}
    >
      {children}
    </AriaTooltip>
  );
}

/** A title's lines as Linear draws them: one row, or a column of rows (`app-tooltip-lines`), each its text and caps. */
function TooltipLines({ lines }: { lines: TipLine[] }) {
  return lines.length === 1 ? (
    <TipRow line={lines[0]!} />
  ) : (
    lines.map((line, index) => (
      <span key={index} className="app-tooltip-line">
        <TipRow line={line} />
      </span>
    ))
  );
}

/** A line's text and caps. Linear's tooltip shortcut (`rVn` draws `qr`, the b4 Shortcut, at size small): its caps sit in D4's
 *  container, 3px apart, a sequence's chords joined by "then" ("Go to inbox G then I"), read out once as "G, then I". The title
 *  already spells the caps in display order, so they are drawn as given rather than re-derived from a registry chord. */
function TipRow({ line }: { line: TipLine }) {
  const caps = line.keys.length > 0 && (
    <span className="ui-shortcut">
      <span className="sr-only">{spokenShortcut(line.keys)}</span>
      {line.keys.map((chord, index) => (
        <Fragment key={index}>
          {index > 0 && <Joiner size="small">then</Joiner>}
          {chord.map((key, at) => (
            <Keycap key={at} aria-hidden size="small">
              {key}
            </Keycap>
          ))}
        </Fragment>
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

/**
 * The core's parts. Every tooltip in the app is one of three variants built from them: `TitleTooltips` (every `title`, below),
 * `HoverCard` (the interactive form, hover-card.tsx) and the resize handle's edge tooltip (resize-handle.tsx).
 */
export const Tooltip = {
  Provider: TooltipProvider,
  Root: TooltipRoot,
  Surface: TooltipSurface,
  Lines: TooltipLines,
};

// ─── Variant: the plain tooltip of every `title` ────────────────────────────────────────────────────────────────────────────────

type Target = { element: HTMLElement; title: string; placement: Placement; focus: boolean; serial: number };

/** Where a parked `title` stays parked but shows no tooltip: inside a hover card or on its trigger, where the card is the one
 *  surface that opens (one open at a time, so a title there would close the card). */
const QUIET = "[data-hover-card-trigger],[data-hover-card]";

/** Linear's tooltip for every `title`: after a 450ms rest a menu-surface label sits 8px under the control (above for
 *  `data-tip="above"`, like Linear's timestamps; right of it for `data-tip="right"`, like Linear's sidebar rows), with a trailing "(keys)" shown as key caps. One listener finds the titled element
 *  under the pointer (or keyboard focus) and mounts a Root for it. The native title is parked in data-title while it is the target,
 *  so the browser's own tip never doubles it. */
export function TitleTooltips() {
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
      setTarget({ element: next, title, placement: tipPlacement(next.dataset.tip), focus, serial: ++serial });
  };
  const over = (event: PointerEvent) => {
    // A touch never hovers.
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
  // Any other key hides a title's tooltip; Escape is the Provider's (it hides whatever is open and lets the key through).
  const key = (event: KeyboardEvent) => {
    if (event.key !== "Escape") down();
  };
  // Keyboard focus opens at once and blur closes (React Aria's trigger rule, kept).
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

/** One titled element's tooltip: a Root mounted while the element is the target (its unmount hides it and starts the warm window,
 *  in which the next title opens at once). */
function TitleTooltip({ target }: { target: Target }) {
  const lines = parseTip(target.title);
  return (
    <Tooltip.Root timing={TOOLTIP_TIMING.plain}>
      <TitleTrigger target={target} />
      <Tooltip.Surface
        placement={target.placement}
        className={`app-tooltip${lines.length > 1 ? " app-tooltip-lines" : ""}`}
      >
        <Tooltip.Lines lines={lines} />
      </Tooltip.Surface>
    </Tooltip.Root>
  );
}

/** Points the Root at the titled element and reports it: a hover enters (each move over it restarts the rest), keyboard focus opens
 *  at once. The follower unmounts the Root when the pointer leaves, presses or types. */
function TitleTrigger({ target: { element, focus } }: { target: Target }) {
  const { triggerRef, actions } = useTooltip();
  const start = useEffectEvent(() => (focus ? actions.focus() : actions.enter()));
  const move = useEffectEvent(() => actions.move());
  useLayoutEffect(() => {
    triggerRef.current = element;
    start();
    const onMove = () => move();
    element.addEventListener("pointermove", onMove);
    return () => element.removeEventListener("pointermove", onMove);
  }, [element, triggerRef]);
  return null;
}
