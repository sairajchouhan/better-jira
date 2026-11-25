import type { Issue } from "@/shared/issue-model";
import { sharedMemo } from "@/client/lib/shared-memo";
import { useStore } from "./store";
import { onBoard } from "@/shared/board-membership";

const shared = sharedMemo();

/** The issues a board holds (an issue on several boards is on each), out of the store's map, built once per map and board however many pickers and menus ask. */
export const boardIssues = (all: ReadonlyMap<string, Issue>, board: number | undefined): Issue[] =>
  shared(all, `board:${board}`, [], () => [...all.values()].filter((i) => onBoard(i, board)));

/** The board's issues from the store (boardIssues): the same array until the issues change, so caches keyed on it hit. */
export function useBoardIssues(board: number | undefined): Issue[] {
  const all = useStore((s) => s.issues);
  return boardIssues(all, board);
}
