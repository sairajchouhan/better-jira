import { afterEach, expect, test } from "bun:test";
import type { Board } from "@/shared/issue-model";
import { defaultPreferences } from "@/shared/view-model";
import type { SavedView } from "@/shared/saved-view-model";
import { commit, get } from "@/client/state/store";
import { beginViewEditor, navigate, openSavedView } from "@/client/features/navigation/app-navigation";
import { setDisplay } from "./view-settings";

const before = get();
const fetched = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = fetched;
  navigate({ board: before.board, selected: null, panel: false });
  commit({ boards: before.boards, board: before.board, savedViews: before.savedViews, preferences: before.preferences });
});

const board: Board = { id: 9, name: "Space", columns: [{ name: "Todo", statuses: [{ id: "todo", name: "Todo", category: "new" }] }] };
const p = defaultPreferences();
const saved: SavedView = {
  id: "ov1", board: 9, kind: "custom", name: "Mine", description: "", icon: "filter", color: "gray", filters: p.filters,
  display: { ...p.display, openIn: "side" }, scope: p.scope, hidden: {}, collapsed: {}, order: {}, mine: false, createdAt: "", updatedAt: "",
};

// The Display menu's "Open issues in" takes effect at once wherever it is kept, not only on a plain board.
test("choosing Open issues in on an open saved view opens its issues that way at once, before the server answers", () => {
  globalThis.fetch = (() => new Promise(() => {})) as unknown as typeof fetch;
  commit({ boards: [board], board: 9, savedViews: [saved], preferences: { 9: defaultPreferences() } });
  openSavedView(saved);
  expect(get()).toMatchObject({ activeViewId: "ov1", view: "side" });
  setDisplay(9, { openIn: "page" });
  expect(get().savedViews.find((v) => v.id === "ov1")?.display.openIn).toBe("page");
  expect(get()).toMatchObject({ view: "page", linkView: false });
  // The board's own setting is the view's business no longer.
  expect(get().preferences[9]?.display.openIn).toBe("side");
});

test("choosing Open issues in while editing a view opens its issues that way at once", () => {
  commit({ boards: [board], board: 9, savedViews: [], preferences: { 9: defaultPreferences() } });
  beginViewEditor({ ...saved, id: undefined, name: "" });
  expect(get().view).toBe("side");
  setDisplay(9, { openIn: "page" });
  expect(get().editorDraft?.display.openIn).toBe("page");
  expect(get()).toMatchObject({ view: "page", linkView: false });
});
