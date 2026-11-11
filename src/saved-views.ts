/** Phase 2 contract: usePreferences/changePreferences edit the temporary overlay while a view
 * is active. Issue results use useEffectivePreferences (saved base AND overlay). Display edits
 * persist to the view. Draft helpers are detached: Cancel simply discards the draft; duplicate
 * has no id until saveViewDraft. Async mutations reject on failure and return the saved id.
 * createViewFromCurrent saves and opens; createViewDraft supplies the editor's unsaved flow.
 * Favorites use the existing toggleFavorite(`view:${id}`) and are browser/account scoped.
 */
import { useMemo } from "react";
import { get, useStore, useEffectivePreferences } from "./store";
export type { SavedView, ViewDraft } from "./saved-view-model";
export { encodeOverlay, decodeOverlay, mergeFilters, emptyOverlay } from "./saved-view-model";
export {
  usePreferences,
  preferencesFor,
  changePreferences,
  changeDisplay,
  openSavedView,
  createSavedView,
  updateSavedView,
  deleteSavedView,
  createViewDraft,
  editViewDraft,
  duplicateViewDraft,
  saveViewDraft,
  createViewFromCurrent,
  clearOverlay,
  saveOverlayToView,
  refreshSavedViews,
  toggleFavorite,
  useEffectivePreferences,
  effectivePreferencesFor,
} from "./store";
export const useActiveView = () =>
  useStore((s) => s.savedViews.find((v) => v.id === s.activeViewId) ?? null);
export const activeView = () =>
  get().savedViews.find((v) => v.id === get().activeViewId) ?? null;
export const useOverlayFilters = () => useStore((s) => s.overlayFilters);
export const useSavedViews = () => useStore((s) => s.savedViews);
export const viewsFor = (board?: number, kind?: "tab" | "custom") =>
  get().savedViews.filter(
    (v) => (board === undefined || v.board === board) && (!kind || v.kind === kind),
  );
export const useFavoriteIds = () => useStore((s) => s.favorites);

export const useEffectiveFilters = () => {
  const board = useStore((s) => s.board);
  return useEffectivePreferences(board).filters;
};
export function useViewsByBoard(board?: number, kind?: "tab" | "custom") {
  const views = useSavedViews();
  return useMemo(
    () =>
      views.filter(
        (v) => (board === undefined || v.board === board) && (!kind || v.kind === kind),
      ),
    [views, board, kind],
  );
}

export const useEffectiveMine = () =>
  useStore((s) => s.mine || !!s.savedViews.find((v) => v.id === s.activeViewId)?.mine);
