import { expect, test } from "bun:test";
import { boardPage, migratePageFilters, parsePageFilters, personPage, viewPage, withPageFilter } from "./page-filters";
import { defaultPreferences, type FilterGroup } from "./view-model";

const rule = (value: string): FilterGroup => ({
  id: "f",
  join: "and",
  children: [{ id: "r", field: "labels", op: "is", values: [value] }],
});

test("each page has its own key, as Linear keys a filter by the page's address", () => {
  expect(new Set([boardPage(1, "all"), boardPage(1, "active"), boardPage(2, "all"), viewPage("v"), personPage(null, "assigned"), personPage(null, "created"), personPage("u2", "assigned")]).size).toBe(7);
});

test("an empty filter removes its page's entry; stored entries that aren't filters drop", () => {
  const set = withPageFilter({}, "a", rule("x"));
  expect(withPageFilter(set, "a", defaultPreferences().filters)).toEqual({});
  expect(parsePageFilters({ a: rule("x"), b: "junk", c: { children: [] } })).toEqual({ a: rule("x") });
  expect(parsePageFilters([rule("x")])).toEqual({});
});

test("a board's shared filter moves to its last-used tab, My issues' to Assigned", () => {
  const p = defaultPreferences();
  expect(
    migratePageFilters({ 1: { ...p, scope: "backlog", filters: rule("b") }, 2: p, 0: { ...p, filters: rule("m") } }),
  ).toEqual({ "board/1/backlog": rule("b"), "person/me/assigned": rule("m") });
});
