import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { Debouncer } from "@tanstack/pacer";
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

/** Linear's tooltip for every `title`: after a short hover a menu-surface label sits 8px under the control (above for `data-tip="above"`, like Linear's timestamps, or when there is no room),
 *  with a trailing "(keys)" shown as key caps. The native title is parked in data-title while it shows, so the browser's own tip never doubles it. */
export function Tooltips() {
  const [tip, setTip] = useState<{
      lines: TipLine[];
      x: number;
      y: number;
      above: boolean;
    } | null>(null),
    ref = useRef<HTMLDivElement>(null);
  // Centred under the control, then kept 8px inside the window.
  useLayoutEffect(() => {
    const node = ref.current;
    if (!node || !tip) return;
    const width = node.offsetWidth;
    node.style.left = `${Math.max(8, Math.min(tip.x - width / 2, innerWidth - 8 - width))}px`;
  }, [tip]);
  useEffect(() => {
    let target: HTMLElement | null = null;
    const show = new Debouncer(
      () => {
        if (!target?.isConnected) return;
        const r = target.getBoundingClientRect(),
          lines = parseTip(target.dataset.title!),
          above = target.dataset.tip === "above" || r.bottom + 48 * lines.length > innerHeight;
        setTip({
          lines,
          x: r.left + r.width / 2,
          y: above ? r.top - 8 : r.bottom + 8,
          above,
        });
      },
      { wait: 500 },
    );
    const restore = () => {
      show.cancel();
      if (target?.dataset.title !== undefined) {
        target.title = target.dataset.title;
        delete target.dataset.title;
      }
      if (target?.dataset.tipLabel !== undefined) {
        target.removeAttribute("aria-label");
        delete target.dataset.tipLabel;
      }
      target = null;
      setTip(null);
    };
    const over = (event: PointerEvent) => {
      const next =
        (event.target as Element | null)?.closest?.<HTMLElement>("[title],[data-title]") ?? null;
      if (next === target) return;
      restore();
      if (!next || !next.title) return;
      target = next;
      next.dataset.title = next.title;
      // An icon-only control is named by its title; keep that name for screen readers while it is parked.
      if (!next.hasAttribute("aria-label") && !next.textContent?.trim()) {
        next.setAttribute("aria-label", next.title);
        next.dataset.tipLabel = "";
      }
      next.removeAttribute("title");
      show.maybeExecute();
    };
    addEventListener("pointerover", over);
    addEventListener("pointerdown", restore, true);
    addEventListener("keydown", restore, true);
    addEventListener("scroll", restore, true);
    return () => {
      restore();
      removeEventListener("pointerover", over);
      removeEventListener("pointerdown", restore, true);
      removeEventListener("keydown", restore, true);
      removeEventListener("scroll", restore, true);
    };
  }, []);
  if (!tip) return null;
  return (
    <div
      ref={ref}
      role="tooltip"
      className={`app-tooltip${tip.lines.length > 1 ? " app-tooltip-lines" : ""}`}
      style={{ left: tip.x, top: tip.y, transform: tip.above ? "translateY(-100%)" : undefined }}
    >
      {tip.lines.length === 1 ? (
        <TipRow line={tip.lines[0]!} />
      ) : (
        tip.lines.map((line, index) => (
          <span key={index} className="app-tooltip-line">
            <TipRow line={line} />
          </span>
        ))
      )}
    </div>
  );
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
