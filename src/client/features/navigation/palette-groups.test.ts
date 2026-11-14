import { expect, test } from "bun:test";
import { groupPriority, orderGroups, paletteGroupOf, TARGET_PRIORITY, type PaletteGroup } from "./palette-groups";

const ALL: PaletteGroup[] = ["Help", "Miscellaneous", "Display options", "Navigation", "Filter", "Views", "Issues", "Notifications", "Document"];
const order = (at: { inbox: boolean; view: boolean }, typing = false, rank: Partial<Record<PaletteGroup, number>> = {}) =>
  orderGroups(
    ALL.map((g) => ({ g, priority: groupPriority(g, at), rank: rank[g] ?? 0 })),
    typing,
  ).map((x) => x.g);

test("the palette's groups follow Linear's priorities with nothing typed", () => {
  expect(order({ inbox: false, view: false })).toEqual([
    "Document",
    "Notifications",
    "Issues",
    "Views",
    "Filter",
    "Navigation",
    "Display options",
    "Miscellaneous",
    "Help",
  ]);
  // In the inbox Notifications lead; on a saved view, Views come before the issue commands.
  expect(order({ inbox: true, view: true }).slice(0, 3)).toEqual(["Notifications", "Document", "Views"]);
  expect(TARGET_PRIORITY).toBeLessThan(groupPriority("Document", { inbox: false, view: false }));
});

test("while typing, the best-matching group leads and ties keep Linear's priority", () => {
  expect(order({ inbox: false, view: false }, true, { Help: -1 })[0]).toBe("Help");
  expect(order({ inbox: false, view: false }, true).slice(0, 2)).toEqual(["Document", "Notifications"]);
});

test("each command is filed under Linear's group for it", () => {
  expect(paletteGroupOf({ id: "shortcuts", group: "General" })).toBe("Help");
  expect(paletteGroupOf({ id: "undo", group: "General" })).toBe("Miscellaneous");
  expect(paletteGroupOf({ id: "display", group: "Navigation" })).toBe("Display options");
  expect(paletteGroupOf({ id: "new", group: "Issues" })).toBe("Issues");
  expect(paletteGroupOf({ id: "filter-clear", group: "Filters" })).toBe("Filter");
  expect(paletteGroupOf({ id: "inbox-read", group: "Inbox" })).toBe("Notifications");
  expect(paletteGroupOf({ id: "active", group: "Navigation" })).toBe("Navigation");
  expect(paletteGroupOf({ id: "back", group: "General" })).toBe("Navigation");
});

test("R3-palette-shortcuts-D4: ⌘K lists Favorite view once, in the open view's group, not again under Views", async () => {
  const { LISTED_BY_VIEW_GROUP } = await import("./palette-groups");
  const { shortcuts } = await import("./shortcuts");
  expect([...LISTED_BY_VIEW_GROUP]).toEqual(["view-favorite"]);
  // The registry entry keeps its ⌥F and still files under Views wherever it isn't skipped.
  const favorite = shortcuts.find((s) => s.id === "view-favorite")!;
  expect([favorite.hotkey, paletteGroupOf(favorite)]).toEqual(["Alt+F", "Views"]);
});
