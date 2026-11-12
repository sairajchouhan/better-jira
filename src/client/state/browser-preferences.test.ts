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
