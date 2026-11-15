import { Fragment, type ComponentProps } from "react";
import "./control-tokens.css";
import "./keycap.css";

/**
 * Linear's `b4` Shortcut and its key caps (startup-entry.Dt5YDWdY.js, exported as `ai`). Cap geometry is `Bbe`, the
 * "or"/"then" label sizes are `Vbe`, the container is `D4`. keycap.css spells these out.
 */
export const SHORTCUT = {
  GAP: 3,
  KEY: {
    small: { FONT_SIZE: 11, BORDER_RADIUS: 4, PADDING: 2, MIN_WIDTH: 18 },
    normal: { FONT_SIZE: 11, BORDER_RADIUS: 3, PADDING: 4, MIN_WIDTH: 20 },
    large: { FONT_SIZE: 13, BORDER_RADIUS: 3, PADDING: 5, MIN_WIDTH: 24 },
  },
  LABEL_FONT_SIZE: { small: 10, normal: 11, large: 12 },
} as const;

type Size = keyof typeof SHORTCUT.KEY;
type Look = { size?: Size };

/** `Lbe`: keys that already imply Shift, so no ⇧ cap is drawn for them. */
const SHIFTED = new Set(["#", "^", "+", "?"]);
/** `Rbe` */
const DISPLAY: Record<string, string> = {
  ArrowUp: "↑",
  ArrowRight: "→",
  ArrowDown: "↓",
  ArrowLeft: "←",
  Escape: "esc",
  Backspace: "⌫",
  Enter: "↵",
};
/** `C4`, keyed by what a cap shows. */
const SPOKEN: Record<string, string> = {
  "↑": "Arrow Up",
  "→": "Arrow Right",
  "↓": "Arrow Down",
  "←": "Arrow Left",
  Esc: "Escape",
  "↵": "Enter",
  "⌫": "Backspace",
  "⇧": "Shift",
  "⌘": "Command",
  "⌥": "Option",
  "⌃": "Control",
  Ctrl: "Control",
  "#": "Hash",
  "{": "Left Curly Brace",
  "}": "Right Curly Brace",
  "+": "Plus",
  "?": "Question Mark",
  "[": "Left Square Bracket",
  "]": "Right Square Bracket",
};

/** `g4`: Linear's platform test. */
export const isMac = () =>
  typeof navigator !== "undefined" && /Mac|iPod|iPhone|iPad/.test(navigator.platform);

/**
 * One hotkey chord in the registry's spelling ("Mod+Shift+S", "Alt+F", "?") as the caps Linear draws, in b4's order:
 * Ctrl, then ⌘ (off a Mac, Mod becomes Ctrl and goes first), then ⌥/Alt, then ⇧, then the key.
 */
export function chordKeys(chord: string, mac = isMac()): string[] {
  const parts = chord.length > 1 && chord.endsWith("++") ? [...chord.slice(0, -2).split("+"), "+"] : chord === "+" ? ["+"] : chord.split("+");
  const key = parts.pop()!,
    has = (...names: string[]) => names.some((name) => parts.includes(name)),
    caps: string[] = [];
  if (has("Control", "Ctrl")) caps.push("Ctrl");
  if (has("Mod", "Meta")) {
    if (mac) caps.push("⌘");
    else caps.unshift("Ctrl");
  }
  if (has("Alt", "Option")) caps.push(mac ? "⌥" : "Alt");
  if (has("Shift") && !SHIFTED.has(key)) caps.push("⇧");
  caps.push((DISPLAY[key] ?? key).replace(/[A-Za-z]/, (letter) => letter.toUpperCase()));
  return caps;
}

/** A `shortcut`/`keys` prop: one registry chord ("Mod+Shift+.") or a sequence (["G", "I"]). */
export type Keys = string | readonly string[];

/**
 * The one place a `title` spells a shortcut: "text (keys)" from registry chords. src/client/components/tooltip.tsx draws the brackets
 * back as caps (`tipCaps`), so caps are space-separated, a sequence says "then" and an `alternate` follows "/". ⌘ sits
 * just before the key ("⇧ ⌘ ."), as live Linear tooltips show it; b4's menu caps put it first.
 */
export function shortcutTitle(text: string, keys?: Keys, alternate?: string, mac = isMac()): string {
  if (!keys?.length) return text;
  const caps = (chord: string) => {
    const all = chordKeys(chord, mac),
      key = all.pop()!;
    return [...all.filter((cap) => cap !== "⌘"), ...all.filter((cap) => cap === "⌘"), key].join(" ");
  };
  const spelled = (typeof keys === "string" ? [keys] : keys).map(caps).join(" then ");
  return `${text} (${alternate ? `${spelled} / ${caps(alternate)}` : spelled})`;
}

const spoken = (cap: string) => SPOKEN[cap] ?? cap.toUpperCase();

/** The hidden text b4 reads out: caps joined by spaces, " or " before the alternate, ", then " between a sequence's chords. */
export function spokenShortcut(chords: readonly string[][], alternate?: readonly string[]): string {
  const [first = [], ...rest] = chords;
  let head = first.map(spoken).join(" ");
  if (alternate) {
    const other = alternate.map(spoken).join(" ");
    head = head ? `${head} or ${other}` : other;
  }
  return [head, ...rest.map((chord) => chord.map(spoken).join(" "))].filter(Boolean).join(", then ");
}

/** One key cap; aria-hidden inside a Shortcut, which speaks the whole chord once. */
export function Keycap({ size = "normal", className = "", ...props }: Look & ComponentProps<"kbd">) {
  return <kbd data-size={size} className={`ui-keycap ${className}`} {...props} />;
}

function Caps({ chord, look }: { chord: readonly string[]; look: Look }) {
  return chord.map((cap, index) => (
    <Keycap key={index} aria-hidden {...look}>
      {cap}
    </Keycap>
  ));
}

function Joiner({ size = "normal", children }: { size?: Size; children: string }) {
  return (
    <span aria-hidden data-size={size} className="ui-shortcut-label">
      {children}
    </span>
  );
}

/**
 * A hotkey drawn as caps: `keys` is one chord ("Mod+K") or a sequence (["G", "I"]); `alternate` is a second chord shown
 * after "or". Screen readers hear the spoken form once, never the glyphs.
 */
export function Shortcut({
  keys,
  alternate,
  size,
  className = "",
  ...props
}: Look & { keys: Keys; alternate?: string } & Omit<ComponentProps<"span">, "children">) {
  const mac = isMac(),
    chords = (typeof keys === "string" ? [keys] : keys).map((chord) => chordKeys(chord, mac)),
    other = alternate === undefined ? undefined : chordKeys(alternate, mac),
    look = { size };
  return (
    <span className={`ui-shortcut ${className}`} {...props}>
      <span className="sr-only">{spokenShortcut(chords, other)}</span>
      <Caps chord={chords[0] ?? []} look={look} />
      {other && (
        <>
          <Joiner size={size}>or</Joiner>
          <Caps chord={other} look={look} />
        </>
      )}
      {chords.slice(1).map((chord, index) => (
        <Fragment key={index}>
          <Joiner size={size}>then</Joiner>
          <Caps chord={chord} look={look} />
        </Fragment>
      ))}
    </span>
  );
}
