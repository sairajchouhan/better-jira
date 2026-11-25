import { type Board, type Issue } from "@/shared/issue-model";
import { findIssueDocument } from "@/shared/issue-resource";
import type { SavedView } from "@/shared/saved-view-model";

import type { Scope } from "@/shared/view-model";
import { boardFor } from "@/shared/board-membership";

export type NavigationChoice = {
  id: string;
  name: string;
  /** A favorite's id, which the screen it opens remembers (sidebar-active.ts). */
  favorite?: string;
  destination:
    | { view: SavedView }
    | { board: number; selected: string | null; panel: boolean; document?: string; scope?: Scope };
};

/** A favorite's name in its sidebar row and in "Open favorite…": Linear's favorite mapping title (`B1` → `z1`), one source for
 *  both. An issue is its title alone, never its key (`z1`: `title: e.title`, no detail); the key stays on its hover card. */
export const favoriteName = ({ view, issue, board, document }: {
  view?: { name: string }; issue?: Issue; board?: { name: string }; document?: { resource: { title: string } };
}) => view?.name ?? (document ? document.resource.title || "New document" : issue ? issue.summary : board?.name ?? "");

/** Resolve stored favorites and directory entries without coupling routing rules to menu rendering. */
export function navigationChoices(
  kind: "favorites" | "views" | "boards",
  state: { board: number; boards: Board[]; savedViews: SavedView[]; favorites: string[]; issues: Map<string, Issue> },
): NavigationChoice[] {
  if (kind === "boards")
    return state.boards.map((board) => ({
      id: String(board.id), name: board.name,
      destination: { board: board.id, selected: null, panel: false },
    }));
  if (kind === "views")
    return state.savedViews.map((view) => ({ id: view.id, name: view.name, destination: { view } }));
  return state.favorites.flatMap((id) => favoriteChoice(id, state).map((choice) => ({ ...choice, favorite: id })));
}
function favoriteChoice(
  id: string,
  state: { board: number; boards: Board[]; savedViews: SavedView[]; issues: Map<string, Issue> },
): NavigationChoice[] {
  const savedView = state.savedViews.find((v) => `view:${v.id}` === id);
  if (savedView) return [{ id, name: favoriteName({ view: savedView }), destination: { view: savedView } }];
  const document = id.startsWith("document:")
    ? findIssueDocument(state.issues.values(), id.slice(9))
    : undefined;
  if (document)
    return [{
      id, name: favoriteName({ document }),
      destination: {
        board: boardFor(document.issue, state.board), selected: document.issue.key, panel: true,
        document: document.resource.id,
      },
    }];
  const issue = state.issues.get(id),
    [, boardId, scope] = id.split(":"),
    board = state.boards.find((b) => b.id === Number(boardId));
  if (issue)
    return [{ id, name: favoriteName({ issue }), destination: { board: boardFor(issue, state.board), selected: issue.key, panel: true } }];
  if (!board) return [];
  return [{
    id, name: `${favoriteName({ board })}${scope ? ` · ${scope}` : ""}`,
    destination: {
      board: board.id, selected: null, panel: false,
      ...(scope ? { scope: scope === "active" ? "active" : scope === "backlog" ? "backlog" : "all" } : {}),
    },
  }];
}
