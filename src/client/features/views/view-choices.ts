import type { ActionEntry } from "@/client/components/action-menu";
import { hoistValues, type ScoredAction } from "@/client/lib/fuzzy-score";
import { GROUPINGS, ORDERINGS, type Display } from "@/shared/view-model";

/**
 * The grouping and ordering choices, one source for the Display menu's selects, the ⌥⇧G / ⌥⇧O command pages and ⌘K's hoisted
 * values (Linear builds the select and the action from the same `groupingOptions` / `orderingOptions`: useGroupingMenu `d`,
 * useOrderingMenu `h`).
 */

/** A board always groups its columns, so its grouping has no "No grouping". */
export const groupingOptions = (layout: Display["layout"]) => GROUPINGS.filter(([value]) => layout !== "board" || value !== "none");

/** Linear's ⌥⇧G action (useGroupingMenu `d`: `Change ${label.toLowerCase()}`, keywords "grouping", hoisted from 2 characters). */
export const GROUPING_ACTION = { name: "Change grouping", parent: "Change grouping", keywords: ["grouping"], hoistFrom: 2 } as const;
/** Linear's ⌥⇧O action (useOrderingMenu `_`: "View ordering…", subActionsHoisting `minInputLength: 5`); a hoisted value's breadcrumb
 *  drops the "…" (getParentActionLabel). */
export const ORDERING_ACTION = { name: "View ordering…", parent: "View ordering", keywords: ["order", "ordering"], hoistFrom: 5 } as const;

/** useRegisterToggleSelectActionFactory `o`: one sub-action per grouping option, named by its label, the current one selected. */
export function groupingChoices(d: Display, apply: (patch: Partial<Display>) => void): ActionEntry[] {
  return groupingOptions(d.layout).map(([value, label]) => ({
    name: label,
    selected: d.columns === value,
    run: () => apply({ columns: value }),
  }));
}

/** useOrderingMenu `_`: "Manual" for the manual ordering (`v`: sortOrder, manual), else "By <label lowercased>", keywords
 *  "order ordering", the current one selected. */
export function orderingChoices(d: Display, apply: (patch: Partial<Display>) => void): ActionEntry[] {
  return ORDERINGS.map(([value, label]) => ({
    name: value === "manual" ? "Manual" : `By ${label.toLowerCase()}`,
    keywords: [...ORDERING_ACTION.keywords],
    selected: d.ordering === value,
    run: () => apply({ ordering: value }),
  }));
}

/** ⌘K's hoisted grouping and ordering values (Linear's subActionsHoisting on both actions, `Yn.shouldHoistSubActions`): grouping
 *  from 2 typed characters, ordering from 5, each breadcrumbed by its action, and only while that action applies. */
export function hoistedViewChoices<T extends ScoredAction>(
  rows: { grouping: readonly T[]; ordering: readonly T[] },
  q: string,
  applies: (id: "grouping" | "ordering") => boolean,
): [number, T & { parents: string[] }][] {
  return (
    [
      ["grouping", GROUPING_ACTION],
      ["ordering", ORDERING_ACTION],
    ] as const
  ).flatMap(([kind, action]) =>
    applies(kind) ? hoistValues(rows[kind].map((row) => ({ ...row, parents: [action.parent] })), q, action.hoistFrom) : [],
  );
}
