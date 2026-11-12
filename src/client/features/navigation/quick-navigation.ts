import { type Board, type Issue } from "@/shared/issue-model";
import { findIssueDocument } from "@/shared/issue-resource";
import type { SavedView } from "@/shared/saved-view-model";

import type { Scope } from "@/shared/view-model";

export type NavigationChoice = {
  id: string;
  name: string;
  destination:
    | { view: SavedView }
    | { board: number; selected: string | null; panel: boolean; document?: string; scope?: Scope };
};

/** Resolve stored favorites and directory entries without coupling routing rules to menu rendering. */
export function navigationChoices(
  kind: "favorites" | "views" | "boards",
  state: { boards: Board[]; savedViews: SavedView[]; favorites: string[]; issues: Map<string, Issue> },
): NavigationChoice[] {
  if (kind === "boards")
    return state.boards.map((board) => ({
      id: String(board.id), name: board.name,
      destination: { board: board.id, selected: null, panel: false },
    }));
  if (kind === "views")
    return state.savedViews.map((view) => ({ id: view.id, name: view.name, destination: { view } }));
  return state.favorites.flatMap((id): NavigationChoice[] => {
    const savedView = state.savedViews.find((v) => `view:${v.id}` === id);
    if (savedView) return [{ id, name: savedView.name, destination: { view: savedView } }];
    const document = id.startsWith("document:")
      ? findIssueDocument(state.issues.values(), id.slice(9))
      : undefined;
    if (document)
      return [{
        id, name: document.resource.title || "New document",
        destination: {
          board: document.issue.board, selected: document.issue.key, panel: true,
          document: document.resource.id,
        },
      }];
    const issue = state.issues.get(id),
      [, boardId, scope] = id.split(":"),
      board = state.boards.find((b) => b.id === Number(boardId));
    if (issue)
      return [{ id, name: `${id} ${issue.summary}`, destination: { board: issue.board, selected: issue.key, panel: true } }];
    if (!board) return [];
    return [{
      id, name: `${board.name}${scope ? ` · ${scope}` : ""}`,
      destination: {
        board: board.id, selected: null, panel: false,
        ...(scope ? { scope: scope === "active" ? "active" : scope === "backlog" ? "backlog" : "all" } : {}),
      },
    }];
  });
}
