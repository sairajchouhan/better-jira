import { expect, test } from "bun:test";
import { favoritePlace, isSidebarActive, keptFavorite, shows, type SidebarRow, type SidebarScreen } from "./sidebar-active";

const board: SidebarScreen = {
  board: 1,
  selected: null,
  panel: false,
  document: null,
  inbox: false,
  mine: false,
  person: null,
  activeViewId: null,
  favorite: null,
};
const issueOpen = (key: string, favorite: string | null = null): SidebarScreen => ({ ...board, selected: key, panel: true, favorite });
const boardRow: SidebarRow = { place: { to: "board", board: 1 } };
const issueFavorite: SidebarRow = { place: { to: "issue", key: "A-1" }, favorite: "A-1" };
const active = (rows: Record<string, SidebarRow>, s: SidebarScreen) =>
  Object.entries(rows).filter(([, row]) => isSidebarActive(row, s)).map(([name]) => name);

test("an issue opened from its favorite lights only the favorite, never its board (Linear ECe)", () => {
  expect(active({ board: boardRow, favorite: issueFavorite }, issueOpen("A-1", "A-1"))).toEqual(["favorite"]);
});

test("an issue opened from no favorite lights its board and its issue favorite (activeWithoutFavoriteOrigin)", () => {
  expect(active({ board: boardRow, favorite: issueFavorite }, issueOpen("A-1"))).toEqual(["board", "favorite"]);
  // Another issue never lights the favorite; its documents don't either (Linear's exact path match).
  expect(active({ favorite: issueFavorite }, issueOpen("A-2"))).toEqual([]);
  expect(active({ favorite: issueFavorite }, { ...issueOpen("A-1"), document: "d1" })).toEqual([]);
});

test("board and view favorites light only when the screen came from them", () => {
  const rows = {
    board: boardRow,
    boardFavorite: { place: favoritePlace("board:1"), favorite: "board:1" },
    view: { place: { to: "view", id: "v1" } } as SidebarRow,
    viewFavorite: { place: favoritePlace("view:v1"), favorite: "view:v1" },
  };
  expect(active(rows, board)).toEqual(["board"]);
  expect(active(rows, { ...board, favorite: "board:1" })).toEqual(["boardFavorite"]);
  // An issue opened over the favorite's board keeps the favorite lit (Linear passes favoriteId to the issue).
  expect(active(rows, issueOpen("A-1", "board:1"))).toEqual(["boardFavorite"]);
  expect(active(rows, { ...board, activeViewId: "v1" })).toEqual(["view"]);
  expect(active(rows, { ...board, activeViewId: "v1", favorite: "view:v1" })).toEqual(["viewFavorite"]);
});

test("Inbox and My issues use the same rule", () => {
  const rows = { inbox: { place: { to: "inbox" } }, mine: { place: { to: "my-issues" } }, board: boardRow } satisfies Record<string, SidebarRow>;
  expect(active(rows, { ...board, inbox: true })).toEqual(["inbox"]);
  expect(active(rows, { ...board, mine: true })).toEqual(["mine"]);
  expect(active(rows, { ...board, mine: true, person: "u2" })).toEqual([]);
  expect(active(rows, { ...board, mine: true, activeViewId: "v1" })).toEqual([]);
});

test("favorite ids map to their places, legacy board scopes included", () => {
  expect(favoritePlace("board:3:active")).toEqual({ to: "board", board: 3 });
  expect(favoritePlace("view:v1")).toEqual({ to: "view", id: "v1" });
  expect(favoritePlace("document:d1")).toEqual({ to: "document", id: "d1" });
  expect(favoritePlace("A-1")).toEqual({ to: "issue", key: "A-1" });
  expect(shows({ to: "document", id: "d1" }, { ...issueOpen("A-1"), document: "d1" })).toBe(true);
});

test("a screen keeps its favorite while it shows it or an issue opened from it", () => {
  const fromBoard = { ...board, favorite: "board:1" };
  expect(keptFavorite(fromBoard, issueOpen("A-1"))).toBe("board:1");
  expect(keptFavorite(fromBoard, { ...board, board: 2 })).toBeNull();
  expect(keptFavorite(fromBoard, { ...board, mine: true })).toBeNull();
  const fromIssue = issueOpen("A-1", "A-1");
  // A sub-issue or document of it keeps the origin (so its board stays dark); closing it drops the origin.
  expect(keptFavorite(fromIssue, issueOpen("A-2"))).toBe("A-1");
  expect(keptFavorite(fromIssue, { ...issueOpen("A-1"), document: "d1" })).toBe("A-1");
  expect(keptFavorite(fromIssue, board)).toBeNull();
  expect(keptFavorite(fromIssue, { ...issueOpen("A-1"), activeViewId: "v1" })).toBeNull();
  expect(keptFavorite(board, issueOpen("A-1"))).toBeNull();
});
