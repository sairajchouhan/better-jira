import { expect, test } from "bun:test";
import { backKey, openedFor, openedIn } from "./menu";
import { Row } from "./action-menu";
import { FilterEntry } from "@/client/features/filters/filter-menu";
import { LabelRow } from "@/client/features/issue/property-menu";

const MEMO = Symbol.for("react.memo");

test("a submenu row opening takes its level's highlight unless it already holds it", () => {
  const highlighted: string[] = [];
  const level = (current: string) => ({ highlighted: current, highlight: (v: string) => void highlighted.push(v) });
  openedIn(level("Status"), "Status");
  openedIn(level("Status"), "Labels");
  expect(highlighted).toEqual(["Labels"]);
});

test("each submenu row sees only its own opening, the same object while it stays open, so the other rows never re-render", () => {
  const status = { key: "Status", how: "pointer" as const };
  expect(openedFor(status, "Status")).toBe(status);
  expect(openedFor(status, "Labels")).toBeNull();
  expect(openedFor(null, "Status")).toBeNull();
});

test("a menu level's context value is made once for the menu's life, so a highlight change never re-renders every submenu row", async () => {
  // As scripts/build-server.ts compiles it: the value's literal sits behind the compiler's first-render sentinel, with no deps.
  const result = await Bun.build({
    entrypoints: [new URL("./menu.tsx", import.meta.url).pathname],
    reactCompiler: true,
    packages: "external",
    target: "browser",
    define: { "process.env.NODE_ENV": JSON.stringify("production") },
  });
  const code = await result.outputs[0]!.text();
  const at = code.indexOf("actions: {");
  expect(at).toBeGreaterThan(0);
  expect(code.slice(at - 80, at)).toMatch(/=== __MEMO_CACHE_SENTINEL\)\s*\w+ = \{\s*$/);
});

test("menu rows that would all re-render on each hover or keystroke are memoised", () => {
  for (const row of [FilterEntry, Row, LabelRow]) expect((row as unknown as { $$typeof: symbol }).$$typeof).toBe(MEMO);
});

test("a submenu steps back on a plain ← or Backspace only", () => {
  const key = (key: string, mods: Partial<Record<"altKey" | "ctrlKey" | "metaKey" | "shiftKey", boolean>> = {}) => ({
    key,
    altKey: false,
    ctrlKey: false,
    metaKey: false,
    shiftKey: false,
    ...mods,
  });
  expect(backKey(key("ArrowLeft"))).toBe(true);
  expect(backKey(key("Backspace"))).toBe(true);
  expect(backKey(key("ArrowLeft", { shiftKey: true }))).toBe(false);
  expect(backKey(key("Backspace", { metaKey: true }))).toBe(false);
  expect(backKey(key("ArrowRight"))).toBe(false);
});

test("Menu.Submenu registers no hotkeys per row: its back keys live on its open popup", async () => {
  const source = await Bun.file(new URL("./menu.tsx", import.meta.url)).text();
  expect(source).not.toContain("useHotkey");
});
