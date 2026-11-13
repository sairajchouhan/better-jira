/**
 * Linear's SidebarLink (`h$`): every sidebar row that opens a place (Inbox, My issues, boards, views, favorites) is this
 * one link, marked active by the one rule in sidebar-active.ts. Two variants by what they open: a destination or a
 * saved view.
 */
import type { ComponentProps } from "react";
import type { SavedView } from "@/shared/saved-view-model";
import { useStore } from "@/client/state/store";
import { AppLink, SavedViewLink } from "./app-link";
import type { Destination } from "./navigation";
import { isSidebarActive, type SidebarRow } from "./sidebar-active";

/** Whether this row is the active one; a boolean selector, so a row re-renders only when its own state flips. */
const useSidebarActive = (row: SidebarRow) => useStore((s) => isSidebarActive(row, s));

/**
 * Every sidebar row's box: Linear's SidebarLink (`_$.linkBase` + `_$.containerBg`) and sidebar button (`qsr.button`, Search
 * and New issue) light up with the sidebar theme's sidebarLinkBg (`--sidebar-hover`) under the pointer and while their
 * context menu is open (`[data-menu-open]`). The keyboard ring is the global :focus-visible one, so a mouse click leaves
 * no ring (Linear's linkBase only styles :focus-visible).
 */
export const sidebarRowClass = (active: boolean, className = "") =>
  `flex h-7 items-center gap-2 rounded-lg pr-[9px] pl-2 text-left ${active ? "bg-sel text-fg" : "text-fg-2 hover:bg-(--sidebar-hover) in-data-menu-open:bg-(--sidebar-hover)"} ${className}`;

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
