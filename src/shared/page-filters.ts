/**
 * Each page's temporary filter, as Linear keeps them: one per page address (startup-root `E9`,
 * `persistenceKey = identifier ?? pathname`), stored in this browser as `filter_2_<key>` and removed once empty
 * (startup-entry `TW`). Each board tab, saved view and personal page tab is its own page, so a filter set on one never
 * shows on another, and each survives leaving the page and a reload. navigation.ts `pageKey` names the page on screen.
 */
import { parsePreferences, type FilterGroup, type Preferences, type Scope } from "./view-model";
import type { PersonTab } from "./people";

export type PageFilters = Record<string, FilterGroup>;

export const boardPage = (board: number, scope: Scope) => `board/${board}/${scope}`;
export const viewPage = (id: string) => `view/${id}`;
/** A personal page tab: mine (`person` null, Linear's My issues) or another person's profile. */
export const personPage = (person: string | null, tab: PersonTab) => `person/${person ?? "me"}/${tab}`;

/** The pages' filters with this page's set; an empty filter removes its entry. */
export function withPageFilter(filters: PageFilters, key: string, filter: FilterGroup): PageFilters {
  const { [key]: _old, ...rest } = filters;
  return filter.children.length ? { ...rest, [key]: filter } : rest;
}

/** Stored page filters as versioned input: entries that aren't filters drop, rules are checked as preferences' are. */
export function parsePageFilters(saved: unknown): PageFilters {
  if (!saved || typeof saved !== "object" || Array.isArray(saved)) return {};
  let out: PageFilters = {};
  for (const [key, value] of Object.entries(saved))
    out = withPageFilter(out, key, parsePreferences({ filters: value }).filters);
  return out;
}

/**
 * Before filters were per page, each board's tabs shared one in its preferences, keyed by board, and My issues' tabs one
 * under board 0. That filter moves to the tab it was last used on: the board's stored scope, and My issues' Assigned tab
 * (the tab it opens on; which tab was last open wasn't stored).
 */
export function migratePageFilters(preferences: Record<number, Preferences>): PageFilters {
  let out: PageFilters = {};
  for (const [id, p] of Object.entries(preferences))
    out = withPageFilter(out, Number(id) === 0 ? personPage(null, "assigned") : boardPage(Number(id), p.scope), p.filters);
  return out;
}
