import { expect, test } from "bun:test";
import type { ReactElement } from "react";
import { EditorIcon } from "./editor-icons";

test("CORE-27: a glyph that repeats a path (the heading H) still keys each path uniquely", () => {
  const svg = EditorIcon({ name: "h1" }) as ReactElement<{ children: ReactElement[] }>;
  const keys = svg.props.children.map((path) => path.key);
  expect(keys.length).toBeGreaterThan(1);
  expect(new Set(keys).size).toBe(keys.length);
});
