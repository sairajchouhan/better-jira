import { chordKeys, isMac } from "@/client/components/keycap";

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
