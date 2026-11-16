/**
 * Linear's SidebarLink (`h$`): every sidebar row that opens a place (Inbox, My issues, boards, views, favorites) is this
 * one link, marked active by the one rule in sidebar-active.ts. Two variants by what they open: a destination or a
 * saved view.
 */
import type { ComponentProps } from "react";
import { useRouterState } from "@tanstack/react-router";
import { routeNotFound } from "@/client/routes/tree";
import type { SavedView } from "@/shared/saved-view-model";
import { useStore } from "@/client/state/store";
import { shortcutTitle, type Keys } from "@/client/components/keycap";
import { AppLink, SavedViewLink } from "./app-link";
import type { Destination } from "./navigation";
import { isSidebarActive, type SidebarRow } from "./sidebar-active";

/** Whether this row is the active one; boolean selectors, so a row re-renders only when its own state flips. A Not found
 *  screen lights no row, though the store still holds the board it fell back to (R3-chrome-D7). */
const useSidebarActive = (row: SidebarRow) => {
  const notFound = useRouterState({ select: (s) => routeNotFound(s.matches) });
  return useStore((s) => isSidebarActive(row, s)) && !notFound;
};

/**
 * Every sidebar row's box: Linear's SidebarLink (`_$.linkBase` + `_$.containerBg`) and sidebar button (`qsr.button`, Search
 * and New issue) light up with the sidebar theme's sidebarLinkBg (`--sidebar-hover`) under the pointer and while their
 * context menu is open (`[data-menu-open]`). The keyboard ring is the global :focus-visible one, so a mouse click leaves
 * no ring (Linear's linkBase only styles :focus-visible).
 */
export const sidebarRowClass = (active: boolean, className = "") =>
  `flex h-7 items-center gap-2 rounded-lg pr-[9px] pl-2 text-left ${active ? "bg-sel text-fg" : "text-fg-2 hover:bg-(--sidebar-hover) in-data-menu-open:bg-(--sidebar-hover)"} ${className}`;

/**
 * The one rule for a sidebar row's shortcut: never drawn in the row, at rest or on hover; a row that has one shows it in Linear's row
 * tooltip to its right, the action's name then its caps ("Go to inbox G then I"). Linear's SidebarLink (`h$`) wraps itself in `wZ`
 * with `position: "right"` and `shortcutAction`, whose title is the action's name (`bDt`), e.g. `f_r` "Go to inbox" for Inbox.
 */
export const sidebarTip = (name: string, keys: Keys) => ({ title: shortcutTitle(name, keys), "data-tip": "right" });

type RowProps = { row: SidebarRow } & Omit<ComponentProps<"a">, "aria-current">;

/** A sidebar row that goes to a destination, opened from its favorite or from none (Linear's link `state.favoriteId`). */
export function SidebarLink({ row, to, className, ...props }: RowProps & { to: Destination }) {
  const active = useSidebarActive(row);
  return (
    <AppLink
      to={{ ...to, favorite: row.favorite ?? null }}
      aria-current={active ? "page" : undefined}
      className={sidebarRowClass(active, className)}
      {...props}
    />
  );
}

/** A sidebar row that opens a saved view. */
export function SidebarViewLink({ row, view, className, ...props }: RowProps & { view: SavedView }) {
  const active = useSidebarActive(row);
  return (
    <SavedViewLink
      view={view}
      favorite={row.favorite}
      aria-current={active ? "page" : undefined}
      className={sidebarRowClass(active, className)}
      {...props}
    />
  );
}
