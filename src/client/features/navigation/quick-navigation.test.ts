import { expect, test } from "bun:test";
import { navigationChoices } from "./quick-navigation";
import { defaultPreferences } from "@/shared/view-model";
import type { Board, Issue } from "@/client/state/store";
import type { SavedView } from "@/shared/saved-view-model";

const board: Board = { id: 1, name: "Team", columns: [] };
const view: SavedView = {
  ...defaultPreferences(), id: "bugs", name: "Bugs", board: 1, kind: "custom",
  description: "", icon: "custom-view", color: "gray", mine: false,
  createdAt: "2026-01-01", updatedAt: "2026-01-01",
};
const issue: Issue = {
  key: "T-1", board: 1, summary: "An issue", status: "todo", assignee: null,
  labels: [], comments: 0, updated: "", resolved: null,
  resources: [{ id: "doc", kind: "document", title: "", updated: "" }],
};
const state = { boards: [board], savedViews: [view], issues: new Map([[issue.key, issue]]), favorites: [] as string[] };

test("directories retain their order and route independently of the current selection", () => {
  expect(navigationChoices("boards", { ...state, boards: [board, { ...board, id: 2, name: "Two" }] })).toEqual([
    { id: "1", name: "Team", destination: { board: 1, selected: null, panel: false } },
    { id: "2", name: "Two", destination: { board: 2, selected: null, panel: false } },
  ]);
  expect(navigationChoices("views", state)).toEqual([{ id: "bugs", name: "Bugs", destination: { view } }]);
});

test("mixed favorites preserve order, labels, document fallback and legacy board scopes", () => {
  const choices = navigationChoices("favorites", { ...state, favorites: [
    "missing", "document:doc", "T-1", "view:bugs", "board:1:active", "board:1:backlog", "board:1:old", "board:1", "board:99",
  ] });
  expect(choices).toEqual([
    { id: "document:doc", name: "New document", destination: { board: 1, selected: "T-1", panel: true, document: "doc" } },
    { id: "T-1", name: "T-1 An issue", destination: { board: 1, selected: "T-1", panel: true } },
    { id: "view:bugs", name: "Bugs", destination: { view } },
    ...(["active", "backlog", "old"] as const).map((scope) => ({
      id: `board:1:${scope}`, name: `Team · ${scope}`,
      destination: { board: 1, selected: null, panel: false, scope: scope === "old" ? "all" as const : scope },
    })),
    { id: "board:1", name: "Team", destination: { board: 1, selected: null, panel: false } },
  ]);
});

test("document lookup keeps first-match precedence and uses a nonempty title verbatim", () => {
  const other = { ...issue, key: "T-2", resources: [{ id: "doc", kind: "document" as const, title: "Named", updated: "" }] };
  const issues = new Map([[other.key, other], [issue.key, issue]]);
  expect(navigationChoices("favorites", { ...state, issues, favorites: ["document:doc"] })[0]).toEqual({
    id: "document:doc", name: "Named", destination: { board: 1, selected: "T-2", panel: true, document: "doc" },
  });
});
