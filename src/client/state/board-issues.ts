import type { Issue } from "@/shared/issue-model";
import { sharedMemo } from "@/client/lib/shared-memo";
import { useStore } from "./store";

const shared = sharedMemo();

/** A board's own issues out of the store's map, built once per map and board however many pickers and menus ask. */
export const boardIssues = (all: ReadonlyMap<string, Issue>, board: number | undefined): Issue[] =>
  shared(all, `board:${board}`, [], () => [...all.values()].filter((i) => i.board === board));

/** The board's issues from the store (boardIssues): the same array until the issues change, so caches keyed on it hit. */
export function useBoardIssues(board: number | undefined): Issue[] {
  const all = useStore((s) => s.issues);
  return boardIssues(all, board);
}
