/**
 * Which sidebar row is marked active, by Linear's one rule for every SidebarLink (startup-entry `ECe` and `C5`, called
 * from `h$` in startup-root through the `CCe` hook):
 * - A screen remembers the favorite it was opened from (Linear's `location.state.favoriteId`).
 * - A row counts only when it is that favorite, or when neither is a favorite (a board, a view, Inbox, My issues).
 *   An issue favorite also counts when the screen came from no favorite (`activeWithoutFavoriteOrigin`, set only for
 *   issues in the favorites mapping `z1`).
 * - A row that counts is active while the screen shows its place.
 * So a favorite opened from the sidebar lights only its own row, never the board the issue belongs to.
 */
import type { Screen } from "./navigation";

/** What a sidebar row opens. */
export type SidebarPlace =
  | { to: "inbox" }
  | { to: "my-issues" }
  | { to: "board"; board: number }
  | { to: "view"; id: string }
  | { to: "issue"; key: string }
  | { to: "document"; id: string };
export type SidebarScreen = Pick<
  Screen,
  "board" | "selected" | "panel" | "document" | "inbox" | "mine" | "person" | "activeViewId" | "favorite"
>;

/** The screen shows this place: a list counts with an issue open over it (Linear's issueOrigin on the team row). */
export function shows(place: SidebarPlace, s: Omit<SidebarScreen, "favorite">): boolean {
  switch (place.to) {
    case "inbox":
      return s.inbox;
    case "my-issues":
      return s.mine && !s.person && !s.inbox && !s.activeViewId;
    case "board":
      return !s.mine && !s.inbox && !s.activeViewId && s.board === place.board;
    case "view":
      return s.activeViewId === place.id;
    // Linear matches an issue favorite's path exactly: its documents and other issues don't light it.
    case "issue":
      return s.panel && s.selected === place.key && !s.document;
    case "document":
      return s.panel && s.document === place.id;
  }
}

/** A stored favorite id (`board:1`, legacy `board:1:active`, `view:<id>`, `document:<id>`, an issue key) as its place. */
export function favoritePlace(id: string): SidebarPlace {
  if (id.startsWith("board:")) return { to: "board", board: Number(id.split(":")[1]) };
  if (id.startsWith("view:")) return { to: "view", id: id.slice(5) };
  if (id.startsWith("document:")) return { to: "document", id: id.slice(9) };
  return { to: "issue", key: id };
}

/** A sidebar row: its place, and its favorite id when it is a Favorites row. */
export type SidebarRow = { place: SidebarPlace; favorite?: string };
export function isSidebarActive(row: SidebarRow, s: SidebarScreen): boolean {
  const origin = s.favorite ?? undefined;
  const counts =
    row.favorite === origin || (row.favorite !== undefined && row.place.to === "issue" && origin === undefined);
  return counts && shows(row.place, s);
}

/**
 * The favorite the next screen still comes from, as Linear carries `favoriteId` on: a board or view favorite while its
 * list shows (issues opened from it, its tabs: IssueSplitViewList and HeaderTabLinks pass it on); an issue or document
 * favorite while an issue stays open over the same list (its comments, sub-issues, documents). Closing the issue or
 * moving to another list drops it.
 */
export function keptFavorite(prev: SidebarScreen, next: Omit<SidebarScreen, "favorite">): string | null {
  const favorite = prev.favorite;
  if (!favorite) return null;
  const place = favoritePlace(favorite);
  if (place.to === "board" || place.to === "view") return shows(place, next) ? favorite : null;
  const sameList =
    prev.board === next.board &&
    prev.activeViewId === next.activeViewId &&
    prev.mine === next.mine &&
    prev.person === next.person &&
    prev.inbox === next.inbox;
  return sameList && next.panel && next.selected !== null ? favorite : null;
}
