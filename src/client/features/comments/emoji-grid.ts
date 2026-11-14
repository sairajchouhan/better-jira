import type { Key } from "react-aria-components";

/** Linear's emoji picker (`Vut`): nine 28px cells a row, each section starting a new row. */
export const EMOJI_PER_LINE = 9;

/**
 * Where the arrows move the highlight in a grid of sections, as Linear's `cut` does: ↓ and ↑ go to the same column of the next or
 * previous row, or that row's last cell when it is shorter (React Aria's grid delegate skips a short row instead); ↑ in the first
 * row goes to the first cell; ↓ in the last row stays; ← and → step through the cells in order, stopping at the ends. A key the
 * grid no longer holds (the list changed under it) moves to the first cell. React Aria's ListBox takes this as its
 * `keyboardDelegate`.
 */
export function emojiGridDelegate(sections: readonly (readonly Key[])[], perLine = EMOJI_PER_LINE) {
  const rows = sections.flatMap((keys) =>
    Array.from({ length: Math.ceil(keys.length / perLine) }, (_, row) => keys.slice(row * perLine, (row + 1) * perLine)),
  );
  const cells = rows.flat();
  const place = new Map(rows.flatMap((row, r) => row.map((key, c) => [key, [r, c] as const])));
  const first = cells[0] ?? null;
  const vertical = (key: Key, step: 1 | -1): Key | null => {
    const at = place.get(key);
    if (!at) return first;
    const row = rows[at[0] + step];
    if (row) return row[Math.min(at[1], row.length - 1)]!;
    return step < 0 ? first : key;
  };
  const along = (key: Key, step: 1 | -1): Key | null => {
    const at = cells.indexOf(key);
    if (at < 0) return first;
    return cells[Math.max(0, Math.min(cells.length - 1, at + step))]!;
  };
  return {
    getFirstKey: () => first,
    getLastKey: () => cells.at(-1) ?? null,
    getKeyBelow: (key: Key) => vertical(key, 1),
    getKeyAbove: (key: Key) => vertical(key, -1),
    getKeyRightOf: (key: Key) => along(key, 1),
    getKeyLeftOf: (key: Key) => along(key, -1),
  };
}

/**
 * What a key pressed in the picker's search does, by Linear's `cut`, before React Aria's Autocomplete sees it:
 * - `"text"`: the field keeps it (the caret is not at the end, a modifier is held, or it is Home, End or a page key), so it edits or
 *   moves the caret and the highlight stays put. React Aria would otherwise move the highlight with ↑/↓, Home and End wherever the
 *   caret is.
 * - an arrow key: React Aria gets that arrow in its place. → and Tab with nothing highlighted highlight the first cell (React Aria
 *   leaves → to the caret then); Tab and Shift+Tab step through the cells.
 * - `"pass"`: React Aria handles it as it is.
 */
export function pickerKey(
  key: string,
  { highlighted, caretAtEnd, shift, modifier }: { highlighted: boolean; caretAtEnd: boolean; shift: boolean; modifier: boolean },
): "text" | "pass" | "ArrowDown" | "ArrowLeft" | "ArrowRight" {
  if (key === "Tab") {
    if (modifier) return "pass";
    if (!highlighted) return shift ? "pass" : "ArrowDown";
    return shift ? "ArrowLeft" : "ArrowRight";
  }
  if (["Home", "End", "PageUp", "PageDown"].includes(key)) return "text";
  if (!key.startsWith("Arrow")) return "pass";
  if (!caretAtEnd || shift || modifier) return "text";
  if (highlighted) return "pass";
  if (key === "ArrowRight") return "ArrowDown";
  // ↑ with nothing highlighted does nothing in Linear's picker; React Aria would highlight the last cell.
  return key === "ArrowUp" ? "text" : "pass";
}
