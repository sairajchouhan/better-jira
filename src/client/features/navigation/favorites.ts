/** Sidebar favorites (boards, views, issues, documents), stored per account in this browser and shared by its tabs. */
import { set } from "@/client/state/store";
import type { SavedView } from "@/shared/saved-view-model";
import { onFavoritesChange, savedFavorites } from "@/client/state/browser-preferences";

/** Toggles against the stored list, so another tab's favorites aren't overwritten (R2-issue-fields-D1). */
export function toggleFavorite(id: string) {
  const favorites = savedFavorites();
  set({
    favorites: favorites.includes(id) ? favorites.filter((v) => v !== id) : [...favorites, id],
  });
}
/** A favorite dropped on another takes its place in the sidebar (BJ-75), against the stored list like toggleFavorite. */
export function moveFavorite(id: string, target: string) {
  const favorites = savedFavorites(),
    from = favorites.indexOf(id),
    to = favorites.indexOf(target);
  if (from < 0 || to < 0 || from === to) return;
  favorites.splice(from, 1);
  favorites.splice(to, 0, id);
  set({ favorites });
}
/** The stored favorites, without views that no longer exist. */
export const liveFavorites = (savedViews: SavedView[]) =>
  savedFavorites().filter((id) => !id.startsWith("view:") || savedViews.some((v) => `view:${v.id}` === id));
/** The stored favorites without `id`. */
export const favoritesWithout = (id: string) => savedFavorites().filter((v) => v !== id);

// Another tab changed them.
onFavoritesChange(() => set({ favorites: savedFavorites() }));
