import { afterEach, expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { RouterContextProvider } from "@tanstack/react-router";
import type { Board, Issue } from "@/shared/issue-model";
import { commit, get } from "@/client/state/store";
import { router } from "@/client/features/navigation/app-navigation";
import { ViewFavorites } from "./views-navigation";

const before = get();
afterEach(() => commit({ issues: before.issues, boards: before.boards, board: before.board, favorites: before.favorites }));

const board: Board = { id: 7, name: "Space", columns: [{ name: "Todo", statuses: [{ id: "todo", name: "Todo", category: "new" }] }] };
const issue: Issue = {
  key: "Z-42", boards: [7], summary: "Spike: a made-up title", status: "todo", type: "Task", assignee: null, labels: [],
  comments: 0, updated: "2026-11-01T10:00:00Z", resolved: null,
};

// Linear's favorite row for an issue is its title alone (`z1`: `title: e.title`, no detail), not "KEY title" (BJ-428).
test("an issue's favorite row shows its title without its key, keeping its status icon and ×", () => {
  commit({ boards: [board], board: 7, issues: new Map([[issue.key, issue]]), favorites: [issue.key] });
  const html = renderToStaticMarkup(<RouterContextProvider router={router}><ViewFavorites expanded onToggle={() => {}} /></RouterContextProvider>);
  const row = html.match(/<span class="min-w-0 flex-1 truncate">([^<]*)<\/span>/)?.[1];
  expect(row).toBe("Spike: a made-up title");
  expect(html).not.toContain("Z-42 Spike");
  expect(html).toContain('data-favorite="Z-42"');
  expect(html).toContain('aria-label="Remove favorite"');
});
