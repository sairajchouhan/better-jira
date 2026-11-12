import { expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { Icon } from "@/client/components/icons";
import { EMOJI_GROUPS, GLYPH_GROUPS, VIEW_COLORS } from "@/client/features/views/view-icon-picker";
import { viewActions } from "./view-editor";
import type { SavedView } from "@/client/features/views/saved-views";

const view = (kind: SavedView["kind"]) => ({ id: "v1", kind, name: "Mine" }) as SavedView;
const labels = (groups: ReturnType<typeof viewActions>) => groups.map((g) => g.map(([label]) => label));

test("BJ-136: tab right-click menu matches Linear and has no CSV export", () => {
  expect(labels(viewActions(view("tab"), false, true))).toEqual([
    ["Edit…", "Duplicate…"],
    ["Favorite", "Copy link"],
  ]);
});

test("BJ-136: custom ⋯ menu keeps CSV export and leaves Favorite to the header star", () => {
  expect(labels(viewActions(view("custom"), true, false))).toEqual([
    ["Edit…", "Duplicate…"],
    ["Copy link", "Export issues as CSV…"],
  ]);
  expect(labels(viewActions(view("custom"), true, true))[1]).toContain("Unfavorite");
});

test("BJ-131: picker offers categorised glyphs and emojis, all renderable and unique", () => {
  const glyphs = GLYPH_GROUPS.flatMap(([, names]) => names);
  const emojis = EMOJI_GROUPS.flatMap(([, list]) => list);
  expect(GLYPH_GROUPS.length).toBeGreaterThanOrEqual(4);
  expect(EMOJI_GROUPS.map(([name]) => name)).toContain("Smileys & People");
  expect(glyphs.length).toBeGreaterThanOrEqual(40);
  expect(emojis.length).toBeGreaterThanOrEqual(300);
  expect(new Set(glyphs).size).toBe(glyphs.length);
  expect(new Set(emojis.map(([e]) => e)).size).toBe(emojis.length);
  expect(new Set(emojis.map(([, n]) => n)).size).toBe(emojis.length);
  for (const [glyph, name] of emojis) {
    expect(/[^\x00-\x7F]/.test(glyph)).toBe(true); // SavedViewIcon renders non-ASCII icons as emoji
    expect(name).toMatch(/^[a-z-]+$/);
  }
  for (const name of glyphs) expect(renderToStaticMarkup(<Icon name={name} />)).toMatch(/ d="[^"]+"/);
});

test("BJ-131: Linear's nine colours with Grey stored as the theme-aware default", () => {
  expect(VIEW_COLORS.map(([label]) => label)).toEqual([
    "Grey",
    "Dark Grey",
    "Purple",
    "Teal",
    "Green",
    "Yellow",
    "Orange",
    "Pink",
    "Red",
  ]);
  expect(VIEW_COLORS[0][1]).toBe("gray");
});
