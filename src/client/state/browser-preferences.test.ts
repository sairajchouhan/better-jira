import { expect, test } from "bun:test";

test("preferences move to the first account's scope, read safely and report a refused write", async () => {
  const stored = new Map<string, string>();
  let full = false;
  Object.defineProperty(globalThis, "localStorage", {
    configurable: true,
    value: {
      getItem: (key: string) => stored.get(key) ?? null,
      setItem: (key: string, value: string) => {
        if (full) throw new Error("QuotaExceededError");
        stored.set(key, value);
      },
    },
  });
  const p = await import("./browser-preferences");
  stored.set("board", "7");
  stored.set("better-jira:favorites:v1", JSON.stringify(["board:3:all", "board:3:active", "issue:A-1", 4]));
  stored.set("better-jira:defaults:v1", "not json");
  p.scopePreferences("site/me");
  expect(p.savedBoard()).toBe(7);
  expect(p.savedFavorites()).toEqual(["board:3", "issue:A-1"]);
  expect(p.savedDefaults()).toEqual({});
  // A second account starts empty instead of taking the first one's preferences.
  p.scopePreferences("site/other");
  expect(p.savedFavorites()).toEqual([]);

  p.rememberViewDetails("v1", true);
  expect(p.viewDetailsOpen("v1")).toBe(true);
  expect(p.persistPreferences({ board: 9, favorites: ["issue:A-2"] })).toBeUndefined();
  expect(p.savedBoard()).toBe(9);
  full = true;
  expect(p.persistPreferences({ favorites: [] })).toBe("Could not save favorites in this browser");
  expect(p.savedFavorites()).toEqual(["issue:A-2"]);
});

test("each page's filter survives a reload, and the filter a board's tabs used to share moves to the tab it was last used on", async () => {
  const stored = new Map<string, string>();
  Object.defineProperty(globalThis, "localStorage", {
    configurable: true,
    value: { getItem: (key: string) => stored.get(key) ?? null, setItem: (key: string, value: string) => void stored.set(key, value) },
  });
  const p = await import("./browser-preferences");
  p.scopePreferences("site/filters");
  const rule = (value: string) => ({ id: "f", join: "and", children: [{ id: "r", field: "labels", op: "is", values: [value] }] });
  // Before: board 3's tabs shared one filter, last used on Active; My issues' tabs shared another under board 0.
  stored.set(
    "better-jira:views:v1:site/filters",
    JSON.stringify({ 3: { scope: "active", filters: rule("a") }, 4: { scope: "all" }, 0: { filters: rule("m") } }),
  );
  expect(Object.keys(p.savedPageFilters()).sort()).toEqual(["board/3/active", "person/me/assigned"]);
  expect(p.savedPageFilters()["board/3/active"]?.children).toMatchObject([{ field: "labels", values: ["a"] }]);
  // No board preference holds a filter any more, so no other tab can show it.
  expect(p.savedViewPreferences()[3]?.filters.children).toEqual([]);
  // Once page filters are stored, a reload reads them as they were.
  const pages = { "view/v1": rule("v") } as never;
  expect(p.persistPreferences({ pageFilters: pages })).toBeUndefined();
  expect(p.savedPageFilters()).toMatchObject({ "view/v1": { children: [{ values: ["v"] }] } });
  expect(Object.keys(p.savedPageFilters())).toEqual(["view/v1"]);
});
