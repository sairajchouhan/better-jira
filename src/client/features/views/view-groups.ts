import { useEffect, useSyncExternalStore } from "react";
import type { Bucket } from "@/shared/view-model";

/**
 * Linear's ViewOptionsGroupsContext: the rendered board or list registers its groups under its view, and the Group ordering
 * panel reads them from there, so the panel lists exactly the groups on screen, in their shown order, without selecting the
 * issues a second time.
 */
export type ViewGroups = {
  /** Every group of the column grouping, in shown order. */
  columns: Bucket[];
  /** Those not shown: the user hid them, or they are empty while Show empty groups is off. */
  hidden: Bucket[];
  /** The groups the user hid. */
  hiddenIds: string[];
};

const groups = new Map<number, ViewGroups>();
const listeners = new Set<() => void>();
const subscribe = (listener: () => void) => {
  listeners.add(listener);
  return () => listeners.delete(listener);
};
const changed = () => listeners.forEach((l) => l());

/** The rendered view registers its groups while it is the active one (Linear's `ka(viewPreferences.id, groups)`). */
export function useRegisterViewGroups(board: number, value: ViewGroups | null) {
  useEffect(() => {
    if (!value) return;
    groups.set(board, value);
    changed();
    return () => {
      if (groups.get(board) !== value) return;
      groups.delete(board);
      changed();
    };
  }, [board, value]);
}

/** The groups the board's view has on screen, or undefined before it renders. */
export const useViewGroups = (board: number) => useSyncExternalStore(subscribe, () => groups.get(board));
