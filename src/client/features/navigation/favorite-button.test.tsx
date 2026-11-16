import { afterEach, expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { commit, get } from "@/client/state/store";
import { RemoveFavoriteButton, removeFavoriteClick } from "./favorite-button";

const previous = Object.getOwnPropertyDescriptor(globalThis, "localStorage");
afterEach(() => {
  if (previous) Object.defineProperty(globalThis, "localStorage", previous);
  else delete (globalThis as { localStorage?: unknown }).localStorage;
  commit({ favorites: [] });
});

test("a favorite row's ×: Linear's `g5n` Remove favorite, 10px X, held in place unseen until the row is hovered", () => {
  const html = renderToStaticMarkup(<RemoveFavoriteButton id="issue:A-1" />);
  expect(html).toContain('role="button"');
  expect(html).toContain('aria-label="Remove favorite"');
  expect(html).toContain('title="Remove favorite"');
  expect(html).toContain('width="10"');
  // Always in the row (so the title never shifts), invisible until its row is hovered or pressed; no fade.
  expect(html).toMatch(/class="[^"]*\bopacity-0\b[^"]*\bgroup-hover\/favorite:opacity-100\b/);
  expect(html).toContain("group-active/favorite:opacity-100");
  expect(html).not.toMatch(/\btransition\b|(?<!:)\bhidden\b/);
  // labelFaint, labelBase under the pointer; 6px after the title (the row's 8px gap less 2px); 5px wider hit area.
  expect(html).toMatch(/\btext-fg-4\b[^"]*\bhover:text-fg-2\b/);
  expect(html).toContain("-ml-0.5");
  expect(html).toContain("after:-inset-[5px]");
  // Gone while its row is dragged (Linear `u5n`: no trailing when `isDragged`; our Sortable.Item marks `data-dragged`).
  expect(html).toContain("in-data-dragged:hidden");
  // Its title shows over the row's open card, in its own store, so the card stays open under it (Linear: card and tooltip both up).
  expect(html).toContain('data-tip-over-card=""');
});

test("clicking a favorite's × removes it and keeps the click from opening the row's link", () => {
  const stored = new Map<string, string>([["better-jira:favorites:v1", JSON.stringify(["view:v1", "issue:A-1", "board:3"])]]);
  Object.defineProperty(globalThis, "localStorage", {
    configurable: true,
    value: { getItem: (key: string) => stored.get(key) ?? null, setItem: (key: string, value: string) => stored.set(key, value) },
  });
  commit({ favorites: ["view:v1", "issue:A-1", "board:3"] });
  const calls: string[] = [];
  removeFavoriteClick("issue:A-1")({ preventDefault: () => calls.push("preventDefault"), stopPropagation: () => calls.push("stopPropagation") });
  expect(calls.sort()).toEqual(["preventDefault", "stopPropagation"]);
  expect(get().favorites).toEqual(["view:v1", "board:3"]);
  // The rendered × is wired to that handler.
  const element = RemoveFavoriteButton({ id: "board:3" });
  (element.props as { onClick: (event: { preventDefault(): void; stopPropagation(): void }) => void }).onClick({
    preventDefault: () => {},
    stopPropagation: () => {},
  });
  expect(get().favorites).toEqual(["view:v1"]);
});

test("every kind of favorite (issue, view, space, document) draws the × in its row, which is its hover group", async () => {
  const source = await Bun.file(new URL("../views/views-navigation.tsx", import.meta.url)).text();
  const rows = source.slice(source.indexOf("export function ViewFavorites("), source.indexOf("export function ViewDetails("));
  // One shared row content for every kind, ending with the ×.
  expect(rows).toMatch(/const content = <>[^\n]*<RemoveFavoriteButton id=\{id\} \/><\/>;/);
  expect(rows).toContain('className: "group/favorite w-full"');
});
