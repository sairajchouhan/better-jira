import { expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { chordKeys, Shortcut, shortcutTitle, spokenShortcut } from "./keycap";

test("chords follow b4's order and platform modifiers", () => {
  expect(chordKeys("Mod+Shift+S", true)).toEqual(["⌘", "⇧", "S"]);
  expect(chordKeys("Mod+Shift+S", false)).toEqual(["Ctrl", "⇧", "S"]);
  expect(chordKeys("Mod+Alt+C", true)).toEqual(["⌘", "⌥", "C"]);
  expect(chordKeys("Mod+Alt+C", false)).toEqual(["Ctrl", "Alt", "C"]);
  expect(chordKeys("Control+Shift+1", true)).toEqual(["Ctrl", "⇧", "1"]);
});

test("keys that imply Shift drop the ⇧ cap; named keys become glyphs", () => {
  expect(chordKeys("Shift+?", true)).toEqual(["?"]);
  expect(chordKeys("Shift++", true)).toEqual(["+"]);
  expect(chordKeys("+", true)).toEqual(["+"]);
  expect(chordKeys("Escape", true)).toEqual(["Esc"]);
  expect(chordKeys("Shift+Backspace", true)).toEqual(["⇧", "⌫"]);
  expect(chordKeys("ArrowUp", true)).toEqual(["↑"]);
  expect(chordKeys("x", true)).toEqual(["X"]);
});

test("spoken text names every cap, with or/then joins", () => {
  expect(spokenShortcut([["⌘", "⇧", "S"]])).toBe("Command Shift S");
  expect(spokenShortcut([["G"], ["I"]])).toBe("G, then I");
  expect(spokenShortcut([["↑"]], ["K"])).toBe("Arrow Up or K");
  expect(spokenShortcut([["Ctrl", "Alt", "?"]])).toBe("Control ALT Question Mark");
});

test("Shortcut hides the caps and speaks the chord once", () => {
  const html = renderToStaticMarkup(<Shortcut keys={["G", "I"]} />);
  expect(html).toContain('<span class="sr-only">G, then I</span>');
  expect(html.match(/<kbd[^>]*aria-hidden="true"/g)).toHaveLength(2);
  expect(html).toContain(">then</span>");
});

test("a title spells registry chords as the tooltip's caps, on every platform (F3)", () => {
  expect(shortcutTitle("Copy git branch name", "Mod+Shift+.", undefined, true)).toBe("Copy git branch name (⇧ ⌘ .)");
  expect(shortcutTitle("Redo", "Mod+Shift+Z", undefined, false)).toBe("Redo (Ctrl ⇧ Z)");
  expect(shortcutTitle("Close", "Escape", undefined, true)).toBe("Close (Esc)");
  expect(shortcutTitle("Go to inbox", ["G", "I"], undefined, true)).toBe("Go to inbox (G then I)");
  expect(shortcutTitle("Previous", "K", "ArrowUp", true)).toBe("Previous (K / ↑)");
  expect(shortcutTitle("Help", "Shift+?", undefined, true)).toBe("Help (?)");
  expect(shortcutTitle("Plain", "")).toBe("Plain");
});
