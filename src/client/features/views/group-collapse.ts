import { chordKeys, isMac } from "@/client/components/keycap";
import { type Bucket } from "@/shared/view-model";

/** The tooltip of a list group's collapse chevron (Linear's CollapseListGroupButton `x`): "T to collapse group" over "⌥ click to
 *  collapse all", each line its caps first (`N_`), "expand" while the group is collapsed. A title for the app's Tooltips. */
export function collapseTip(collapsed: boolean, mac = isMac()): string {
  const verb = collapsed ? "expand" : "collapse";
  const alt = chordKeys("Alt+A", mac)[0];
  return `(${chordKeys("T", mac).join(" ")}) to ${verb} group\n(${alt} click) to ${verb} all`;
}

/** A chevron click: ⌥ toggles every group from this one's state (CollapseListGroupButton `S`: `r.altKey ? toggleAll : toggle`). */
export const collapseClick = (event: { altKey: boolean }, toggle: () => void, toggleAll: () => void) =>
  event.altKey ? toggleAll() : toggle();

/**
 * What T and ⌥T toggle in a list, among the groups on screen (`shown`: as the view's filters, search and hidden groups leave
 * them, never the board's unfiltered groups, BJ-278): T the selected issue's group; ⌥T every shown group, taking the opposite
 * of the selected one's state (`from`, Linear's `toggleAllGroupsAction`) or, with no selection there, each its own opposite.
 * Null: nothing to toggle.
 */
export function collapseTarget(shown: readonly Bucket[], selected: string | null, all: boolean): { ids: string[]; from?: string } | null {
  const own = shown.find((g) => g.issues.some((i) => i.key === selected))?.id;
  if (all) return { ids: shown.map((g) => g.id), ...(own ? { from: own } : {}) };
  return own ? { ids: [own] } : null;
}
