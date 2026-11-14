/**
 * The ⌘K palette's groups and their order, as Linear's command menu sorts them (each group's `priority` in startup-root.CnUSfl4j.js;
 * the xO enum: targeted model actions 0, non-targeted 1000, view actions 2000, navigation 2500, misc 3000, search 5000):
 * the targeted issue (AD, 1), a targeted document (LD, 4), the open view (JD, 5), Notifications (kD, 0 in the inbox, else 1000),
 * Issues (jD, 1001), Views (Brt, 5 on a custom view, else 1005), Filter (aO, 2010), Navigation (fO, 2500), Display options
 * (ZD, 2998), Miscellaneous (QD, 3000), Help (mO, 3020). Search results (issues, documents) come after every command group.
 */
export type PaletteGroup =
  | "Document"
  | "Notifications"
  | "Issues"
  | "Views"
  | "Filter"
  | "Navigation"
  | "Display options"
  | "Miscellaneous"
  | "Help";

/** Where Linear files the command a registry entry runs (its `group` there, not the shortcut panel's). */
const BY_ID: Record<string, PaletteGroup> = {
  help: "Help",
  shortcuts: "Help",
  undo: "Miscellaneous",
  redo: "Miscellaneous",
  "customize-sidebar": "Miscellaneous",
  "dismiss-toast": "Miscellaneous",
  "copy-page": "Miscellaneous",
  display: "Display options",
  layout: "Display options",
  "collapse-all": "Display options",
  // Linear's grouping and ordering actions are in ZD (`ltt`, useRegisterToggleSelectActionFactory / useOrderingMenu `group`).
  grouping: "Display options",
  ordering: "Display options",
  new: "Issues",
  "new-full": "Issues",
};
const BY_REGISTRY_GROUP: Record<string, PaletteGroup> = {
  Documents: "Document",
  Filters: "Filter",
  Views: "Views",
  Inbox: "Notifications",
};
/** Registry commands the open view's own group (JD) already lists under Linear's name, so the app's groups skip them: Linear has
 *  one Favorite view / Unfavorite view row, in JD (`Qz` in startup-root.CnUSfl4j.js), not a second one under Views
 *  (R3-palette-shortcuts-D4). Its ⌥F still runs from the registry. */
export const LISTED_BY_VIEW_GROUP: ReadonlySet<string> = new Set(["view-favorite"]);
export function paletteGroupOf(entry: { id: string; group: string }): PaletteGroup {
  return BY_ID[entry.id] ?? BY_REGISTRY_GROUP[entry.group] ?? "Navigation";
}

/** Where the palette is: in the inbox, on a saved view. */
export type PaletteContext = { inbox: boolean; view: boolean };
/** The targeted issue's commands (AD's priority 1 with an issue targeted). */
export const TARGET_PRIORITY = 1;
/** The open view's commands (JD's 5 with a view targeted). */
export const VIEW_PRIORITY = 5;
export function groupPriority(group: PaletteGroup, at: PaletteContext): number {
  switch (group) {
    case "Document":
      return 4;
    case "Notifications":
      return at.inbox ? 0 : 1000;
    case "Issues":
      return 1001;
    case "Views":
      return at.view ? 5 : 1005;
    case "Filter":
      return 2010;
    case "Navigation":
      return 2500;
    case "Display options":
      return 2998;
    case "Miscellaneous":
      return 3000;
    case "Help":
      return 3020;
  }
}

/** Groups in Linear's order: by priority with nothing typed; while typing, the best-matching row's group first (`rank`, lower is
 *  better), ties by priority. Stable, so equal groups keep their given order. */
export function orderGroups<G extends { priority: number; rank: number }>(groups: G[], typing: boolean): G[] {
  return [...groups].sort((a, b) => (typing ? a.rank - b.rank : 0) || a.priority - b.priority);
}
